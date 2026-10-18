-- Canonical invoice compatibility fields; external rows remain intentionally disabled.
-- No existing amount/type, timestamp, snapshot, request or artifact is rewritten.
alter table public.invoices
 add column origin text not null default 'native_gbp',
 add column original_total_minor bigint,
 add column currency_ruleset_id text references public.fx_currency_rulesets(id),
 add column source_fact_revision_id uuid,
 add column source_fact_family_id uuid,
 add constraint invoice_native_origin_scope check(origin='native_gbp' and currency='GBP' and amount is not null and original_total_minor is null and currency_ruleset_id is null and source_fact_revision_id is null and source_fact_family_id is null),
 add foreign key(source_fact_revision_id,user_id) references public.fx_document_fact_revisions(id,user_id),
 add foreign key(source_fact_family_id,user_id) references public.fx_document_fact_families(id,user_id);
create unique index invoices_source_fact_family on public.invoices(user_id,source_fact_family_id) where source_fact_family_id is not null;
alter table public.invoice_revisions
 add column origin text not null default 'native_gbp',
 add column source_fact_revision_id uuid,
 add column source_snapshot jsonb,
 add constraint invoice_revision_native_origin_scope check(origin='native_gbp' and source_fact_revision_id is null and source_snapshot is null),
 add foreign key(source_fact_revision_id,user_id) references public.fx_document_fact_revisions(id,user_id);

-- Contain direct contextual and commercial writes as well as native RPC entry points.
-- A future dimensioned settlement migration must explicitly extend this boundary.
create function public.require_native_invoice_relationship() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.invoice_id is not null and not exists(select 1 from public.invoices i where i.id=new.invoice_id and i.user_id=new.user_id and i.origin='native_gbp' and i.currency='GBP' and i.amount is not null) then
  raise exception 'Use the reviewed currency-aware invoice relationship workflow.';
 end if;
 return new;
end;$$;
revoke all on function public.require_native_invoice_relationship() from public,anon,authenticated,service_role;
create trigger native_settlement_invoice before insert on public.invoice_settlements for each row execute function public.require_native_invoice_relationship();
create trigger native_credit_invoice before insert on public.invoice_credit_notes for each row execute function public.require_native_invoice_relationship();
create trigger native_return_assignment_invoice before insert on public.invoice_refund_assignments for each row execute function public.require_native_invoice_relationship();
create trigger native_financial_record_invoice before insert or update of invoice_id,user_id on public.financial_records for each row execute function public.require_native_invoice_relationship();

create or replace function public.save_invoice_revision(p_invoice uuid,p_revision uuid,p_expected_updated timestamptz,p_data jsonb,p_pdf_path text,p_pdf_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); inv public.invoices; prior public.invoice_revisions;
  payload_hash text; n bigint; v bigint; rate integer; enabled boolean; gross bigint; version_no integer; result jsonb;
begin
  if owner_id is null then raise exception 'Sign in first.'; end if;
  if p_invoice is null or p_revision is null or p_data is null then raise exception 'Missing invoice review.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
  payload_hash:=encode(sha256(convert_to(jsonb_build_object('invoice',p_invoice,'expected',p_expected_updated,'data',p_data)::text,'UTF8')),'hex');
  select * into prior from public.invoice_revisions where id=p_revision and user_id=owner_id;
  if found then
    if prior.origin<>'native_gbp' then raise exception 'Use the preserved invoice evidence workflow.';end if;
    if prior.request_hash is distinct from payload_hash then raise exception 'Invoice request changed. Review again.'; end if;
    return jsonb_build_object('id',prior.invoice_id,'number',prior.snapshot->>'number','version',prior.version,'pdf_path',prior.pdf_path,'pdf_sha256',prior.pdf_sha256,'due_date',prior.snapshot->>'due_date','updated_at',prior.snapshot->>'confirmed_updated_at');
  end if;
  select * into inv from public.invoices where id=p_invoice and user_id=owner_id for update;
  if found then
    if inv.origin<>'native_gbp' or inv.currency<>'GBP' or inv.amount is null then raise exception 'Use the preserved invoice evidence workflow.';end if;
    if p_expected_updated is null or inv.updated_at is distinct from p_expected_updated then raise exception 'Invoice changed. Reload and review.'; end if;
    if exists(select 1 from public.invoice_settlements where invoice_id=inv.id and user_id=owner_id) then raise exception 'Invoices with settlement history require a reviewed correction.'; end if;
    if coalesce(length(btrim(p_data->>'reason')),0) not between 1 and 1000 then raise exception 'Explain this invoice revision.'; end if;
    if inv.number is distinct from p_data->>'number' then raise exception 'Preserve the invoice number.'; end if;
  elsif p_expected_updated is not null then raise exception 'Invoice not found.';
  end if;
  if (p_data->>'net_pence') !~ '^[0-9]{1,12}$' or (p_data->>'vat_pence') !~ '^[0-9]{1,12}$' or (p_data->>'vat_rate_bps') !~ '^[0-9]{1,5}$'
    or jsonb_typeof(p_data->'vat_enabled') is distinct from 'boolean' then raise exception 'Invalid invoice money.'; end if;
  n:=(p_data->>'net_pence')::bigint; v:=(p_data->>'vat_pence')::bigint; rate:=(p_data->>'vat_rate_bps')::integer; enabled:=(p_data->>'vat_enabled')::boolean; gross:=n+v;
  if n is null or v is null or rate is null or n<1 or gross>999999999999 or rate>10000
    or v<>(case when enabled then round(n::numeric*rate/10000)::bigint else 0 end)
    or (enabled and coalesce(length(btrim(p_data->>'vat_number')),0)=0)
    or (not enabled and (rate<>0 or coalesce(p_data->>'vat_number','')<>'')) then raise exception 'Invalid invoice money.'; end if;
  if inv.id is not null and inv.net_pence is null and (inv.status='finalised' or inv.finalised_at is not null) and (gross<>inv.amount*100 or (p_data->>'legacy_confirmed') is distinct from 'true') then raise exception 'First verify the original invoice total and VAT breakdown.'; end if;
  if not exists(select 1 from public.clients where id=(p_data->>'client_id')::uuid and user_id=owner_id) then raise exception 'Choose your own client.'; end if;
  if coalesce(p_data->>'number','') !~ '^[A-Za-z0-9_-]{1,80}$' or coalesce(length(btrim(p_data->>'description')),0) not between 1 and 10000
    or coalesce(length(p_data->>'payment_terms'),0) not between 1 and 2000 then raise exception 'Check the invoice details.'; end if;
  if p_pdf_path is distinct from owner_id::text||'/revisions/'||p_revision::text||'.pdf' or p_pdf_sha256 is null or p_pdf_sha256 !~ '^[a-f0-9]{64}$'
    or not exists(select 1 from storage.objects where bucket_id='invoices' and name=p_pdf_path) then raise exception 'Preserve the reviewed PDF before confirmation.'; end if;
  if inv.id is null then
    insert into public.invoices(id,user_id,client_id,number,invoice_date,due_date,description,amount,payment_terms,status)
    values(p_invoice,owner_id,(p_data->>'client_id')::uuid,p_data->>'number',(p_data->>'invoice_date')::date,(p_data->>'due_date')::date,p_data->>'description',gross::numeric/100,p_data->>'payment_terms','draft') returning * into inv;
  else
    insert into public.invoice_revisions(user_id,invoice_id,version,snapshot,pdf_path,author)
    values(owner_id,inv.id,0,to_jsonb(inv),inv.pdf_path,owner_id) on conflict(invoice_id,user_id,version) do nothing;
  end if;
  version_no:=inv.economics_version+1;
  result:=p_data||jsonb_build_object('amount',gross::numeric/100,'currency','GBP','confirmed_updated_at',now());
  insert into public.invoice_revisions(id,user_id,invoice_id,version,snapshot,pdf_path,pdf_sha256,request_hash,author)
    values(p_revision,owner_id,inv.id,version_no,result,p_pdf_path,p_pdf_sha256,payload_hash,owner_id);
  update public.invoices set client_id=(p_data->>'client_id')::uuid,invoice_date=(p_data->>'invoice_date')::date,due_date=(p_data->>'due_date')::date,
    description=p_data->>'description',amount=gross::numeric/100,payment_terms=p_data->>'payment_terms',status='finalised',finalised_at=coalesce(finalised_at,now()),
    net_pence=n,vat_pence=v,vat_rate_bps=rate,vat_enabled=enabled,vat_number_snapshot=coalesce(p_data->>'vat_number',''),economics_version=version_no,pdf_path=p_pdf_path
    where id=inv.id and user_id=owner_id;
  return jsonb_build_object('id',inv.id,'number',p_data->>'number','version',version_no,'pdf_path',p_pdf_path,'pdf_sha256',p_pdf_sha256,'due_date',p_data->>'due_date','updated_at',now());
end; $$;
revoke all on function public.save_invoice_revision(uuid,uuid,timestamptz,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.save_invoice_revision(uuid,uuid,timestamptz,jsonb,text,text) to authenticated;

-- Exact economics and immutable evidence for reviewed native invoices.
-- Legacy gross totals are retained; historical VAT is deliberately not inferred.
alter table public.invoices
  add column net_pence bigint,
  add column vat_pence bigint,
  add column vat_rate_bps integer,
  add column vat_enabled boolean,
  add column vat_number_snapshot text,
  add column economics_version integer not null default 0 check(economics_version>=0),
  add constraint invoice_economics_complete check (
    (net_pence is null and vat_pence is null and vat_rate_bps is null and vat_enabled is null and vat_number_snapshot is null and economics_version=0)
    or (net_pence is not null and vat_pence is not null and vat_rate_bps is not null and net_pence between 1 and 999999999999 and vat_pence between 0 and 999999999999
      and vat_rate_bps between 0 and 10000 and vat_enabled is not null and vat_number_snapshot is not null
      and economics_version>0 and (net_pence+vat_pence)=amount*100
      and vat_pence=case when vat_enabled then round(net_pence::numeric*vat_rate_bps/10000)::bigint else 0 end
      and ((vat_enabled and length(btrim(vat_number_snapshot))>0) or (not vat_enabled and vat_rate_bps=0 and vat_number_snapshot='')))
  );
create table public.invoice_revisions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  invoice_id uuid not null, version integer not null check(version>=0),
  snapshot jsonb not null, pdf_path text, pdf_sha256 text check(pdf_sha256 ~ '^[a-f0-9]{64}$'),
  request_hash text, author uuid not null references auth.users(id), created_at timestamptz not null default now(),
  foreign key(invoice_id,user_id) references public.invoices(id,user_id),
  unique(invoice_id,user_id,version), unique(id,user_id),
  check(version=0 or (pdf_path is not null and pdf_sha256 is not null and request_hash is not null))
);
alter table public.invoice_revisions enable row level security;
revoke all on public.invoice_revisions from public,anon,authenticated,service_role;
grant select on public.invoice_revisions to authenticated,service_role;
create policy invoice_revision_owner_read on public.invoice_revisions for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_invoice_revisions before update or delete on public.invoice_revisions for each row execute function public.reject_source_mutation();
insert into public.invoice_revisions(user_id,invoice_id,version,snapshot,pdf_path,author)
select user_id,id,0,to_jsonb(i),pdf_path,user_id from public.invoices i;

-- No owner can overwrite a PDF, including an earlier invoice revision.
drop policy if exists "Users can update their own invoice PDFs" on storage.objects;

create function public.protect_invoice_revision_facts() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.economics_version<>0 or (current_user in ('authenticated','anon','service_role') and (new.status='finalised' or new.finalised_at is not null)) then raise exception 'Use reviewed invoice revision confirmation.'; end if;
    return new;
  end if;
  if tg_op='DELETE' then
    if old.economics_version>0 then raise exception 'Preserve invoice revision history.'; end if;
    return old;
  end if;
  if exists(select 1 from public.invoice_settlements where invoice_id=old.id and user_id=old.user_id) and
    (new.payment_terms,new.due_date,new.pdf_path,new.net_pence,new.vat_pence,new.vat_rate_bps,new.vat_enabled,new.vat_number_snapshot) is distinct from
    (old.payment_terms,old.due_date,old.pdf_path,old.net_pence,old.vat_pence,old.vat_rate_bps,old.vat_enabled,old.vat_number_snapshot)
    then raise exception 'Invoices with settlement history require a reviewed correction.'; end if;
  if current_user in ('authenticated','anon','service_role') and
    (new.net_pence,new.vat_pence,new.vat_rate_bps,new.vat_enabled,new.vat_number_snapshot,new.economics_version) is distinct from
    (old.net_pence,old.vat_pence,old.vat_rate_bps,old.vat_enabled,old.vat_number_snapshot,old.economics_version)
    then raise exception 'Use reviewed invoice revision confirmation.'; end if;
  if (old.economics_version>0 or old.status='finalised' or old.finalised_at is not null or new.status='finalised' or new.finalised_at is not null) and current_user in ('authenticated','anon','service_role') and
    (new.user_id,new.client_id,new.amount,new.currency,new.number,new.invoice_date,new.description,new.status,new.payment_terms,new.due_date,new.pdf_path,new.finalised_at)
      is distinct from
    (old.user_id,old.client_id,old.amount,old.currency,old.number,old.invoice_date,old.description,old.status,old.payment_terms,old.due_date,old.pdf_path,old.finalised_at)
    then raise exception 'Use reviewed invoice revision confirmation.'; end if;
  return new;
end; $$;
create trigger zz_protect_invoice_revision_facts before insert or update or delete on public.invoices for each row execute function public.protect_invoice_revision_facts();

create function public.save_invoice_revision(p_invoice uuid,p_revision uuid,p_expected_updated timestamptz,p_data jsonb,p_pdf_path text,p_pdf_sha256 text)
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
    if prior.request_hash is distinct from payload_hash then raise exception 'Invoice request changed. Review again.'; end if;
    return jsonb_build_object('id',prior.invoice_id,'number',prior.snapshot->>'number','version',prior.version,'pdf_path',prior.pdf_path,'pdf_sha256',prior.pdf_sha256,'due_date',prior.snapshot->>'due_date','updated_at',prior.snapshot->>'confirmed_updated_at');
  end if;
  select * into inv from public.invoices where id=p_invoice and user_id=owner_id for update;
  if found then
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

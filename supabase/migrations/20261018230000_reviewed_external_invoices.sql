-- Preserved external documents only; no FX settlement or accounting effects.
create function public.validate_external_invoice_intent(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare expected integer;updated timestamptz;
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>8000
 or(select count(*) from jsonb_object_keys(p))<>12 or not(p ?& array['schema_version','request_id','invoice_id','client_id','source_fact_revision_id','source_fact_family_id','expected_revision','expected_updated_at','expected_stamp','original_sha256','human_read_original','reason'])
 or p->>'schema_version' is distinct from 'external-invoice-intent/1'
 or p->'human_read_original' is distinct from 'true'::jsonb
 or jsonb_typeof(p->'reason') is distinct from 'string' or length(btrim(p->>'reason')) not between 1 and 1000
 or jsonb_typeof(p->'expected_revision') is distinct from 'number' or p->>'expected_revision' !~ '^(0|[1-9][0-9]{0,9})$' or(p->>'expected_revision')::numeric>2147483646
 or jsonb_typeof(p->'expected_stamp') is distinct from 'string' or length(p->>'expected_stamp')<>32 or p->>'expected_stamp' !~ '^[a-f0-9]{32}$'
 or jsonb_typeof(p->'original_sha256') is distinct from 'string' or length(p->>'original_sha256')<>64 or p->>'original_sha256' !~ '^[a-f0-9]{64}$' then raise exception 'Review exact external invoice intent.';end if;
 expected:=(p->>'expected_revision')::integer;
 if expected=0 then
  if p->'expected_updated_at' is distinct from 'null'::jsonb then raise exception 'New capture has no prior timestamp.';end if;
 else
  if jsonb_typeof(p->'expected_updated_at') is distinct from 'string' or length(p->>'expected_updated_at')>40 or p->>'expected_updated_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then raise exception 'Review prior capture timestamp.';end if;
  updated:=(p->>'expected_updated_at')::timestamptz;
 end if;
 return p||jsonb_build_object('request_id',public.fx_fact_uuid(p->'request_id',false),'invoice_id',public.fx_fact_uuid(p->'invoice_id',false),'client_id',public.fx_fact_uuid(p->'client_id',false),
 'source_fact_revision_id',public.fx_fact_uuid(p->'source_fact_revision_id',false),'source_fact_family_id',public.fx_fact_uuid(p->'source_fact_family_id',false),'reason',btrim(p->>'reason'));
end;$$;
revoke all on function public.validate_external_invoice_intent(jsonb) from public,anon,authenticated,service_role;

alter table public.invoices add column external_revision integer;
alter table public.invoices alter column amount drop not null;
alter table public.invoices drop constraint invoices_currency_check,drop constraint invoice_native_origin_scope;
alter table public.invoices add constraint invoice_origin_scope check((
 origin='native_gbp' and currency='GBP' and amount is not null and original_total_minor is null and currency_ruleset_id is null and source_fact_revision_id is null and source_fact_family_id is null and external_revision is null
) or (
 origin='preserved_external' and currency in('GBP','USD','EUR','JPY','KWD') and amount is null and original_total_minor between 1 and 999999999999
 and original_total_minor is not null and currency_ruleset_id='vibecount-currencies/1' and currency_ruleset_id is not null
 and source_fact_revision_id is not null and source_fact_family_id is not null and external_revision is not null and external_revision>=1
 and status='finalised' and finalised_at is not null and pdf_path is null and economics_version=0
 and net_pence is null and vat_pence is null and vat_rate_bps is null and vat_enabled is null and vat_number_snapshot is null
 and delivery_status='not_sent' and sent_at is null and paid_at is null and not reminder_enabled and next_reminder_at is null and due_date is null and project_id is null
));

alter table public.invoice_revisions add column source_read_check_id uuid,
 add foreign key(source_read_check_id,user_id) references public.invoice_source_read_checks(id,user_id);
alter table public.invoice_revisions drop constraint invoice_revision_native_origin_scope;
do $$declare name text;begin
 select conname into strict name from pg_constraint where conrelid='public.invoice_revisions'::regclass and contype='c' and pg_get_constraintdef(oid) like '%version = 0%' and pg_get_constraintdef(oid) like '%pdf_path%';
 execute format('alter table public.invoice_revisions drop constraint %I',name);
end;$$;
alter table public.invoice_revisions add constraint invoice_revision_origin_proof check((
 origin='native_gbp' and source_fact_revision_id is null and source_snapshot is null and source_read_check_id is null
 and(version=0 or(pdf_path is not null and pdf_sha256 is not null and request_hash is not null))
) or (
 origin='preserved_external' and version>=1 and pdf_path is null and pdf_sha256 is null and request_hash is not null
 and source_fact_revision_id is not null and source_read_check_id is not null and source_snapshot is not null and jsonb_typeof(source_snapshot)='object'
));

create table public.external_invoice_requests (
 user_id uuid not null references auth.users(id),request_id uuid not null,intent jsonb not null,source_read_check_id uuid not null,
 result jsonb not null,created_at timestamptz not null default now(),primary key(user_id,request_id),
 foreign key(source_read_check_id,user_id) references public.invoice_source_read_checks(id,user_id)
);
alter table public.external_invoice_requests enable row level security;
revoke all on public.external_invoice_requests from public,anon,authenticated,service_role;
grant select on public.external_invoice_requests to authenticated,service_role;
create policy external_invoice_requests_owner_read on public.external_invoice_requests for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_external_invoice_requests before update or delete on public.external_invoice_requests for each row execute function public.reject_source_mutation();

create function public.external_invoice_review_stamp() returns text
language sql stable security definer set search_path='' as $$
 select case when auth.uid() is not null then md5('external-invoice-review/1|'||public.fx_evidence_review_stamp()||'|'||
 coalesce((select string_agg(id::text||':'||updated_at::text||':'||name,',' order by id) from public.clients where user_id=auth.uid()),'')) end;
$$;
revoke all on function public.external_invoice_review_stamp() from public,anon,authenticated,service_role;
grant execute on function public.external_invoice_review_stamp() to authenticated;

create function public.protect_external_invoice() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then
  if old.origin='preserved_external' then raise exception 'Preserve external invoice history.';end if;return old;
 end if;
 if tg_op='UPDATE' and new.origin is distinct from old.origin then raise exception 'Invoice origins cannot change.';end if;
 if new.origin='preserved_external' and current_user in('authenticated','anon','service_role') then raise exception 'Use reviewed external invoice capture.';end if;
 if new.origin='preserved_external' then
  if tg_op='INSERT' then
   if new.external_revision is distinct from 1 then raise exception 'External history starts at revision one.';end if;
  else
   if(new.id,new.user_id,new.source_fact_family_id) is distinct from(old.id,old.user_id,old.source_fact_family_id) or new.external_revision is distinct from old.external_revision+1 then raise exception 'Preserve external family and append one revision.';end if;
  end if;
 end if;
 return new;
end;$$;
revoke all on function public.protect_external_invoice() from public,anon,authenticated,service_role;
create trigger aa_protect_external_invoice before insert or update or delete on public.invoices for each row execute function public.protect_external_invoice();

-- Deferred closure validates the FINAL invoice state after invoice/history/request are all inserted.
create function public.validate_external_invoice_revision(p_id uuid,p_owner uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare r public.invoice_revisions;f public.fx_document_fact_revisions;c public.invoice_source_read_checks;q public.external_invoice_requests;inv public.invoices;
begin
 select * into r from public.invoice_revisions where id=p_id and user_id=p_owner and origin='preserved_external';
 select * into f from public.fx_document_fact_revisions where id=r.source_fact_revision_id and user_id=p_owner;
 select * into c from public.invoice_source_read_checks where id=r.source_read_check_id and user_id=p_owner;
 select * into q from public.external_invoice_requests where request_id=r.id and user_id=p_owner;
 select * into inv from public.invoices where id=r.invoice_id and user_id=p_owner;
 if r.id is null or f.id is null or c.id is null or q.request_id is null or inv.id is null or inv.origin<>'preserved_external' or r.version>inv.external_revision
 or f.kind<>'invoice' or f.state<>'verified' or not f.human_read_original or inv.source_fact_family_id<>f.family_id
 or r.source_snapshot is distinct from f.source_snapshot or c.source_snapshot is distinct from f.source_snapshot or c.fact_revision_id<>f.id or c.outcome<>'verified'
 or c.intent->>'schema_version' is distinct from 'invoice-source-read-intent/2' or c.intent->'capture_intent' is distinct from q.intent or c.request_id<>r.id or q.source_read_check_id<>c.id
 or q.intent is distinct from public.validate_external_invoice_intent(q.intent) or q.intent->>'invoice_id'<>r.invoice_id::text or q.intent->>'source_fact_revision_id'<>f.id::text or q.intent->>'source_fact_family_id'<>f.family_id::text or(q.intent->>'expected_revision')::integer<>r.version-1
 or r.request_hash is distinct from encode(sha256(convert_to(q.intent::text,'UTF8')),'hex') or r.author<>p_owner
 or r.snapshot is distinct from jsonb_build_object('schema_version','preserved-external-invoice/1','invoice_id',r.invoice_id,'client_id',q.intent->>'client_id','external_revision',r.version,'number',f.data->>'invoice_reference','invoice_date',f.data->>'invoice_date','currency',f.data->>'currency','original_total_minor',(f.data->>'original_total_minor')::bigint,'source_fact_revision_id',f.id,'source_fact_family_id',f.family_id,'confirmed_updated_at',r.created_at)
 or q.result is distinct from jsonb_build_object('schema_version','external-invoice-result/1','invoice_id',r.invoice_id,'revision_id',r.id,'external_revision',r.version,'source_fact_revision_id',f.id,'recognized_income_change_pence',0,'recognized_expense_change_pence',0,'settlement_change',0)
 then raise exception 'External revision proof closure failed.';end if;
end;$$;
revoke all on function public.validate_external_invoice_revision(uuid,uuid) from public,anon,authenticated,service_role;

create function public.validate_external_invoice_history() returns trigger language plpgsql security definer set search_path='' as $$
declare inv public.invoices;r public.invoice_revisions;fact public.fx_document_fact_revisions;proof public.invoice_source_read_checks;req public.external_invoice_requests;target uuid;
begin
 if tg_table_name='invoices' then target:=new.id;else target:=new.invoice_id;end if;
 select * into inv from public.invoices where id=target;
 if inv.origin is distinct from 'preserved_external' then
  if tg_table_name='invoice_revisions' and new.origin='preserved_external' then raise exception 'External revision has no external canonical parent.';end if;return null;
 end if;
 select * into r from public.invoice_revisions where invoice_id=inv.id and user_id=inv.user_id and version=inv.external_revision and origin='preserved_external';
 select * into fact from public.fx_document_fact_revisions where id=inv.source_fact_revision_id and user_id=inv.user_id;
 select * into proof from public.invoice_source_read_checks where id=r.source_read_check_id and user_id=inv.user_id;
 select * into req from public.external_invoice_requests where request_id=r.id and user_id=inv.user_id;
 if r.id is null or fact.id is null or proof.id is null or req.request_id is null or fact.kind<>'invoice' or fact.state<>'verified' or not fact.human_read_original
 or inv.source_fact_family_id is distinct from fact.family_id or inv.currency is distinct from fact.data->>'currency' or inv.original_total_minor is distinct from(fact.data->>'original_total_minor')::bigint
 or inv.number is distinct from fact.data->>'invoice_reference' or inv.invoice_date is distinct from(fact.data->>'invoice_date')::date
 or r.source_fact_revision_id is distinct from fact.id or r.source_snapshot is distinct from fact.source_snapshot
 or proof.fact_revision_id is distinct from fact.id or proof.source_snapshot is distinct from fact.source_snapshot or proof.outcome<>'verified'
 or proof.intent->>'schema_version' is distinct from 'invoice-source-read-intent/2' or proof.intent->'capture_intent' is distinct from req.intent
 or req.source_read_check_id is distinct from proof.id or r.author is distinct from inv.user_id
 or r.snapshot is distinct from jsonb_build_object('schema_version','preserved-external-invoice/1','invoice_id',inv.id,'client_id',inv.client_id,'external_revision',inv.external_revision,'number',inv.number,'invoice_date',inv.invoice_date,'currency',inv.currency,'original_total_minor',inv.original_total_minor,'source_fact_revision_id',fact.id,'source_fact_family_id',fact.family_id,'confirmed_updated_at',inv.updated_at)
 then raise exception 'External invoice source/history closure failed.';end if;
 if tg_table_name='invoice_revisions' then
  if new.origin<>'preserved_external' then raise exception 'External parents require positive sourced history only.';end if;
  if new.origin='preserved_external' then perform public.validate_external_invoice_revision(new.id,new.user_id);end if;
 end if;
 perform public.validate_external_invoice_revision(r.id,inv.user_id);
 return null;
end;$$;
revoke all on function public.validate_external_invoice_history() from public,anon,authenticated,service_role;
create constraint trigger external_invoice_history_closed after insert or update on public.invoices deferrable initially deferred for each row execute function public.validate_external_invoice_history();
create constraint trigger external_revision_history_closed after insert on public.invoice_revisions deferrable initially deferred for each row execute function public.validate_external_invoice_history();

create function public.capture_external_invoice(p_intent jsonb,p_check uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();i jsonb;prior public.external_invoice_requests;inv public.invoices;fact public.fx_document_fact_revisions;previous_fact public.fx_document_fact_revisions;proof public.invoice_source_read_checks;
 rid uuid;iid uuid;cid uuid;fid uuid;family uuid;expected integer;version_no integer;result jsonb;snapshot jsonb;payload text;
begin
 if owner_id is null then raise exception 'Sign in to review external invoices.';end if;
 i:=public.validate_external_invoice_intent(p_intent);rid:=(i->>'request_id')::uuid;iid:=(i->>'invoice_id')::uuid;cid:=(i->>'client_id')::uuid;fid:=(i->>'source_fact_revision_id')::uuid;family:=(i->>'source_fact_family_id')::uuid;expected:=(i->>'expected_revision')::integer;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 select * into prior from public.external_invoice_requests where user_id=owner_id and request_id=rid;
 if found then
  if prior.intent is distinct from i or prior.source_read_check_id is distinct from p_check then raise exception 'External invoice request changed.';end if;return prior.result;
 end if;
 -- Self-exclusive source table lock avoids SHARE-to-INSERT upgrades between competing owners.
 lock table public.invoices in share row exclusive mode nowait;
 lock table public.clients,public.fx_document_fact_families,public.fx_document_fact_revisions,public.evidence_documents,public.document_batches,public.document_batch_items,storage.objects in share mode nowait;
 if public.external_invoice_review_stamp() is distinct from i->>'expected_stamp' then raise exception 'External invoice context changed.';end if;
 select * into fact from public.fx_document_fact_revisions where id=fid and user_id=owner_id and family_id=family and kind='invoice' and state='verified';
 if not found or not fact.human_read_original or fact.id is distinct from(select r.id from public.fx_document_fact_revisions r where r.family_id=family and r.user_id=owner_id order by r.ordinal desc limit 1)
 or not public.fx_document_fact_source_current(fact.id,owner_id) or public.fx_document_source(owner_id,fact.document_id,true) is distinct from fact.source_snapshot->'document_source'
 or fact.source_snapshot#>>'{document_source,document,file_sha256}' is distinct from i->>'original_sha256' then raise exception 'Current verified original required.';end if;
 perform public.validate_fx_document_fact_data('invoice',fact.data);
 if not exists(select 1 from public.clients where id=cid and user_id=owner_id) then raise exception 'Owned client required.';end if;
 select * into proof from public.invoice_source_read_checks where id=p_check and user_id=owner_id;
 if not found or proof.outcome<>'verified' or proof.fact_revision_id<>fact.id or proof.document_id<>fact.document_id or proof.source_snapshot is distinct from fact.source_snapshot
 or proof.checked_at<statement_timestamp()-interval '5 minutes' or proof.checked_at>statement_timestamp()
 or proof.intent is distinct from jsonb_build_object('schema_version','invoice-source-read-intent/2','request_id',rid,'fact_revision_id',fact.id,'reason',i->>'reason','capture_intent',i) then raise exception 'Fresh capture-bound private source check required.';end if;
 select * into inv from public.invoices where id=iid and user_id=owner_id for update;
 if expected=0 then
  if inv.id is not null or exists(select 1 from public.invoices where user_id=owner_id and source_fact_family_id=family) then raise exception 'Use the existing canonical invoice family.';end if;
 else
  if inv.id is null or inv.origin<>'preserved_external' or inv.external_revision<>expected or inv.updated_at is distinct from(i->>'expected_updated_at')::timestamptz or inv.source_fact_family_id<>family then raise exception 'External invoice revision changed.';end if;
  select * into previous_fact from public.fx_document_fact_revisions where id=inv.source_fact_revision_id and user_id=owner_id;
  if previous_fact.id is null or fact.ordinal<=previous_fact.ordinal then raise exception 'Review a verified successor in the same source family.';end if;
  if exists(select 1 from public.invoice_settlements where invoice_id=iid and user_id=owner_id) or exists(select 1 from public.invoice_credit_notes where invoice_id=iid and user_id=owner_id) or exists(select 1 from public.invoice_refund_assignments where invoice_id=iid and user_id=owner_id) or exists(select 1 from public.financial_records where invoice_id=iid and user_id=owner_id) then raise exception 'Financial history needs a dimensioned correction.';end if;
 end if;
 version_no:=expected+1;
 if expected=0 then
  insert into public.invoices(id,user_id,client_id,number,invoice_date,description,amount,payment_terms,status,finalised_at,origin,currency,original_total_minor,currency_ruleset_id,source_fact_revision_id,source_fact_family_id,external_revision)
  values(iid,owner_id,cid,fact.data->>'invoice_reference',(fact.data->>'invoice_date')::date,'Preserved external invoice',null,'Preserved document; no native delivery terms','finalised',now(),'preserved_external',fact.data->>'currency',(fact.data->>'original_total_minor')::bigint,fact.ruleset_id,fact.id,fact.family_id,version_no) returning * into inv;
 else
  update public.invoices set client_id=cid,number=fact.data->>'invoice_reference',invoice_date=(fact.data->>'invoice_date')::date,currency=fact.data->>'currency',original_total_minor=(fact.data->>'original_total_minor')::bigint,source_fact_revision_id=fact.id,external_revision=version_no where id=iid and user_id=owner_id returning * into inv;
 end if;
 snapshot:=jsonb_build_object('schema_version','preserved-external-invoice/1','invoice_id',inv.id,'client_id',inv.client_id,'external_revision',version_no,'number',inv.number,'invoice_date',inv.invoice_date,'currency',inv.currency,'original_total_minor',inv.original_total_minor,'source_fact_revision_id',fact.id,'source_fact_family_id',fact.family_id,'confirmed_updated_at',inv.updated_at);
 payload:=encode(sha256(convert_to(i::text,'UTF8')),'hex');
 insert into public.invoice_revisions(id,user_id,invoice_id,version,snapshot,request_hash,author,origin,source_fact_revision_id,source_snapshot,source_read_check_id) values(rid,owner_id,iid,version_no,snapshot,payload,owner_id,'preserved_external',fact.id,fact.source_snapshot,proof.id);
 result:=jsonb_build_object('schema_version','external-invoice-result/1','invoice_id',iid,'revision_id',rid,'external_revision',version_no,'source_fact_revision_id',fact.id,'recognized_income_change_pence',0,'recognized_expense_change_pence',0,'settlement_change',0);
 insert into public.external_invoice_requests(user_id,request_id,intent,source_read_check_id,result) values(owner_id,rid,i,proof.id,result);
 return result;
end;$$;
revoke all on function public.capture_external_invoice(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.capture_external_invoice(jsonb,uuid) to authenticated;

create or replace function public.record_invoice_source_read(p_owner uuid,p_intent jsonb,p_source jsonb,p_outcome text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior public.invoice_source_read_checks; fact public.fx_document_fact_revisions; rid uuid; fid uuid; result public.invoice_source_read_checks; normalized jsonb;capture jsonb;extended boolean;
begin
 extended:=p_intent->>'schema_version'='invoice-source-read-intent/2';
 if p_owner is null or jsonb_typeof(p_intent) is distinct from 'object' or octet_length(p_intent::text)>(case when extended then 16000 else 5000 end)
 or(select count(*) from jsonb_object_keys(p_intent))<>(case when extended then 5 else 4 end) or not(p_intent ?& array['schema_version','request_id','fact_revision_id','reason'])
 or p_intent->>'schema_version' not in('invoice-source-read-intent/1','invoice-source-read-intent/2') or p_intent->>'schema_version' is null
 or jsonb_typeof(p_intent->'reason') is distinct from 'string' or length(btrim(p_intent->>'reason')) not between 1 and 1000
 or p_outcome is null or p_outcome not in('verified','unavailable') then raise exception 'Review a bounded invoice source check.';end if;
 rid:=public.fx_fact_uuid(p_intent->'request_id',false);fid:=public.fx_fact_uuid(p_intent->'fact_revision_id',false);
 normalized:=p_intent||jsonb_build_object('request_id',rid,'fact_revision_id',fid,'reason',btrim(p_intent->>'reason'));
 if extended then
  capture:=public.validate_external_invoice_intent(p_intent->'capture_intent');
  if capture->>'request_id'<>rid::text or capture->>'source_fact_revision_id'<>fid::text or capture->>'reason'<>normalized->>'reason' then raise exception 'Capture-bound source intent differs.';end if;
  normalized:=normalized||jsonb_build_object('capture_intent',capture);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('invoice-source-read:'||p_owner::text,0));
 select * into prior from public.invoice_source_read_checks where user_id=p_owner and request_id=rid;
 if found then
  if prior.intent is distinct from normalized or prior.source_snapshot is distinct from p_source or prior.outcome<>p_outcome then raise exception 'Source check request changed.';end if;
  return to_jsonb(prior);
 end if;
 -- Exclude registration/object phantoms between the final check and audit insertion.
 lock table public.fx_document_fact_families,public.fx_document_fact_revisions,public.evidence_documents,public.document_batches,public.document_batch_items,storage.objects in share mode nowait;
 select * into fact from public.fx_document_fact_revisions where id=fid and user_id=p_owner and kind='invoice';
 if not found or fact.source_snapshot is distinct from p_source then raise exception 'Owned invoice source unavailable.';end if;
 if p_outcome='verified' and(fact.state<>'verified' or not fact.human_read_original
  or fact.id is distinct from(select r.id from public.fx_document_fact_revisions r where r.family_id=fact.family_id and r.user_id=p_owner order by r.ordinal desc limit 1)
  or not public.fx_document_fact_source_current(fact.id,p_owner)
  or public.fx_document_source(p_owner,fact.document_id,true) is distinct from fact.source_snapshot->'document_source') then raise exception 'Current verified invoice source changed.';end if;
 insert into public.invoice_source_read_checks(user_id,request_id,intent,fact_revision_id,document_id,source_snapshot,outcome,author)
 values(p_owner,rid,normalized,fact.id,fact.document_id,fact.source_snapshot,p_outcome,p_owner) returning * into result;
 return to_jsonb(result);
end;$$;
revoke all on function public.record_invoice_source_read(uuid,jsonb,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.record_invoice_source_read(uuid,jsonb,jsonb,text) to service_role;

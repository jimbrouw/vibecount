-- Reviewed FX evidence preparation only. No canonical invoices, matches or postings.
create table public.fx_document_fact_requests (
 user_id uuid not null references auth.users(id),request_id uuid not null,payload_hash text not null,result jsonb not null,
 created_at timestamptz not null default now(),primary key(user_id,request_id)
);
create table public.fx_document_fact_families (
 id uuid primary key,user_id uuid not null references auth.users(id),kind text not null check(kind in('invoice','conversion')),
 created_at timestamptz not null default now(),unique(id,user_id),unique(id,user_id,kind)
);
create table public.fx_document_fact_revisions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),family_id uuid not null,
 kind text not null check(kind in('invoice','conversion')),ordinal integer not null check(ordinal>0),state text not null check(state in('provisional','verified','withdrawn')),
 ruleset_id text not null references public.fx_currency_rulesets(id),document_id uuid not null,
 invoice_evidence_revision_id uuid,transaction_id uuid,transaction_version integer check(transaction_version between 0 and 2147483647),
 data jsonb not null check(jsonb_typeof(data)='object'),source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='object'),
 reviewed_stamp text not null,rationale text not null check(length(btrim(rationale)) between 1 and 1000),
 human_read_original boolean not null,author uuid not null references auth.users(id),request_id uuid not null,
 created_at timestamptz not null default now(),unique(id,user_id),unique(family_id,user_id,ordinal),
 foreign key(family_id,user_id,kind) references public.fx_document_fact_families(id,user_id,kind),
 foreign key(document_id,user_id) references public.evidence_documents(id,user_id),
 foreign key(invoice_evidence_revision_id,user_id) references public.fx_document_fact_revisions(id,user_id),
 foreign key(transaction_id,user_id) references public.bank_transactions(id,user_id),
 foreign key(user_id,request_id) references public.fx_document_fact_requests(user_id,request_id) deferrable initially deferred,
 check(state<>'verified' or human_read_original),check(state<>'withdrawn' or not human_read_original),
 check((kind='invoice' and invoice_evidence_revision_id is null and transaction_id is null and transaction_version is null)
  or(kind='conversion' and invoice_evidence_revision_id is not null and transaction_id is not null and transaction_version is not null))
);
alter table public.fx_document_fact_requests enable row level security;
alter table public.fx_document_fact_families enable row level security;
alter table public.fx_document_fact_revisions enable row level security;
revoke all on public.fx_document_fact_requests,public.fx_document_fact_families,public.fx_document_fact_revisions from public,anon,authenticated,service_role;
grant select on public.fx_document_fact_requests,public.fx_document_fact_families,public.fx_document_fact_revisions to authenticated,service_role;
create policy fx_fact_requests_owner_read on public.fx_document_fact_requests for select to authenticated using(user_id=(select auth.uid()));
create policy fx_fact_families_owner_read on public.fx_document_fact_families for select to authenticated using(user_id=(select auth.uid()));
create policy fx_fact_revisions_owner_read on public.fx_document_fact_revisions for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_fx_fact_requests before update or delete on public.fx_document_fact_requests for each row execute function public.reject_source_mutation();
create trigger immutable_fx_fact_families before update or delete on public.fx_document_fact_families for each row execute function public.reject_source_mutation();
create trigger immutable_fx_fact_revisions before update or delete on public.fx_document_fact_revisions for each row execute function public.reject_source_mutation();
create index fx_fact_revisions_latest on public.fx_document_fact_revisions(user_id,family_id,ordinal desc);
create index fx_fact_revisions_invoice_source on public.fx_document_fact_revisions(invoice_evidence_revision_id,user_id);
create index fx_fact_revisions_receipt on public.fx_document_fact_revisions(transaction_id,user_id);

create function public.fx_document_source(p_owner uuid,p_document uuid,p_invoice_scope boolean) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('document',jsonb_build_object('id',d.id,'file_sha256',d.file_hash,'media_type',d.media_type,'size_bytes',d.size_bytes),
  'available',exists(select 1 from storage.objects o where o.bucket_id='document-evidence' and o.name=d.object_path),
  'invoice_scope',exists(select 1 from public.document_batch_items i join public.document_batches b on b.id=i.batch_id and b.user_id=i.user_id where i.document_id=d.id and i.user_id=d.user_id and b.purpose='invoice'),
  'registration',jsonb_build_object('item_id',s.id,'batch_id',s.batch_id,'ordinal',s.ordinal,'purpose',s.purpose,'tax_year_start',s.tax_year_start))
 from public.evidence_documents d join lateral(
  select i.id,i.batch_id,i.ordinal,b.purpose,b.tax_year_start from public.document_batch_items i join public.document_batches b on b.id=i.batch_id and b.user_id=i.user_id
  where i.document_id=d.id and i.user_id=d.user_id and(not p_invoice_scope or b.purpose='invoice') order by i.id limit 1
 ) s on true where d.id=p_document and d.user_id=p_owner and d.media_type in('application/pdf','image/png','image/jpeg');
$$;
revoke all on function public.fx_document_source(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create function public.fx_document_fact_source_current(p_revision uuid,p_owner uuid) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare r public.fx_document_fact_revisions;parent public.fx_document_fact_revisions;doc jsonb;tx public.bank_transactions;
begin
 select * into r from public.fx_document_fact_revisions where id=p_revision and user_id=p_owner;
 if not found then return false;end if;
 doc:=public.fx_document_source(p_owner,r.document_id,r.kind='invoice');
 if doc is null or(doc->>'available')::boolean is distinct from true or doc->'document' is distinct from r.source_snapshot->'document_source'->'document' then return false;end if;
 if not exists(select 1 from public.document_batch_items i join public.document_batches b on b.id=i.batch_id and b.user_id=i.user_id
  where i.id=(r.source_snapshot->'document_source'->'registration'->>'item_id')::uuid and i.user_id=p_owner and i.document_id=r.document_id and(r.kind<>'invoice' or b.purpose='invoice')) then return false;end if;
 if r.kind='invoice' then return true;end if;
 select * into parent from public.fx_document_fact_revisions where id=r.invoice_evidence_revision_id and user_id=p_owner and kind='invoice';
 if not found or parent.state<>'verified' or parent.id is distinct from(select x.id from public.fx_document_fact_revisions x where x.user_id=p_owner and x.family_id=parent.family_id order by x.ordinal desc limit 1)
  or not public.fx_document_fact_source_current(parent.id,p_owner) then return false;end if;
 select t.* into tx from public.bank_transactions t join public.record_imports i on i.id=t.import_id and i.user_id=t.user_id
  where t.id=r.transaction_id and t.user_id=p_owner and t.currency='GBP' and t.signed_amount_pence>0 and i.status in('review','committed');
 if not found or tx.decision_version is distinct from r.transaction_version then return false;end if;
 return tx.source_row_id::text is not distinct from r.source_snapshot->'receipt'->>'source_row_id'
  and tx.import_id::text is not distinct from r.source_snapshot->'receipt'->>'import_id'
  and tx.transaction_date::text is not distinct from r.source_snapshot->'receipt'->>'transaction_date'
  and tx.signed_amount_pence::text is not distinct from r.source_snapshot->'receipt'->>'signed_amount_pence';
end;$$;
revoke all on function public.fx_document_fact_source_current(uuid,uuid) from public,anon,authenticated,service_role;

create function public.fx_evidence_review_stamp() returns text
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();result text;
begin
 if owner_id is null then raise exception 'Sign in to review FX evidence.';end if;
 select md5(public.reconciliation_export_stamp()||'|'||
  coalesce((select string_agg(f.id::text||':'||f.kind,',' order by f.id) from public.fx_document_fact_families f where f.user_id=owner_id),'')||'|'||
  coalesce((select string_agg(r.id::text||':'||r.ordinal::text,',' order by r.id) from public.fx_document_fact_revisions r where r.user_id=owner_id),'')||'|'||
  coalesce((select string_agg(d.id::text||':'||d.file_hash||':'||(exists(select 1 from storage.objects o where o.bucket_id='document-evidence' and o.name=d.object_path))::text,',' order by d.id) from public.evidence_documents d where d.user_id=owner_id),'')||'|'||
  coalesce((select string_agg(i.id::text||':'||b.purpose||':'||b.tax_year_start::text,',' order by i.id) from public.document_batch_items i join public.document_batches b on b.id=i.batch_id and b.user_id=i.user_id where i.user_id=owner_id),'')) into result;
 return result;
end;$$;
revoke all on function public.fx_evidence_review_stamp() from public,anon,service_role;
grant execute on function public.fx_evidence_review_stamp() to authenticated;

create function public.read_fx_evidence_catalog() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();documents jsonb;receipts jsonb;facts jsonb;document_count integer;receipt_count integer;family_count integer;fact_count integer;
begin
 if owner_id is null then raise exception 'Sign in to review FX evidence.';end if;
 select count(*) into document_count from public.evidence_documents d where d.user_id=owner_id and d.media_type in('application/pdf','image/png','image/jpeg')
  and exists(select 1 from public.document_batch_items i where i.user_id=owner_id and i.document_id=d.id);
 select count(*) into receipt_count from public.bank_transactions where user_id=owner_id and currency='GBP' and signed_amount_pence>0;
 select count(*) into family_count from public.fx_document_fact_families where user_id=owner_id;
 if greatest(document_count,receipt_count,family_count)>10000 then raise exception 'Complete FX evidence review exceeds the safe catalog limit.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'source',public.fx_document_source(owner_id,d.id,false)) order by d.id),'[]') into documents
  from public.evidence_documents d where d.user_id=owner_id and d.media_type in('application/pdf','image/png','image/jpeg') and exists(select 1 from public.document_batch_items i where i.user_id=owner_id and i.document_id=d.id);
 select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') into receipts from(
  select t.id,t.user_id,t.import_id,t.source_row_id,t.transaction_date,t.signed_amount_pence,t.currency,t.decision_version,t.classification,t.dedupe_status,t.active_transfer_id,t.active_refund_id,i.status import_status
  from public.bank_transactions t join public.record_imports i on i.id=t.import_id and i.user_id=t.user_id where t.user_id=owner_id and t.currency='GBP' and t.signed_amount_pence>0
 ) s;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'family_id',s.family_id,'kind',s.kind,'ordinal',s.ordinal,'state',s.state,'ruleset_id',s.ruleset_id,
  'document_id',s.document_id,'invoice_evidence_revision_id',s.invoice_evidence_revision_id,'transaction_id',s.transaction_id,'transaction_version',s.transaction_version,
  'data',s.data,'source_snapshot',s.source_snapshot,'human_read_original',s.human_read_original,'source_current',public.fx_document_fact_source_current(s.id,owner_id),
  'usable',s.state='verified' and public.fx_document_fact_source_current(s.id,owner_id)) order by s.family_id),'[]'),count(*) into facts,fact_count
 from(select distinct on(r.family_id) r.* from public.fx_document_fact_revisions r where r.user_id=owner_id order by r.family_id,r.ordinal desc) s;
 if fact_count<>family_count or jsonb_array_length(documents)<>document_count or jsonb_array_length(receipts)<>receipt_count then raise exception 'Complete FX evidence source context unavailable.';end if;
 return jsonb_build_object('schema_version','fx-evidence-catalog/1','owner_id',owner_id,'ruleset_id','vibecount-currencies/1','stamp',public.fx_evidence_review_stamp(),
  'counts',jsonb_build_object('documents',document_count,'receipts',receipt_count,'facts',fact_count),'documents',documents,'receipts',receipts,'facts',facts,'financial_action','evidence_preparation_only');
end;$$;
revoke all on function public.read_fx_evidence_catalog() from public,anon,service_role;
grant execute on function public.read_fx_evidence_catalog() to authenticated;

create function public.validate_fx_document_fact_data(p_kind text,p_data jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare k text;d date;rate jsonb;portion bigint;cash bigint;converted jsonb;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Review typed FX document facts.';end if;
 if p_kind='invoice' then
  if(select count(*) from jsonb_object_keys(p_data))<>4 or not(p_data ?& array['currency','original_total_minor','invoice_date','invoice_reference']) then raise exception 'Review exact invoice fact fields.';end if;
  if jsonb_typeof(p_data->'currency') is distinct from 'string' then raise exception 'Review invoice currency.';end if;
  perform public.fx_currency_scale(p_data->>'currency','vibecount-currencies/1');
  if jsonb_typeof(p_data->'original_total_minor') is distinct from 'number' or p_data->>'original_total_minor' !~ '^[1-9][0-9]{0,11}$' then raise exception 'Review positive exact original minor units.';end if;
  if jsonb_typeof(p_data->'invoice_reference') is distinct from 'string' or p_data->>'invoice_reference' !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$' or length(p_data->>'invoice_reference')>80 then raise exception 'Review a bounded invoice reference without private free text.';end if;
  k:='invoice_date';
 elsif p_kind='conversion' then
  if(select count(*) from jsonb_object_keys(p_data))<>6 or not(p_data ?& array['rate','conversion_date','evidence_date','invoice_portion_minor','gbp_cash_portion_pence','fee_mode']) then raise exception 'Review exact conversion fact fields.';end if;
  if p_data->>'fee_mode' is distinct from 'none' or jsonb_typeof(p_data->'fee_mode') is distinct from 'string' then raise exception 'Fees and gross-up require separate supported review.';end if;
  if jsonb_typeof(p_data->'invoice_portion_minor') is distinct from 'number' or p_data->>'invoice_portion_minor' !~ '^[1-9][0-9]{0,11}$'
   or jsonb_typeof(p_data->'gbp_cash_portion_pence') is distinct from 'number' or p_data->>'gbp_cash_portion_pence' !~ '^(0|[1-9][0-9]{0,11})$' then raise exception 'Review exact source and cash portions.';end if;
  portion:=(p_data->>'invoice_portion_minor')::bigint;cash:=(p_data->>'gbp_cash_portion_pence')::bigint;
  converted:=public.fx_convert_minor(portion,p_data->'rate','vibecount-currencies/1');
  if converted->'rate'->>'target_currency'<>'GBP' or(converted->>'target_minor')::bigint<>cash then raise exception 'Review explicit original to GBP conversion; resolve differences separately.';end if;
  p_data:=jsonb_set(p_data,'{rate}',converted->'rate');k:='conversion_date';
 else raise exception 'Choose invoice or conversion facts.';end if;
 if jsonb_typeof(p_data->k) is distinct from 'string' or length(p_data->>k)<>10 or p_data->>k !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Review exact calendar dates.';end if;
 d:=(p_data->>k)::date;if d<date '1900-01-01' or d>date '9998-12-31' then raise exception 'Review a supported date.';end if;
 if p_kind='conversion' then
  if jsonb_typeof(p_data->'evidence_date') is distinct from 'string' or length(p_data->>'evidence_date')<>10 or p_data->>'evidence_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Review an evidence calendar date.';end if;
  d:=(p_data->>'evidence_date')::date;if d<date '1900-01-01' or d>date '9998-12-31' then raise exception 'Review a supported evidence date.';end if;
 end if;
 return p_data;
end;$$;
revoke all on function public.validate_fx_document_fact_data(text,jsonb) from public,anon,authenticated,service_role;

create function public.fx_fact_uuid(p_value jsonb,p_nullable boolean) returns uuid
language plpgsql immutable security invoker set search_path='' as $$
begin
 if p_nullable and p_value='null'::jsonb then return null;end if;
 if jsonb_typeof(p_value) is distinct from 'string' or length(p_value#>>'{}')<>36 or p_value#>>'{}' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then raise exception 'Review an exact owned evidence identity.';end if;
 return(p_value#>>'{}')::uuid;
end;$$;
revoke all on function public.fx_fact_uuid(jsonb,boolean) from public,anon,authenticated,service_role;

create function public.review_fx_document_evidence(p_intent jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<fx_review>>
declare owner_id uuid:=auth.uid();family_id uuid;request_id uuid;doc_id uuid;parent_id uuid;tx_id uuid;tx_version integer;expected integer;
 fact_kind text;fact_state text;reason text;reviewed_stamp text;attested boolean;data jsonb;payload text;prior public.fx_document_fact_requests;
 family public.fx_document_fact_families;previous public.fx_document_fact_revisions;parent public.fx_document_fact_revisions;tx public.bank_transactions;
 doc jsonb;source jsonb;revision uuid:=gen_random_uuid();result jsonb;financial_before text;doc_ids uuid[];
begin
 if owner_id is null then raise exception 'Sign in to review FX document facts.';end if;
 if jsonb_typeof(p_intent) is distinct from 'object' then raise exception 'Review an exact FX evidence intent.';end if;
 if(select count(*) from jsonb_object_keys(p_intent))<>15 or not(p_intent ?& array['schema_version','ruleset_id','family_id','expected_ordinal','kind','state','document_id','invoice_evidence_revision_id','transaction_id','transaction_version','data','human_read_original','expected_stamp','rationale','request_id']) then raise exception 'Review exact FX evidence fields.';end if;
 if p_intent->>'schema_version' is distinct from 'fx-document-fact-intent/1' or p_intent->>'ruleset_id' is distinct from 'vibecount-currencies/1' then raise exception 'Review supported evidence and currency rules.';end if;
 family_id:=public.fx_fact_uuid(p_intent->'family_id',false);request_id:=public.fx_fact_uuid(p_intent->'request_id',false);
 doc_id:=public.fx_fact_uuid(p_intent->'document_id',true);parent_id:=public.fx_fact_uuid(p_intent->'invoice_evidence_revision_id',true);tx_id:=public.fx_fact_uuid(p_intent->'transaction_id',true);
 if jsonb_typeof(p_intent->'expected_ordinal') is distinct from 'number' or p_intent->>'expected_ordinal' !~ '^(0|[1-9][0-9]{0,9})$' or(p_intent->>'expected_ordinal')::numeric>2147483646 then raise exception 'Review the expected evidence ordinal.';end if;
 expected:=(p_intent->>'expected_ordinal')::integer;fact_kind:=p_intent->>'kind';fact_state:=p_intent->>'state';reason:=btrim(p_intent->>'rationale');reviewed_stamp:=p_intent->>'expected_stamp';
 if fact_kind is null or fact_kind not in('invoice','conversion') or fact_state is null or fact_state not in('provisional','verified','withdrawn')
  or jsonb_typeof(p_intent->'rationale') is distinct from 'string' or reason is null or length(reason) not between 1 and 1000
  or jsonb_typeof(p_intent->'expected_stamp') is distinct from 'string' or length(reviewed_stamp)<>32 or reviewed_stamp !~ '^[a-f0-9]{32}$'
  or jsonb_typeof(p_intent->'human_read_original') is distinct from 'boolean' then raise exception 'Review typed evidence state, context and reason.';end if;
 attested:=(p_intent->>'human_read_original')::boolean;
 if fact_state='verified' and not attested then raise exception 'A human must check the original document before verifying these facts.';end if;
 if fact_state='withdrawn' then
  if attested or doc_id is not null or parent_id is not null or tx_id is not null or p_intent->'transaction_version'<>'null'::jsonb or p_intent->'data'<>'null'::jsonb then raise exception 'Withdrawal retains the old exact evidence snapshot.';end if;
  data:=null;
 else
  if doc_id is null then raise exception 'Choose an owned registered evidence item.';end if;
  data:=public.validate_fx_document_fact_data(fact_kind,p_intent->'data');
  if fact_kind='invoice' then
   if parent_id is not null or tx_id is not null or p_intent->'transaction_version'<>'null'::jsonb then raise exception 'Invoice facts do not classify a receipt.';end if;
  else
   if parent_id is null or tx_id is null or jsonb_typeof(p_intent->'transaction_version') is distinct from 'number'
    or p_intent->>'transaction_version' !~ '^(0|[1-9][0-9]{0,9})$' or(p_intent->>'transaction_version')::numeric>2147483647 then raise exception 'Pin the exact invoice evidence and receipt version.';end if;
   tx_version:=(p_intent->>'transaction_version')::integer;
  end if;
 end if;
 -- Canonical intent preserves stable retries despite UUID case or rational reduction.
 p_intent:=p_intent||jsonb_build_object('family_id',family_id,'request_id',request_id,'document_id',doc_id,'invoice_evidence_revision_id',parent_id,'transaction_id',tx_id,'transaction_version',tx_version,'expected_ordinal',expected,'rationale',reason,'data',data);
 payload:=encode(sha256(convert_to(jsonb_build_object('method','review_fx_document_evidence/1','intent',p_intent-'request_id')::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 select * into prior from public.fx_document_fact_requests where user_id=owner_id and fx_document_fact_requests.request_id=fx_review.request_id;
 if found then if prior.payload_hash<>payload then raise exception 'FX evidence request changed.';end if;return prior.result;end if;
 if public.fx_evidence_review_stamp() is distinct from reviewed_stamp then raise exception 'FX evidence or financial context changed. Review again.';end if;
 financial_before:=public.reconciliation_export_stamp();
 select * into family from public.fx_document_fact_families where id=family_id and user_id=owner_id;
 if family.id is not null and family.kind<>fact_kind then raise exception 'Preserve the evidence family kind.';end if;
 select * into previous from public.fx_document_fact_revisions r where r.family_id=fx_review.family_id and r.user_id=owner_id order by r.ordinal desc limit 1;
 if coalesce(previous.ordinal,0)<>expected then raise exception 'Evidence family revision changed.';end if;
 if fact_state='withdrawn' then
  if previous.id is null then raise exception 'Choose existing evidence to withdraw.';end if;
  doc_id:=previous.document_id;parent_id:=previous.invoice_evidence_revision_id;tx_id:=previous.transaction_id;tx_version:=previous.transaction_version;data:=previous.data;source:=previous.source_snapshot;
 else
  if fact_kind='conversion' then
   select * into parent from public.fx_document_fact_revisions where id=parent_id and user_id=owner_id and kind='invoice' and state='verified';
   if parent.id is null or parent.id is distinct from(select r.id from public.fx_document_fact_revisions r where r.user_id=owner_id and r.family_id=parent.family_id order by r.ordinal desc limit 1) then raise exception 'Choose the current verified invoice facts.';end if;
  end if;
  perform 1 from public.fx_document_fact_families f where f.user_id=owner_id and f.id in(family_id,parent.family_id) order by f.id for update;
  doc_ids:=array[doc_id];if parent.id is not null then doc_ids:=array_append(doc_ids,parent.document_id);end if;
  perform 1 from public.evidence_documents d where d.user_id=owner_id and d.id=any(doc_ids) order by d.id for share;
  perform 1 from storage.objects o join public.evidence_documents d on o.bucket_id='document-evidence' and o.name=d.object_path where d.user_id=owner_id and d.id=any(doc_ids) order by o.id for share of o;
  if tx_id is not null then perform 1 from public.bank_transactions t where t.id=tx_id and t.user_id=owner_id for update;end if;
  if public.fx_evidence_review_stamp() is distinct from reviewed_stamp then raise exception 'FX evidence or financial context changed after source locks.';end if;
  doc:=public.fx_document_source(owner_id,doc_id,fact_kind='invoice');
  if doc is null or(doc->>'available')::boolean is distinct from true then raise exception 'Preserve an owned registered PDF or image before fact review.';end if;
  source:=jsonb_build_object('document_source',doc);
  if fact_kind='conversion' then
   if not public.fx_document_fact_source_current(parent.id,owner_id) then raise exception 'Invoice evidence source is unavailable or changed.';end if;
   select t.* into tx from public.bank_transactions t join public.record_imports i on i.id=t.import_id and i.user_id=t.user_id
    where t.id=tx_id and t.user_id=owner_id and t.currency='GBP' and t.signed_amount_pence>0 and i.status in('review','committed');
   if tx.id is null or tx.decision_version<>tx_version then raise exception 'Review the current owned positive GBP receipt.';end if;
   if data->'rate'->>'source_currency' is distinct from parent.data->>'currency' or(data->>'invoice_portion_minor')::bigint>(parent.data->>'original_total_minor')::bigint
    or(data->>'gbp_cash_portion_pence')::bigint>tx.signed_amount_pence then raise exception 'Document portions exceed the invoice or observed cash.';end if;
   source:=source||jsonb_build_object('invoice_evidence',jsonb_build_object('id',parent.id,'family_id',parent.family_id,'ordinal',parent.ordinal,'data',parent.data,'document_id',parent.document_id),
    'receipt',jsonb_build_object('id',tx.id,'import_id',tx.import_id,'source_row_id',tx.source_row_id,'transaction_date',tx.transaction_date,'signed_amount_pence',tx.signed_amount_pence,'currency',tx.currency,'decision_version',tx.decision_version,'classification',tx.classification,'dedupe_status',tx.dedupe_status));
  end if;
  if fact_state='verified' and fact_kind='invoice' and exists(select 1 from(
    select distinct on(r.family_id) r.* from public.fx_document_fact_revisions r where r.user_id=owner_id and r.kind='invoice' order by r.family_id,r.ordinal desc
   ) s where s.family_id<>fx_review.family_id and s.state='verified' and s.document_id=doc_id and lower(s.data->>'invoice_reference')=lower(fx_review.data->>'invoice_reference')) then raise exception 'Revise the existing reviewed invoice facts for this document reference.';end if;
 end if;
 if family.id is null then insert into public.fx_document_fact_families(id,user_id,kind) values(family_id,owner_id,fact_kind);end if;
 insert into public.fx_document_fact_revisions(id,user_id,family_id,kind,ordinal,state,ruleset_id,document_id,invoice_evidence_revision_id,transaction_id,transaction_version,data,source_snapshot,reviewed_stamp,rationale,human_read_original,author,request_id)
 values(revision,owner_id,family_id,fact_kind,expected+1,fact_state,'vibecount-currencies/1',doc_id,parent_id,tx_id,tx_version,data,source,reviewed_stamp,reason,attested,owner_id,request_id);
 if public.reconciliation_export_stamp() is distinct from financial_before then raise exception 'Evidence preparation must not change financial state.';end if;
 result:=jsonb_build_object('family_id',family_id,'revision_id',revision,'ordinal',expected+1,'state',fact_state,'kind',fact_kind,'financial_action','evidence_preparation_only','recognized_income_change_pence',0,'recognized_expense_change_pence',0,'canonical_invoice_change',0,'settlement_change',0);
 insert into public.fx_document_fact_requests(user_id,request_id,payload_hash,result) values(owner_id,request_id,payload,result);
 return result;
end;$$;
revoke all on function public.review_fx_document_evidence(jsonb) from public,anon,service_role;
grant execute on function public.review_fx_document_evidence(jsonb) to authenticated;

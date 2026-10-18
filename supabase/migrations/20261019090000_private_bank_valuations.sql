-- Stage-C persistence prerequisite only: existing GBP admission constraints remain CLOSED.
alter table public.bank_transactions
 add column original_signed_minor bigint,
 add column source_units_ruleset text references public.fx_currency_rulesets(id),
 add constraint bank_transaction_currency_representation check(
  (currency='GBP' and signed_amount_pence is not null and original_signed_minor is null and source_units_ruleset is null)
  or(currency in('USD','EUR','JPY','KWD') and signed_amount_pence is null
   and original_signed_minor is not null and original_signed_minor<>0
   and original_signed_minor between -999999999999 and 999999999999
   and source_units_ruleset is not null and source_units_ruleset='vibecount-currencies/1'));
-- Preserve function identity and all existing source guards; no backfill or row timestamp changes.
create or replace function public.protect_transaction_source() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Source transactions must be reversed, not deleted.';end if;
 if(new.user_id,new.account_id,new.import_id,new.source_row_id,new.transaction_date,new.signed_amount_pence,new.currency,new.description,new.reference,new.fingerprint,new.original_signed_minor,new.source_units_ruleset)
  is distinct from(old.user_id,old.account_id,old.import_id,old.source_row_id,old.transaction_date,old.signed_amount_pence,old.currency,old.description,old.reference,old.fingerprint,old.original_signed_minor,old.source_units_ruleset)
 then raise exception 'Normalized source facts are immutable.';end if;return new;
end;$$;

create table public.bank_valuation_families(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),transaction_id uuid not null,
 created_at timestamptz not null default now(),unique(id,user_id),unique(user_id,transaction_id),
 foreign key(transaction_id,user_id) references public.bank_transactions(id,user_id));
create table public.bank_valuation_requests(
 user_id uuid not null references auth.users(id),request_id uuid not null,intent jsonb not null,result jsonb not null,
 created_at timestamptz not null default now(),primary key(user_id,request_id),
 check(jsonb_typeof(intent)='object' and octet_length(intent::text)<=16000),
 check(jsonb_typeof(result)='object' and octet_length(result::text)<=64000));
create table public.bank_valuation_revisions(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),family_id uuid not null,
 ordinal integer not null check(ordinal between 1 and 2147483647),previous_revision_id uuid,
 state text not null check(state in('provisional','reviewed','withdrawn')),
 transaction_version integer not null check(transaction_version between 0 and 2147483647),
 ruleset_id text not null references public.fx_currency_rulesets(id),document_id uuid not null,
 data jsonb not null,source_snapshot jsonb not null,conversion jsonb not null,
 signed_gbp_pence bigint not null check(signed_gbp_pence between -999999999999 and 999999999999),
 human_read_original boolean not null,reviewed_stamp text not null check(reviewed_stamp~'^[0-9a-f]{32}$'),
 rationale text not null check(length(btrim(rationale)) between 1 and 1000),author uuid not null references auth.users(id),
 request_id uuid not null,created_at timestamptz not null default now(),unique(id,user_id),unique(family_id,ordinal),
 check(author=user_id),check(state<>'reviewed' or human_read_original),check(state<>'withdrawn' or not human_read_original),
 check((ordinal=1 and previous_revision_id is null) or(ordinal>1 and previous_revision_id is not null)),
 check(jsonb_typeof(data)='object' and jsonb_typeof(source_snapshot)='object' and jsonb_typeof(conversion)='object'),
 check(octet_length(source_snapshot::text)<=16000),
 foreign key(family_id,user_id) references public.bank_valuation_families(id,user_id),
 foreign key(previous_revision_id,user_id) references public.bank_valuation_revisions(id,user_id),
 foreign key(document_id,user_id) references public.evidence_documents(id,user_id),
 foreign key(user_id,request_id) references public.bank_valuation_requests(user_id,request_id) deferrable initially deferred);
create index bank_valuation_latest on public.bank_valuation_revisions(user_id,family_id,ordinal desc);
create unique index bank_valuation_one_request on public.bank_valuation_revisions(user_id,request_id);
alter table public.bank_valuation_families enable row level security;
alter table public.bank_valuation_requests enable row level security;
alter table public.bank_valuation_revisions enable row level security;
revoke all on public.bank_valuation_families,public.bank_valuation_requests,public.bank_valuation_revisions from public,anon,authenticated,service_role;
grant select on public.bank_valuation_families,public.bank_valuation_requests,public.bank_valuation_revisions to authenticated,service_role;
create policy bank_valuation_family_owner_read on public.bank_valuation_families for select to authenticated using(user_id=(select auth.uid()));
create policy bank_valuation_request_owner_read on public.bank_valuation_requests for select to authenticated using(user_id=(select auth.uid()));
create policy bank_valuation_revision_owner_read on public.bank_valuation_revisions for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_bank_valuation_family before update or delete on public.bank_valuation_families for each row execute function public.reject_source_mutation();
create trigger immutable_bank_valuation_request before update or delete on public.bank_valuation_requests for each row execute function public.reject_source_mutation();
create trigger immutable_bank_valuation_revision before update or delete on public.bank_valuation_revisions for each row execute function public.reject_source_mutation();

create function public.validate_bank_valuation_data(p_data jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare c jsonb;d date;e date;
begin
 if jsonb_typeof(p_data) is distinct from 'object' or(select count(*) from jsonb_object_keys(p_data))<>4
  or not(p_data ?& array['method','rate','valuation_date','evidence_date'])
  or jsonb_typeof(p_data->'method') is distinct from 'string' or p_data->>'method'<>'documented_rate/1'
  or jsonb_typeof(p_data->'valuation_date') is distinct from 'string' or p_data->>'valuation_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or jsonb_typeof(p_data->'evidence_date') is distinct from 'string' or p_data->>'evidence_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 then raise exception 'Review exact documented valuation method, rate and dates.';end if;
 d:=(p_data->>'valuation_date')::date;e:=(p_data->>'evidence_date')::date;
 if d not between date '1900-01-01' and date '9998-12-31' or e not between date '1900-01-01' and date '9998-12-31'
 then raise exception 'Review supported valuation dates.';end if;
 c:=public.fx_convert_minor(1,p_data->'rate','vibecount-currencies/1');
 if c->'rate'->>'source_currency'='GBP' or c->'rate'->>'target_currency'<>'GBP' then raise exception 'Review foreign original currency to GBP rate direction.';end if;
 return jsonb_build_object('method','documented_rate/1','rate',c->'rate','valuation_date',d,'evidence_date',e);
end;$$;
revoke all on function public.validate_bank_valuation_data(jsonb) from public,anon,authenticated,service_role;

create function public.validate_bank_valuation_intent(p jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare tx uuid;req uuid;doc uuid;v integer;n integer;s text;reason text;d jsonb;
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>16000 or(select count(*) from jsonb_object_keys(p))<>12
 or not(p ?& array['schema_version','ruleset_id','transaction_id','transaction_version','expected_ordinal','state','document_id','data','human_read_original','expected_stamp','rationale','request_id'])
 or p->>'schema_version' is distinct from 'bank-valuation-intent/1' or p->>'ruleset_id' is distinct from 'vibecount-currencies/1'
 then raise exception 'Review exact supported bank valuation intent.';end if;
 tx:=public.fx_fact_uuid(p->'transaction_id',false);req:=public.fx_fact_uuid(p->'request_id',false);doc:=public.fx_fact_uuid(p->'document_id',true);
 if jsonb_typeof(p->'state') is distinct from 'string' or p->>'state' not in('provisional','reviewed','withdrawn')
 or jsonb_typeof(p->'human_read_original') is distinct from 'boolean'
 or jsonb_typeof(p->'expected_ordinal') is distinct from 'number' or p->>'expected_ordinal' !~ '^(0|[1-9][0-9]{0,9})$' or(p->>'expected_ordinal')::numeric>2147483646
 or jsonb_typeof(p->'expected_stamp') is distinct from 'string' or length(p->>'expected_stamp')<>32 or p->>'expected_stamp' !~ '^[0-9a-f]{32}$'
 or jsonb_typeof(p->'rationale') is distinct from 'string' or length(btrim(p->>'rationale')) not between 1 and 1000
 then raise exception 'Review typed valuation state, version, reason and stamp.';end if;
 s:=p->>'state';n:=(p->>'expected_ordinal')::integer;reason:=btrim(p->>'rationale');
 if s='withdrawn' then
  if doc is not null or p->'data'<>'null'::jsonb or p->'transaction_version'<>'null'::jsonb or(p->>'human_read_original')::boolean
  then raise exception 'Withdrawal copies retained valuation sources.';end if;
 else
  if doc is null or jsonb_typeof(p->'transaction_version') is distinct from 'number'
   or p->>'transaction_version' !~ '^(0|[1-9][0-9]{0,9})$' or(p->>'transaction_version')::numeric>2147483647
   or(s='reviewed' and not(p->>'human_read_original')::boolean) then raise exception 'Review source version, evidence and human original attestation.';end if;
  v:=(p->>'transaction_version')::integer;d:=public.validate_bank_valuation_data(p->'data');
 end if;
 return p||jsonb_build_object('transaction_id',tx,'request_id',req,'document_id',doc,'transaction_version',v,'expected_ordinal',n,'rationale',reason,'data',d);
end;$$;
revoke all on function public.validate_bank_valuation_intent(jsonb) from public,anon,authenticated,service_role;

create function public.bank_valuation_economic_source(p_owner uuid,p_transaction uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare t public.bank_transactions;result jsonb;
begin
 select * into t from public.bank_transactions where user_id=p_owner and id=p_transaction;
 if t.id is null or t.currency not in('USD','EUR','JPY','KWD') or t.signed_amount_pence is not null or t.original_signed_minor is null
 or t.original_signed_minor=0 or t.original_signed_minor not between -999999999999 and 999999999999
 or t.source_units_ruleset is distinct from 'vibecount-currencies/1' then raise exception 'Choose an owned dimensioned foreign observation; GBP pence cannot hold foreign units.';end if;
 select jsonb_build_object('schema_version','bank-economic-source/1','owner_id',p_owner,'transaction_id',t.id,
  'account_id',a.id,'account_currency',a.currency,'import_id',i.id,'source_file_id',f.id,'file_sha256',f.file_hash,'size_bytes',f.size_bytes,
  'parser_version',i.parser_version,'source_row_id',r.id,'row_number',r.row_number,'row_sha256',r.row_hash,
  'cash_date',t.transaction_date,'currency',t.currency,'original_signed_minor',t.original_signed_minor,'ruleset_id',t.source_units_ruleset) into result
 from public.financial_accounts a join public.record_imports i on i.account_id=a.id and i.user_id=a.user_id
 join public.record_source_files f on f.id=i.source_file_id and f.user_id=i.user_id and f.account_id=a.id and f.file_hash=i.file_hash
 join public.source_rows r on r.import_id=i.id and r.user_id=i.user_id
 where a.id=t.account_id and a.user_id=p_owner and a.currency=t.currency and i.id=t.import_id and r.id=t.source_row_id
 and i.parser_version='mapped-csv/2' and i.status in('review','committed') and t.dedupe_status='clear'
 and f.size_bytes between 1 and 1000000 and r.row_number between 2 and 5001
 and t.transaction_date between date '1900-01-01' and date '9998-12-31'
 and t.classification in('Unknown','Business','Mixed','Personal') and t.active_transfer_id is null and t.active_refund_id is null
 and exists(select 1 from storage.objects o where o.bucket_id='source-evidence' and o.name=f.object_path);
 if result is null then raise exception 'Current owned observation/account/import/row/currency/source closure is unavailable.';end if;
 return result;
end;$$;
revoke all on function public.bank_valuation_economic_source(uuid,uuid) from public,anon,authenticated,service_role;

create function public.bank_valuation_assert_unencumbered(p_owner uuid,p_transaction uuid) returns void language plpgsql stable set search_path='' as $$
begin
 if exists(select 1 from public.financial_records f where f.user_id=p_owner and f.bank_transaction_id=p_transaction and f.status='approved')
 or exists(select 1 from public.active_invoice_allocations a where a.user_id=p_owner and a.transaction_id=p_transaction)
 or exists(select 1 from public.transfer_pairs p where p.user_id=p_owner and p_transaction in(p.outgoing_transaction_id,p.incoming_transaction_id)
  and not exists(select 1 from public.transfer_reversals r where r.pair_id=p.id and r.user_id=p_owner))
 or exists(select 1 from public.refund_links l where l.user_id=p_owner and p_transaction in(l.original_transaction_id,l.refund_transaction_id)
  and not exists(select 1 from public.refund_reversals r where r.refund_id=l.id and r.user_id=p_owner))
 then raise exception 'Review and reverse dependent financial effects before changing this valuation.';end if;
end;$$;
revoke all on function public.bank_valuation_assert_unencumbered(uuid,uuid) from public,anon,authenticated,service_role;

create function public.bank_valuation_review_stamp(p_owner uuid) returns text language plpgsql stable set search_path='' as $$
declare result text;
begin
 if p_owner is null then raise exception 'Choose owned valuation context.';end if;
 -- This private stamp covers exactly the frozen valuation/source/dependency inputs.
 -- It deliberately does not depend on unrelated invoice, tax, or FX-document fact histories.
 select md5(jsonb_build_object('schema_version','bank-valuation-context/1',
 'accounts',(select jsonb_agg(jsonb_build_array(a.id,a.currency) order by a.id) from public.financial_accounts a where a.user_id=p_owner),
 'imports',(select jsonb_agg(jsonb_build_array(i.id,i.account_id,i.source_file_id,i.file_hash,i.parser_version,i.status) order by i.id) from public.record_imports i where i.user_id=p_owner),
 'observations',(select jsonb_agg(jsonb_build_array(t.id,t.currency,t.original_signed_minor,t.source_units_ruleset,t.transaction_date,t.decision_version,t.classification,t.dedupe_status,t.active_transfer_id,t.active_refund_id) order by t.id) from public.bank_transactions t where t.user_id=p_owner),
 'files',(select jsonb_agg(jsonb_build_array(f.id,f.account_id,f.file_hash,f.size_bytes,exists(select 1 from storage.objects o where o.bucket_id='source-evidence' and o.name=f.object_path)) order by f.id) from public.record_source_files f where f.user_id=p_owner),
 'rows',(select jsonb_agg(jsonb_build_array(r.id,r.import_id,r.row_number,r.row_hash) order by r.id) from public.source_rows r where r.user_id=p_owner),
 'documents',(select jsonb_agg(jsonb_build_array(d.id,d.file_hash,d.media_type,d.size_bytes,exists(select 1 from storage.objects o where o.bucket_id='document-evidence' and o.name=d.object_path)) order by d.id) from public.evidence_documents d where d.user_id=p_owner),
 'registrations',(select jsonb_agg(jsonb_build_array(i.id,i.document_id,i.batch_id,i.ordinal,b.purpose,b.tax_year_start) order by i.id) from public.document_batch_items i join public.document_batches b on b.id=i.batch_id and b.user_id=i.user_id where i.user_id=p_owner),
 'records',(select jsonb_agg(jsonb_build_array(f.id,f.bank_transaction_id,f.status) order by f.id) from public.financial_records f where f.user_id=p_owner),
 'settlements',(select jsonb_agg(jsonb_build_array(a.id,a.transaction_id,a.event_kind,a.reverses_id) order by a.id) from public.invoice_settlements a where a.user_id=p_owner),
 'transfers',(select jsonb_agg(jsonb_build_array(a.id,a.outgoing_transaction_id,a.incoming_transaction_id) order by a.id) from public.transfer_pairs a where a.user_id=p_owner),
 'transfer_reversals',(select jsonb_agg(jsonb_build_array(a.id,a.pair_id) order by a.id) from public.transfer_reversals a where a.user_id=p_owner),
 'refunds',(select jsonb_agg(jsonb_build_array(a.id,a.original_transaction_id,a.refund_transaction_id) order by a.id) from public.refund_links a where a.user_id=p_owner),
 'refund_reversals',(select jsonb_agg(jsonb_build_array(a.id,a.refund_id) order by a.id) from public.refund_reversals a where a.user_id=p_owner),
 'valuations',(select jsonb_agg(jsonb_build_array(r.id,r.ordinal) order by r.id) from public.bank_valuation_revisions r where r.user_id=p_owner)
 )::text) into result;
 return result;
end;$$;
revoke all on function public.bank_valuation_review_stamp(uuid) from public,anon,authenticated,service_role;

create function public.freeze_bank_valuation_inputs() returns void language plpgsql set search_path='' as $$
begin
 lock table public.financial_accounts,public.record_imports,public.record_source_files,public.source_rows,public.bank_transactions,
 public.financial_records,public.invoice_settlements,public.transfer_pairs,public.transfer_reversals,public.refund_links,public.refund_reversals,
 public.evidence_documents,public.document_batches,public.document_batch_items,storage.objects,
 public.bank_valuation_families,public.bank_valuation_revisions,public.bank_valuation_requests in share mode nowait;
end;$$;
revoke all on function public.freeze_bank_valuation_inputs() from public,anon,authenticated,service_role;

-- Every insert, including a privileged caller, must close over exact current or retained sources.
create function public.guard_bank_valuation_revision() returns trigger language plpgsql set search_path='' as $$
declare family public.bank_valuation_families;prior public.bank_valuation_revisions;source jsonb;doc jsonb;data jsonb;c jsonb;v integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||new.user_id::text,0));perform public.freeze_bank_valuation_inputs();
 select * into family from public.bank_valuation_families where id=new.family_id and user_id=new.user_id;
 select * into prior from public.bank_valuation_revisions r where r.family_id=new.family_id and r.user_id=new.user_id order by ordinal desc limit 1;
 if family.id is null or new.author is distinct from new.user_id or new.ruleset_id<>'vibecount-currencies/1'
 or new.ordinal<>coalesce(prior.ordinal,0)+1 or new.previous_revision_id is distinct from prior.id
 or new.reviewed_stamp is distinct from public.bank_valuation_review_stamp(new.user_id)
 then raise exception 'Valuation revision ancestry or reviewed context differs.';end if;
 perform public.bank_valuation_assert_unencumbered(new.user_id,family.transaction_id);
 if new.state='withdrawn' then
  if prior.id is null then raise exception 'Choose a retained valuation to withdraw.';end if;
  source:=prior.source_snapshot;data:=prior.data;c:=prior.conversion;doc:=source->'document_source';v:=prior.transaction_version;
 else
  source:=jsonb_build_object('economic_source',public.bank_valuation_economic_source(new.user_id,family.transaction_id));
  doc:=public.fx_document_source(new.user_id,new.document_id,false);
  if doc is null or(doc->>'available')::boolean is distinct from true then raise exception 'Preserve owned registered valuation evidence.';end if;
  source:=source||jsonb_build_object('document_source',doc);data:=public.validate_bank_valuation_data(new.data);
  if data->'rate'->>'source_currency' is distinct from source->'economic_source'->>'currency' then raise exception 'Valuation rate must match original account currency.';end if;
  c:=public.fx_convert_minor((source->'economic_source'->>'original_signed_minor')::bigint,data->'rate',new.ruleset_id);
  select decision_version into v from public.bank_transactions where user_id=new.user_id and id=family.transaction_id;
 end if;
 if new.source_snapshot is distinct from source or new.data is distinct from data or new.conversion is distinct from c
 or new.document_id::text is distinct from doc->'document'->>'id' or new.transaction_version is distinct from v
 or new.signed_gbp_pence is distinct from(c->>'target_minor')::bigint
 then raise exception 'Valuation source closure or exact arithmetic differs.';end if;
 return new;
end;$$;
revoke all on function public.guard_bank_valuation_revision() from public,anon,authenticated,service_role;
create trigger bank_valuation_revision_closure before insert on public.bank_valuation_revisions for each row execute function public.guard_bank_valuation_revision();

create function public.guard_bank_valuation_request_closure() returns trigger language plpgsql set search_path='' as $$
declare owner_id uuid;req uuid;r public.bank_valuation_revisions;q public.bank_valuation_requests;i jsonb;tx uuid;
begin
 owner_id:=new.user_id;req:=new.request_id;
 select * into q from public.bank_valuation_requests where user_id=owner_id and request_id=req;
 select * into r from public.bank_valuation_revisions where user_id=owner_id and request_id=req;
 if q.request_id is null or r.id is null then raise exception 'Complete valuation request/revision required.';end if;
 i:=public.validate_bank_valuation_intent(q.intent);select transaction_id into tx from public.bank_valuation_families where user_id=owner_id and id=r.family_id;
 if q.intent is distinct from i or q.result is distinct from to_jsonb(r) or i->>'transaction_id' is distinct from tx::text
 or(i->>'expected_ordinal')::integer+1<>r.ordinal or i->>'state' is distinct from r.state
 or i->>'request_id' is distinct from r.request_id::text or i->>'expected_stamp' is distinct from r.reviewed_stamp
 or i->>'rationale' is distinct from r.rationale or(i->>'human_read_original')::boolean is distinct from r.human_read_original
 or(r.state<>'withdrawn' and(i->'data' is distinct from r.data or i->>'document_id' is distinct from r.document_id::text or(i->>'transaction_version')::integer is distinct from r.transaction_version))
 then raise exception 'Valuation request/revision result differs.';end if;return null;
end;$$;
revoke all on function public.guard_bank_valuation_request_closure() from public,anon,authenticated,service_role;
create constraint trigger bank_valuation_revision_request_closure after insert on public.bank_valuation_revisions deferrable initially deferred for each row execute function public.guard_bank_valuation_request_closure();
create constraint trigger bank_valuation_request_revision_closure after insert on public.bank_valuation_requests deferrable initially deferred for each row execute function public.guard_bank_valuation_request_closure();

create function public.record_bank_valuation(p_owner uuid,p_intent jsonb) returns jsonb language plpgsql set search_path='' as $$
declare i jsonb;old_request public.bank_valuation_requests;family public.bank_valuation_families;prior public.bank_valuation_revisions;
 result public.bank_valuation_revisions;source jsonb;doc jsonb;d jsonb;c jsonb;version integer;doc_id uuid;
begin
 if p_owner is null then raise exception 'Choose owned bank valuation context.';end if;i:=public.validate_bank_valuation_intent(p_intent);
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||p_owner::text,0));
 select * into old_request from public.bank_valuation_requests where user_id=p_owner and request_id=(i->>'request_id')::uuid;
 if found then if old_request.intent is distinct from i then raise exception 'Bank valuation request changed.';end if;return old_request.result;end if;
 perform public.freeze_bank_valuation_inputs();
 if public.bank_valuation_review_stamp(p_owner) is distinct from i->>'expected_stamp' then raise exception 'Bank valuation sources or history changed.';end if;
 perform public.bank_valuation_assert_unencumbered(p_owner,(i->>'transaction_id')::uuid);
 select * into family from public.bank_valuation_families where user_id=p_owner and transaction_id=(i->>'transaction_id')::uuid;
 select * into prior from public.bank_valuation_revisions where user_id=p_owner and family_id=family.id order by ordinal desc limit 1;
 if coalesce(prior.ordinal,0)<>(i->>'expected_ordinal')::integer then raise exception 'Bank valuation revision changed.';end if;
 if i->>'state'='withdrawn' then
  if prior.id is null then raise exception 'Choose a retained valuation to withdraw.';end if;
  source:=prior.source_snapshot;doc_id:=prior.document_id;d:=prior.data;c:=prior.conversion;version:=prior.transaction_version;
 else
  source:=jsonb_build_object('economic_source',public.bank_valuation_economic_source(p_owner,(i->>'transaction_id')::uuid));
  doc_id:=(i->>'document_id')::uuid;doc:=public.fx_document_source(p_owner,doc_id,false);
  if doc is null or(doc->>'available')::boolean is distinct from true then raise exception 'Preserve owned registered valuation evidence.';end if;
  source:=source||jsonb_build_object('document_source',doc);d:=i->'data';
  if d->'rate'->>'source_currency' is distinct from source->'economic_source'->>'currency' then raise exception 'Valuation rate must match original account currency.';end if;
  c:=public.fx_convert_minor((source->'economic_source'->>'original_signed_minor')::bigint,d->'rate',i->>'ruleset_id');
  select decision_version into version from public.bank_transactions where user_id=p_owner and id=(i->>'transaction_id')::uuid;
  if version is distinct from(i->>'transaction_version')::integer then raise exception 'Review the current observation decision version.';end if;
 end if;
 if family.id is null then
  insert into public.bank_valuation_families(user_id,transaction_id) values(p_owner,(i->>'transaction_id')::uuid) returning * into family;
 end if;
 insert into public.bank_valuation_revisions(user_id,family_id,ordinal,previous_revision_id,state,transaction_version,ruleset_id,document_id,data,source_snapshot,conversion,signed_gbp_pence,human_read_original,reviewed_stamp,rationale,author,request_id)
 values(p_owner,family.id,(i->>'expected_ordinal')::integer+1,prior.id,i->>'state',version,i->>'ruleset_id',doc_id,d,source,c,(c->>'target_minor')::bigint,(i->>'human_read_original')::boolean,i->>'expected_stamp',i->>'rationale',p_owner,(i->>'request_id')::uuid) returning * into result;
 insert into public.bank_valuation_requests(user_id,request_id,intent,result) values(p_owner,(i->>'request_id')::uuid,i,to_jsonb(result));
 return to_jsonb(result);
end;$$;
revoke all on function public.record_bank_valuation(uuid,jsonb) from public,anon,authenticated,service_role;

-- Eligibility concerns immutable source identity, not the classification version increment caused by future posting.
create function public.bank_valuation_source_current(p_owner uuid,p_revision uuid) returns boolean language plpgsql stable set search_path='' as $$
declare r public.bank_valuation_revisions;tx uuid;doc jsonb;expected jsonb;
begin
 select * into r from public.bank_valuation_revisions where user_id=p_owner and id=p_revision and state='reviewed';
 if r.id is null or r.id is distinct from(select id from public.bank_valuation_revisions where user_id=p_owner and family_id=r.family_id order by ordinal desc limit 1) then return false;end if;
 select transaction_id into tx from public.bank_valuation_families where user_id=p_owner and id=r.family_id;
 expected:=public.bank_valuation_economic_source(p_owner,tx);doc:=public.fx_document_source(p_owner,r.document_id,false);
 return expected is not distinct from r.source_snapshot->'economic_source' and doc is not null and(doc->>'available')::boolean
  and doc->'document' is not distinct from r.source_snapshot->'document_source'->'document'
  and exists(select 1 from public.document_batch_items i join public.document_batches b on b.id=i.batch_id and b.user_id=i.user_id
   where i.user_id=p_owner and i.document_id=r.document_id and i.id::text=r.source_snapshot->'document_source'->'registration'->>'item_id'
   and i.batch_id::text=r.source_snapshot->'document_source'->'registration'->>'batch_id'
   and i.ordinal=(r.source_snapshot->'document_source'->'registration'->>'ordinal')::integer
   and b.purpose=r.source_snapshot->'document_source'->'registration'->>'purpose'
   and b.tax_year_start=(r.source_snapshot->'document_source'->'registration'->>'tax_year_start')::integer);
exception when others then return false;
end;$$;
revoke all on function public.bank_valuation_source_current(uuid,uuid) from public,anon,authenticated,service_role;

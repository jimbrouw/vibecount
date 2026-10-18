-- Foreign classification uses canonical decisions and financial_records. Admission remains closed.
create table public.foreign_classification_requests(
 user_id uuid not null references auth.users(id),request_id uuid not null,
 transaction_id uuid not null,version integer not null check(version>0),intent jsonb not null,result jsonb not null,
 created_at timestamptz not null default now(),primary key(user_id,request_id),unique(user_id,transaction_id,version),
 foreign key(transaction_id,user_id) references public.bank_transactions(id,user_id),
 check(jsonb_typeof(intent)='object' and octet_length(intent::text)<=16000),check(jsonb_typeof(result)='object'));
alter table public.foreign_classification_requests enable row level security;
revoke all on public.foreign_classification_requests from public,anon,authenticated,service_role;
grant select on public.foreign_classification_requests to authenticated,service_role;
create policy foreign_classification_owner_read on public.foreign_classification_requests for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_foreign_classification_request before update or delete on public.foreign_classification_requests for each row execute function public.reject_source_mutation();
alter table public.classification_decisions
 add column bank_valuation_revision_id uuid,
 add column foreign_request_id uuid,
 add constraint classification_valuation_owner foreign key(bank_valuation_revision_id,user_id) references public.bank_valuation_revisions(id,user_id),
 add constraint classification_foreign_request foreign key(user_id,foreign_request_id) references public.foreign_classification_requests(user_id,request_id);

create function public.validate_foreign_classification_intent(p jsonb) returns jsonb language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(p) is distinct from 'object' or (select count(*) from jsonb_object_keys(p))<>13
 or not(p ?& array['schema_version','transaction_id','transaction_version','valuation_revision_id','classification','category_id','business_use_bps','rounding_policy','treatment_reviewed','expected_stamp','rationale','request_id','human_confirmed'])
 or p->>'schema_version' is distinct from 'foreign-classification-intent/1'
 or p->>'rounding_policy' is distinct from 'gbp_business_share_half_up/1'
 or jsonb_typeof(p->'classification') is distinct from 'string' or p->>'classification' not in('Business','Mixed','Personal','Unknown')
 or p->'human_confirmed' is distinct from 'true'::jsonb or jsonb_typeof(p->'treatment_reviewed') is distinct from 'boolean'
 or jsonb_typeof(p->'transaction_version') is distinct from 'number' or p->>'transaction_version' !~ '^[0-9]+$'
 or (p->>'transaction_version')::numeric not between 0 and 2147483646
 or jsonb_typeof(p->'business_use_bps') is distinct from 'number' or p->>'business_use_bps' !~ '^[0-9]+$'
 or (p->>'business_use_bps')::numeric not between 0 and 10000
 or jsonb_typeof(p->'expected_stamp') is distinct from 'string' or p->>'expected_stamp' !~ '^[a-f0-9]{32}$'
 or jsonb_typeof(p->'rationale') is distinct from 'string' or length(btrim(p->>'rationale')) not between 1 and 1000
 then raise exception 'Review exact foreign classification fields.';end if;
 if jsonb_typeof(p->'transaction_id') is distinct from 'string' or jsonb_typeof(p->'request_id') is distinct from 'string'
 or (p->>'transaction_id')::uuid is null or (p->>'request_id')::uuid is null then raise exception 'Owned transaction and request required.';end if;
 if p->>'classification' in('Business','Mixed') then
  if p->'treatment_reviewed' is distinct from 'true'::jsonb or jsonb_typeof(p->'valuation_revision_id') is distinct from 'string'
  or (p->>'valuation_revision_id')::uuid is null or jsonb_typeof(p->'category_id') is distinct from 'string' or (p->>'category_id')::uuid is null
  or (p->>'classification'='Business' and p->'business_use_bps'<>'10000'::jsonb)
  or (p->>'classification'='Mixed' and (p->>'business_use_bps')::integer not between 1 and 9999)
  then raise exception 'Review valuation, category, treatment and business share.';end if;
 elsif p->'valuation_revision_id' is distinct from 'null'::jsonb or p->'category_id' is distinct from 'null'::jsonb
 or p->'business_use_bps' is distinct from '0'::jsonb or p->'treatment_reviewed' is distinct from 'false'::jsonb
 then raise exception 'Excluded or unresolved decisions require no valuation or claimed share.';end if;
 return p||jsonb_build_object('rationale',btrim(p->>'rationale'));
end;$$;
revoke all on function public.validate_foreign_classification_intent(jsonb) from public,anon,authenticated,service_role;

-- Only the owner-confirmed request may authorize a foreign canonical decision.
create function public.guard_foreign_classification_decision() returns trigger language plpgsql security definer set search_path='' as $$
declare t public.bank_transactions;q public.foreign_classification_requests;i jsonb;
begin
 select * into t from public.bank_transactions where id=new.transaction_id and user_id=new.user_id;
 if t.currency='GBP' then
  if new.foreign_request_id is not null or new.bank_valuation_revision_id is not null then raise exception 'Native decision cannot claim foreign valuation ancestry.';end if;return new;
 end if;
 select * into q from public.foreign_classification_requests where user_id=new.user_id and request_id=new.foreign_request_id;
 i:=q.intent;
 if q.request_id is null or q.transaction_id<>t.id or q.version<>new.version or new.import_id<>t.import_id or new.author<>new.user_id
 or (new.classification,new.business_use_bps,new.category_id,new.bank_valuation_revision_id,new.rationale,new.recognized_pence)
 is distinct from(i->>'classification',(i->>'business_use_bps')::integer,(i->>'category_id')::uuid,(i->>'valuation_revision_id')::uuid,i->>'rationale',(q.result->>'recognized_pence')::bigint)
 then raise exception 'Foreign classification requires its exact confirmed request.';end if;return new;
end;$$;
revoke all on function public.guard_foreign_classification_decision() from public,anon,authenticated,service_role;
create trigger foreign_classification_decision before insert on public.classification_decisions for each row execute function public.guard_foreign_classification_decision();

create or replace function public.guard_native_bank_decision() returns trigger language plpgsql security definer set search_path='' as $$
declare d public.classification_decisions;q public.foreign_classification_requests;
begin
 if current_setting('role',true) in('anon','authenticated') and new.user_id is distinct from auth.uid() then raise exception 'Owned native bank decision required.';end if;
 if(new.classification,new.business_use_bps,new.category_id,new.recognized_record_id,new.active_transfer_id,new.active_refund_id,new.dedupe_status,new.active_duplicate_decision_id)
 is distinct from(old.classification,old.business_use_bps,old.category_id,old.recognized_record_id,old.active_transfer_id,old.active_refund_id,old.dedupe_status,old.active_duplicate_decision_id)
 or(new.currency<>'GBP' and new.decision_version is distinct from old.decision_version) then
  if new.currency='GBP' then perform public.assert_native_bank_scope(new.user_id,array[new.id]);
  else
   select * into d from public.classification_decisions where transaction_id=new.id and user_id=new.user_id and version=new.decision_version;
   select * into q from public.foreign_classification_requests where user_id=new.user_id and request_id=d.foreign_request_id;
   if q.request_id is null or new.decision_version<>old.decision_version+1
   or(new.classification,new.business_use_bps,new.category_id,new.recognized_record_id) is distinct from(d.classification,d.business_use_bps,d.category_id,(q.result->>'record_id')::uuid)
   or(new.active_transfer_id,new.active_refund_id,new.dedupe_status,new.active_duplicate_decision_id) is distinct from(old.active_transfer_id,old.active_refund_id,old.dedupe_status,old.active_duplicate_decision_id)
   then raise exception 'Foreign decision requires exact reviewed classification; native GBP scope is unavailable.';end if;
  end if;
 end if;return new;
end;$$;

create or replace function public.guard_native_bank_posting() returns trigger language plpgsql security definer set search_path='' as $$
declare t public.bank_transactions;d public.classification_decisions;q public.foreign_classification_requests;
begin
 if current_setting('role',true) in('anon','authenticated') and new.user_id is distinct from auth.uid() then raise exception 'Owned native bank posting required.';end if;
 if tg_op='UPDATE' and old.bank_transaction_id is not null and exists(select 1 from public.bank_transactions where id=old.bank_transaction_id and user_id=old.user_id and currency<>'GBP')
 and(new.id,new.user_id,new.bank_transaction_id,new.import_id) is distinct from(old.id,old.user_id,old.bank_transaction_id,old.import_id)
 then raise exception 'Retain foreign accounting source linkage.';end if;
 if new.bank_transaction_id is null then return new;end if;
 select * into t from public.bank_transactions where id=new.bank_transaction_id and user_id=new.user_id;
 if t.currency='GBP' then if new.status='approved' then perform public.assert_native_bank_scope(new.user_id,array[new.bank_transaction_id]);end if;return new;end if;
 select * into d from public.classification_decisions where transaction_id=t.id and user_id=new.user_id order by version desc limit 1;
 select * into q from public.foreign_classification_requests where user_id=new.user_id and request_id=d.foreign_request_id;
 if q.request_id is null or new.id is distinct from(q.result->>'record_id')::uuid
 or new.record_type is distinct from (case when t.original_signed_minor>0 then 'income' else 'expense' end)
 or new.record_date is distinct from t.transaction_date or new.import_id is distinct from t.import_id
 or new.effect_sign<>1 or new.refund_link_id is not null or new.invoice_id is not null or new.source_type<>'csv'
 or (d.recognized_pence>0 and(new.status<>'approved' or new.amount*100<>d.recognized_pence or new.category_id is distinct from d.category_id or new.approved_at is null))
 or (d.recognized_pence=0 and(new.status<>'excluded' or new.approved_at is not null))
 then raise exception 'Foreign posting requires its reviewed GBP classification; actual GBP source scope is unavailable.';end if;
 if tg_op='UPDATE' and d.recognized_pence=0 and(new.amount,new.category_id) is distinct from(old.amount,old.category_id)
 then raise exception 'Retain excluded foreign posting history.';end if;
 return new;
end;$$;

create function public.protect_foreign_posting_delete() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.bank_transactions where id=old.bank_transaction_id and user_id=old.user_id and currency<>'GBP')
 then raise exception 'Reverse foreign postings; retain their audit history.';end if;return old;
end;$$;
revoke all on function public.protect_foreign_posting_delete() from public,anon,authenticated,service_role;
create trigger retain_foreign_posting before delete on public.financial_records for each row execute function public.protect_foreign_posting_delete();

-- A successful request must commit its canonical audit and final projection together.
create function public.check_foreign_classification_completion() returns trigger language plpgsql set search_path='' as $$
declare t public.bank_transactions;d public.classification_decisions;f public.financial_records;
begin
 select * into d from public.classification_decisions where user_id=new.user_id and foreign_request_id=new.request_id;
 if d.id is null or d.version<>new.version then raise exception 'Foreign classification audit is incomplete.';end if;
 select * into t from public.bank_transactions where user_id=new.user_id and id=new.transaction_id;
 if t.decision_version<new.version then raise exception 'Foreign classification projection is incomplete.';end if;
 if t.decision_version=new.version then
  if(t.classification,t.business_use_bps,t.category_id,t.recognized_record_id) is distinct from(d.classification,d.business_use_bps,d.category_id,(new.result->>'record_id')::uuid) then raise exception 'Foreign classification projection differs.';end if;
  if t.recognized_record_id is not null then
   select * into f from public.financial_records where id=t.recognized_record_id and user_id=new.user_id;
   if f.id is null or f.bank_transaction_id<>t.id or(d.recognized_pence>0 and(f.status<>'approved' or f.amount*100<>d.recognized_pence)) or(d.recognized_pence=0 and f.status<>'excluded') then raise exception 'Foreign classification posting differs.';end if;
  elsif d.recognized_pence<>0 then raise exception 'Foreign classification posting missing.';end if;
 end if;return null;
end;$$;
revoke all on function public.check_foreign_classification_completion() from public,anon,authenticated,service_role;
create constraint trigger foreign_classification_complete after insert on public.foreign_classification_requests deferrable initially deferred for each row execute function public.check_foreign_classification_completion();

create function public.review_foreign_classification(p_intent jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();i jsonb;q public.foreign_classification_requests;t public.bank_transactions;v public.bank_valuation_revisions;
 recognized bigint:=0;record_id uuid;kind text;category uuid;bps integer;version integer;result jsonb;source jsonb;
begin
 if owner_id is null then raise exception 'Sign in to review a foreign classification.';end if;
 i:=public.validate_foreign_classification_intent(p_intent);
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 select * into q from public.foreign_classification_requests where user_id=owner_id and request_id=(i->>'request_id')::uuid;
 if found then if q.intent is distinct from i then raise exception 'Foreign classification request changed.';end if;return q.result;end if;
 perform public.freeze_bank_valuation_inputs();
 lock table public.classification_decisions,public.foreign_classification_requests,public.record_categories in share mode nowait;
 if public.bank_valuation_review_stamp(owner_id) is distinct from i->>'expected_stamp' then raise exception 'Foreign classification source review changed.';end if;
 select * into t from public.bank_transactions where id=(i->>'transaction_id')::uuid and user_id=owner_id for update;
 if not found or t.currency not in('USD','EUR','JPY','KWD') or t.signed_amount_pence is not null or t.decision_version<>(i->>'transaction_version')::integer then raise exception 'Review the current owned foreign observation.';end if;
 if not exists(select 1 from public.record_imports where id=t.import_id and user_id=owner_id and status in('review','committed')) then raise exception 'Reopen the import before classification.';end if;
 -- Existing ordinary posting may be corrected; settlement/transfer/refund dependencies may not be stranded.
 if t.active_transfer_id is not null or t.active_refund_id is not null
 or exists(select 1 from public.active_invoice_allocations where user_id=owner_id and transaction_id=t.id)
 or exists(select 1 from public.transfer_pairs p where p.user_id=owner_id and t.id in(p.outgoing_transaction_id,p.incoming_transaction_id) and not exists(select 1 from public.transfer_reversals r where r.pair_id=p.id and r.user_id=owner_id))
 or exists(select 1 from public.refund_links l where l.user_id=owner_id and t.id in(l.original_transaction_id,l.refund_transaction_id) and not exists(select 1 from public.refund_reversals r where r.refund_id=l.id and r.user_id=owner_id))
 then raise exception 'Reverse dependent financial relationships before classification.';end if;
 bps:=(i->>'business_use_bps')::integer;category:=(i->>'category_id')::uuid;kind:=case when t.original_signed_minor>0 then 'income' else 'expense' end;
 if i->>'classification' in('Business','Mixed') then
  source:=public.bank_valuation_economic_source(owner_id,t.id);
  select r.* into v from public.bank_valuation_revisions r join public.bank_valuation_families f on f.id=r.family_id and f.user_id=r.user_id
  where r.id=(i->>'valuation_revision_id')::uuid and r.user_id=owner_id and f.transaction_id=t.id;
  if v.id is null or not public.bank_valuation_source_current(owner_id,v.id) then raise exception 'Review a current owned GBP valuation.';end if;
  if i->>'classification'='Mixed' and kind<>'expense' then raise exception 'Mixed use applies to expenses only.';end if;
  if not exists(select 1 from public.record_categories where id=category and record_type=kind and(user_id=owner_id or(is_default and user_id is null))) then raise exception 'Choose an owned category of the correct type.';end if;
  recognized:=round(abs(v.signed_gbp_pence)::numeric*bps/10000)::bigint;
 end if;
 record_id:=t.recognized_record_id;if recognized>0 and record_id is null then record_id:=gen_random_uuid();end if;
 version:=t.decision_version+1;
 result:=jsonb_build_object('version',version,'recognized_pence',recognized,'record_id',record_id,'record_type',kind,'classification',i->>'classification','valuation_revision_id',v.id,'rounding_policy','gbp_business_share_half_up/1');
 insert into public.foreign_classification_requests(user_id,request_id,transaction_id,version,intent,result) values(owner_id,(i->>'request_id')::uuid,t.id,version,i,result);
 insert into public.classification_decisions(user_id,transaction_id,import_id,version,classification,business_use_bps,category_id,rationale,recognized_pence,author,evidence_status,bank_valuation_revision_id,foreign_request_id)
 values(owner_id,t.id,t.import_id,version,i->>'classification',bps,category,i->>'rationale',recognized,owner_id,case when v.id is null then 'provisional' else 'verified' end,v.id,(i->>'request_id')::uuid);
 if recognized>0 then
  insert into public.financial_records(id,user_id,record_type,record_date,description,amount,category_id,import_id,source_type,source_reference,status,approved_at,bank_transaction_id,effect_sign)
  values(record_id,owner_id,kind,t.transaction_date,t.description,recognized::numeric/100,category,t.import_id,'csv','Transaction '||t.id::text,'approved',now(),t.id,1)
  on conflict(id) do update set amount=excluded.amount,category_id=excluded.category_id,status='approved',approved_at=now();
 elsif record_id is not null then update public.financial_records set status='excluded',approved_at=null where id=record_id and user_id=owner_id;end if;
 update public.bank_transactions set classification=i->>'classification',business_use_bps=bps,category_id=category,recognized_record_id=record_id,decision_version=version,updated_at=now() where id=t.id and user_id=owner_id;
 return result;
end;$$;
revoke all on function public.review_foreign_classification(jsonb) from public,anon,authenticated,service_role;
-- Kept private until classification read-back and correction/reversal UI are connected.

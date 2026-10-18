-- Identity decisions preserve every observation. They never create accounting income.
create table public.duplicate_requests (
 user_id uuid not null references auth.users(id), request_id uuid not null,
 payload_hash text not null, result jsonb not null, created_at timestamptz not null default now(),
 primary key(user_id,request_id)
);
create table public.duplicate_decisions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 transaction_id uuid not null, retained_transaction_id uuid,
 verdict text not null check(verdict in ('duplicate','distinct')),
 rationale text not null check(length(btrim(rationale)) between 1 and 1000),
 subject_snapshot jsonb not null, retained_snapshot jsonb, cohort_snapshot jsonb not null,
 reviewed_stamp text not null, author uuid not null references auth.users(id), request_id uuid not null,
 created_at timestamptz not null default now(),
 check((verdict='duplicate' and retained_transaction_id is not null and retained_snapshot is not null and retained_transaction_id<>transaction_id)
    or (verdict='distinct' and retained_transaction_id is null and retained_snapshot is null)),
 unique(id,user_id), unique(id,user_id,transaction_id), unique(user_id,request_id),
 foreign key(transaction_id,user_id) references public.bank_transactions(id,user_id),
 foreign key(retained_transaction_id,user_id) references public.bank_transactions(id,user_id),
 foreign key(user_id,request_id) references public.duplicate_requests(user_id,request_id) deferrable initially deferred
);
create table public.duplicate_reversals (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 decision_id uuid not null unique, rationale text not null check(length(btrim(rationale)) between 1 and 1000),
 subject_snapshot jsonb not null, reviewed_stamp text not null, author uuid not null references auth.users(id),
 request_id uuid not null, created_at timestamptz not null default now(), unique(user_id,request_id),
 foreign key(decision_id,user_id) references public.duplicate_decisions(id,user_id),
 foreign key(user_id,request_id) references public.duplicate_requests(user_id,request_id) deferrable initially deferred
);
create index duplicate_subject on public.duplicate_decisions(user_id,transaction_id,id);
create index duplicate_retained on public.duplicate_decisions(user_id,retained_transaction_id,id);
create index duplicate_reversal_owner on public.duplicate_reversals(user_id,id);
alter table public.duplicate_requests enable row level security;
alter table public.duplicate_decisions enable row level security;
alter table public.duplicate_reversals enable row level security;
revoke all on public.duplicate_requests,public.duplicate_decisions,public.duplicate_reversals from public,anon,authenticated,service_role;
grant select on public.duplicate_requests,public.duplicate_decisions,public.duplicate_reversals to authenticated,service_role;
create policy duplicate_requests_read on public.duplicate_requests for select to authenticated using(user_id=(select auth.uid()));
create policy duplicate_decisions_read on public.duplicate_decisions for select to authenticated using(user_id=(select auth.uid()));
create policy duplicate_reversals_read on public.duplicate_reversals for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_duplicate_requests before update or delete on public.duplicate_requests for each row execute function public.reject_source_mutation();
create trigger immutable_duplicate_decisions before update or delete on public.duplicate_decisions for each row execute function public.reject_source_mutation();
create trigger immutable_duplicate_reversals before update or delete on public.duplicate_reversals for each row execute function public.reject_source_mutation();
create view public.active_duplicate_decisions with(security_invoker=true) as
 select d.* from public.duplicate_decisions d where not exists(select 1 from public.duplicate_reversals r where r.decision_id=d.id and r.user_id=d.user_id);
revoke all on public.active_duplicate_decisions from public,anon,authenticated,service_role;
grant select on public.active_duplicate_decisions to authenticated,service_role;
alter table public.bank_transactions add column active_duplicate_decision_id uuid,
 add constraint transaction_duplicate_owner_fk foreign key(active_duplicate_decision_id,user_id,id) references public.duplicate_decisions(id,user_id,transaction_id);

create function public.protect_duplicate_projection() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('anon','authenticated','service_role') and
   (new.dedupe_status,new.active_duplicate_decision_id) is distinct from (old.dedupe_status,old.active_duplicate_decision_id)
 then raise exception 'Identity status requires a reviewed duplicate decision.'; end if;
 return new;
end; $$;
create trigger reviewed_duplicate_projection before update on public.bank_transactions for each row execute function public.protect_duplicate_projection();

-- Explicit safe projection: no encrypted raw cells, original filenames, object paths or keys.
create view public.duplicate_review_transactions with(security_invoker=true) as
select t.id,t.user_id,t.account_id,t.import_id,t.source_row_id,t.transaction_date,t.signed_amount_pence,t.currency,t.description,t.reference,t.fingerprint,
 t.classification,t.business_use_bps,t.category_id,t.decision_version,t.dedupe_status,t.active_duplicate_decision_id,
 a.label account_label,a.masked_identifier account_mask,i.status import_status,i.file_hash,i.parser_version,
 s.row_number,s.row_hash,f.record_type,f.status record_status,
 case when f.status='approved' then (f.amount*100*f.effect_sign)::bigint else 0 end recognized_pence,
 (select count(*) from public.bank_transactions p where p.user_id=t.user_id and p.account_id=t.account_id and p.fingerprint=t.fingerprint and p.id<>t.id) peer_count,
 (select count(*) from public.active_duplicate_decisions d where d.user_id=t.user_id and d.retained_transaction_id=t.id) incoming_duplicate_count,
 (exists(select 1 from public.active_invoice_allocations x where x.user_id=t.user_id and x.transaction_id=t.id)
  or t.active_transfer_id is not null
  or exists(select 1 from public.active_refunds x where x.user_id=t.user_id and t.id in (x.original_transaction_id,x.refund_transaction_id))) has_financial_dependencies
from public.bank_transactions t
join public.financial_accounts a on a.id=t.account_id and a.user_id=t.user_id
join public.record_imports i on i.id=t.import_id and i.user_id=t.user_id
join public.source_rows s on s.id=t.source_row_id and s.user_id=t.user_id
left join public.financial_records f on f.id=t.recognized_record_id and f.user_id=t.user_id;
revoke all on public.duplicate_review_transactions from public,anon,authenticated,service_role;
grant select on public.duplicate_review_transactions to authenticated,service_role;

alter function public.reconciliation_export_stamp() rename to reconciliation_export_stamp_v19_base;
revoke all on function public.reconciliation_export_stamp_v19_base() from public,anon,service_role;
-- Invoker wrapper needs the owner-readable base function as well.
grant execute on function public.reconciliation_export_stamp_v19_base() to authenticated;
create function public.reconciliation_export_stamp() returns text language sql stable security invoker set search_path='' as $$
 select md5(public.reconciliation_export_stamp_v19_base()||'|'||
 coalesce((select string_agg(id::text||':'||dedupe_status||':'||coalesce(active_duplicate_decision_id::text,''),',' order by id) from public.bank_transactions where user_id=(select auth.uid())),'')||'|'||
 coalesce((select string_agg(d.id::text||':'||coalesce(r.id::text,''),',' order by d.id) from public.duplicate_decisions d left join public.duplicate_reversals r on r.decision_id=d.id and r.user_id=d.user_id where d.user_id=(select auth.uid())),''));
$$;
revoke all on function public.reconciliation_export_stamp() from public,anon,service_role;
grant execute on function public.reconciliation_export_stamp() to authenticated;

-- The stamp covers the complete cohort and current financial dependencies. Taking the
-- same account lock as ingestion makes a new overlapping import invalidate old review.
create function public.duplicate_group_stamp(p_transaction uuid) returns text language sql stable security invoker set search_path='' as $$
 select md5(public.reconciliation_export_stamp()||'|'||coalesce((
 select string_agg(p.id::text||':'||p.decision_version::text||':'||p.dedupe_status,',' order by p.id)
 from public.bank_transactions p join public.bank_transactions t on t.user_id=p.user_id and t.account_id=p.account_id and t.fingerprint=p.fingerprint
 where t.id=p_transaction and t.user_id=(select auth.uid())),''));
$$;
revoke all on function public.duplicate_group_stamp(uuid) from public,anon,service_role;
grant execute on function public.duplicate_group_stamp(uuid) to authenticated;

-- Only approval RPCs call this helper. Reset works even on discarded source imports
-- so a discarded alias can be unlinked before its retained source is reversed.
create function public.apply_duplicate_state(p_transaction uuid,p_status text,p_decision uuid,p_reset boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare t public.bank_transactions; recognized bigint:=0;
begin
 select * into strict t from public.bank_transactions where id=p_transaction and user_id=auth.uid() for update;
 if p_reset then
  if t.recognized_record_id is not null then
   update public.financial_records set status='excluded',approved_at=null where id=t.recognized_record_id and user_id=t.user_id;
  end if;
 else
  select coalesce((select (f.amount*100*f.effect_sign)::bigint from public.financial_records f where f.id=t.recognized_record_id and f.user_id=t.user_id and f.status='approved'),0) into recognized;
 end if;
 insert into public.classification_decisions(user_id,transaction_id,import_id,version,classification,business_use_bps,category_id,rationale,recognized_pence,author,evidence_status)
 values(t.user_id,t.id,t.import_id,t.decision_version+1,case when p_reset then 'Unknown' else t.classification end,
 case when p_reset then 0 else t.business_use_bps end,case when p_reset then null else t.category_id end,p_reason,recognized,t.user_id,'duplicate-review');
 update public.bank_transactions set dedupe_status=p_status,active_duplicate_decision_id=p_decision,
 classification=case when p_reset then 'Unknown' else t.classification end,
 business_use_bps=case when p_reset then 0 else t.business_use_bps end,
 category_id=case when p_reset then null else t.category_id end,decision_version=decision_version+1,updated_at=now() where id=t.id;
end; $$;
revoke all on function public.apply_duplicate_state(uuid,text,uuid,boolean,text) from public,anon,authenticated,service_role;

create function public.approve_duplicate_decision(p_transaction uuid,p_retained uuid,p_verdict text,p_stamp text,p_reason text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); prior public.duplicate_requests; payload text; t public.duplicate_review_transactions; retained public.duplicate_review_transactions; cohort jsonb; decision uuid; result jsonb;
begin
 if owner_id is null then raise exception 'Sign in to review duplicates.'; end if;
 if p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 or p_verdict is null or p_verdict not in ('duplicate','distinct') then raise exception 'Review an identity verdict and reason.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 payload:=md5(jsonb_build_array('approve',p_transaction,p_retained,p_verdict,p_stamp,btrim(p_reason))::text);
 select * into prior from public.duplicate_requests where user_id=owner_id and request_id=p_request;
 if found then
  if prior.payload_hash<>payload then raise exception 'Request ID was used for another review.'; end if;
  return prior.result;
 end if;
 select * into t from public.duplicate_review_transactions where id=p_transaction and user_id=owner_id;
 if not found then raise exception 'Observation not found.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text||t.account_id::text,0));
 perform 1 from public.bank_transactions where user_id=owner_id and account_id=t.account_id and fingerprint=t.fingerprint order by id for update;
 select * into t from public.duplicate_review_transactions where id=p_transaction and user_id=owner_id;
 if public.duplicate_group_stamp(t.id) is distinct from p_stamp then raise exception 'Evidence changed. Review the complete overlap again.'; end if;
 if t.import_status='discarded' or t.peer_count<1 then raise exception 'Review an active import with overlapping evidence.'; end if;
 if t.active_duplicate_decision_id is not null or t.incoming_duplicate_count>0 then raise exception 'Reverse existing identity relationships first.'; end if;
 if t.has_financial_dependencies then raise exception 'Reverse receipt allocations, transfers and refund groups before changing identity.'; end if;
 if p_verdict='duplicate' then
  select * into retained from public.duplicate_review_transactions where id=p_retained and user_id=owner_id;
  if not found or retained.id=t.id or retained.account_id<>t.account_id or retained.fingerprint<>t.fingerprint
   or (retained.transaction_date,retained.signed_amount_pence,retained.currency) is distinct from (t.transaction_date,t.signed_amount_pence,t.currency)
   or retained.dedupe_status<>'clear' or retained.import_status='discarded'
  then raise exception 'Choose a clear, active matching observation from this account. Duplicate chains are not allowed.'; end if;
 elsif p_retained is not null then raise exception 'A separate real payment has no retained duplicate reference.';
 end if;
 select jsonb_agg(jsonb_build_object('id',id,'import_id',import_id,'source_row_id',source_row_id,'file_hash',file_hash,'row_hash',row_hash,'decision_version',decision_version,'dedupe_status',dedupe_status,'import_status',import_status) order by id)
 into cohort from public.duplicate_review_transactions where user_id=owner_id and account_id=t.account_id and fingerprint=t.fingerprint;
 insert into public.duplicate_decisions(user_id,transaction_id,retained_transaction_id,verdict,rationale,subject_snapshot,retained_snapshot,cohort_snapshot,reviewed_stamp,author,request_id)
 values(owner_id,t.id,p_retained,p_verdict,btrim(p_reason),to_jsonb(t),case when p_verdict='duplicate' then to_jsonb(retained) else null end,cohort,p_stamp,owner_id,p_request) returning id into decision;
 perform public.apply_duplicate_state(t.id,case when p_verdict='duplicate' then 'duplicate' else 'clear' end,decision,p_verdict='duplicate',btrim(p_reason));
 result:=jsonb_build_object('decision_id',decision,'verdict',p_verdict,'removed_income_pence',case when p_verdict='duplicate' and t.record_type='income' then t.recognized_pence else 0 end,'removed_expense_pence',case when p_verdict='duplicate' and t.record_type='expense' then t.recognized_pence else 0 end);
 insert into public.duplicate_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);
 return result;
end; $$;
revoke all on function public.approve_duplicate_decision(uuid,uuid,text,text,text,uuid) from public,anon,service_role;
grant execute on function public.approve_duplicate_decision(uuid,uuid,text,text,text,uuid) to authenticated;

create function public.reverse_duplicate_decision(p_decision uuid,p_stamp text,p_reason text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); d public.duplicate_decisions; t public.duplicate_review_transactions; prior public.duplicate_requests; payload text; reversal uuid; result jsonb;
begin
 if owner_id is null then raise exception 'Sign in to reverse an identity decision.'; end if;
 if p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Confirm a reversal reason.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 payload:=md5(jsonb_build_array('reverse',p_decision,p_stamp,btrim(p_reason))::text);
 select * into prior from public.duplicate_requests where user_id=owner_id and request_id=p_request;
 if found then
  if prior.payload_hash<>payload then raise exception 'Request ID was used for another review.'; end if;
  return prior.result;
 end if;
 select * into d from public.active_duplicate_decisions where id=p_decision and user_id=owner_id;
 if not found then raise exception 'Active identity decision not found.'; end if;
 select * into t from public.duplicate_review_transactions where id=d.transaction_id and user_id=owner_id;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text||t.account_id::text,0));
 perform 1 from public.bank_transactions where user_id=owner_id and account_id=t.account_id and fingerprint=t.fingerprint order by id for update;
 select * into t from public.duplicate_review_transactions where id=d.transaction_id and user_id=owner_id;
 if public.duplicate_group_stamp(t.id) is distinct from p_stamp or t.active_duplicate_decision_id is distinct from d.id then raise exception 'Identity changed. Review reversal again.'; end if;
 if t.incoming_duplicate_count>0 or t.has_financial_dependencies then raise exception 'Reverse dependent identity, receipt allocation, transfer or refund relationships first.'; end if;
 insert into public.duplicate_reversals(user_id,decision_id,rationale,subject_snapshot,reviewed_stamp,author,request_id)
 values(owner_id,d.id,btrim(p_reason),to_jsonb(t),p_stamp,owner_id,p_request) returning id into reversal;
 perform public.apply_duplicate_state(t.id,'needs_review',null,true,btrim(p_reason));
 result:=jsonb_build_object('reversal_id',reversal,'verdict','needs_review','removed_income_pence',case when t.record_type='income' then t.recognized_pence else 0 end,'removed_expense_pence',case when t.record_type='expense' then t.recognized_pence else 0 end);
 insert into public.duplicate_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);
 return result;
end; $$;
revoke all on function public.reverse_duplicate_decision(uuid,text,text,uuid) from public,anon,service_role;
grant execute on function public.reverse_duplicate_decision(uuid,text,text,uuid) to authenticated;

-- Never discard the retained source while aliases still rely on it. Alias reversal
-- is permitted even after its own import was discarded, avoiding a recovery dead end.
create function public.protect_retained_duplicate_import() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='discarded' and old.status<>'discarded' then
  perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||new.user_id::text,0));
  if exists(select 1 from public.active_duplicate_decisions d join public.bank_transactions t on t.id=d.retained_transaction_id and t.user_id=d.user_id where t.import_id=old.id and t.user_id=old.user_id)
  then raise exception 'Reverse duplicate references to this retained source before reversing the import.'; end if;
 end if;
 return new;
end; $$;
create trigger protect_retained_duplicate_import before update on public.record_imports for each row execute function public.protect_retained_duplicate_import();

alter function public.source_import_summary(uuid) rename to source_import_summary_v19_base;
revoke all on function public.source_import_summary_v19_base(uuid) from public,anon,service_role;
grant execute on function public.source_import_summary_v19_base(uuid) to authenticated;
create function public.source_import_summary(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 with history as (
  select d.*,r.id reversal_id from public.duplicate_decisions d left join public.duplicate_reversals r on r.decision_id=d.id and r.user_id=d.user_id
  where d.user_id=(select auth.uid()) and exists(select 1 from public.bank_transactions t where t.import_id=p_id and t.user_id=d.user_id and t.id in (d.transaction_id,d.retained_transaction_id))
 ), base as(select public.source_import_summary_v19_base(p_id) value)
 select value||jsonb_build_object('retained_duplicate_count',(select count(*) from history h join public.bank_transactions t on t.id=h.retained_transaction_id and t.user_id=h.user_id where t.import_id=p_id and h.reversal_id is null),
 'stamp',md5((value->>'stamp')||'|'||coalesce((select string_agg(id::text||':'||coalesce(reversal_id::text,''),',' order by id) from history),''))) from base;
$$;
revoke all on function public.source_import_summary(uuid) from public,anon,service_role;
grant execute on function public.source_import_summary(uuid) to authenticated;

create view public.duplicate_history_events with(security_invoker=true) as
 select d.id,d.user_id,d.id decision_id,'decision'::text event_kind,d.transaction_id,d.retained_transaction_id,
 (d.subject_snapshot->>'import_id')::uuid import_id,(d.retained_snapshot->>'import_id')::uuid retained_import_id,
 d.verdict,d.rationale,d.subject_snapshot,d.retained_snapshot,d.cohort_snapshot,d.reviewed_stamp,d.author,d.created_at
 from public.duplicate_decisions d
 union all
 select r.id,r.user_id,d.id,'reversal',d.transaction_id,d.retained_transaction_id,
 (d.subject_snapshot->>'import_id')::uuid,(d.retained_snapshot->>'import_id')::uuid,
 'needs_review',r.rationale,r.subject_snapshot,d.retained_snapshot,d.cohort_snapshot,r.reviewed_stamp,r.author,r.created_at
 from public.duplicate_reversals r join public.duplicate_decisions d on d.id=r.decision_id and d.user_id=r.user_id;
revoke all on public.duplicate_history_events from public,anon,authenticated,service_role;
grant select on public.duplicate_history_events to authenticated,service_role;

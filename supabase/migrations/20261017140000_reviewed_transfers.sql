-- Immutable evidence of movements between two owned source accounts. No payment initiation.
create table public.transfer_requests (
  user_id uuid not null references auth.users(id),request_id uuid not null,
  payload_hash text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(user_id,request_id)
);
create table public.transfer_pairs (
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
  outgoing_transaction_id uuid not null,incoming_transaction_id uuid not null,
  kind text not null check(kind in ('transfer','card_repayment')),
  amount_pence bigint not null check(amount_pence between 1 and 999999999999),
  outgoing_version integer not null,incoming_version integer not null,
  author uuid not null references auth.users(id),rationale text not null check(length(btrim(rationale)) between 1 and 1000),
  request_id uuid not null,created_at timestamptz not null default now(),unique(id,user_id),
  check(outgoing_transaction_id<>incoming_transaction_id),
  constraint transfer_pairs_outgoing_owner_fk foreign key(outgoing_transaction_id,user_id) references public.bank_transactions(id,user_id),
  constraint transfer_pairs_incoming_owner_fk foreign key(incoming_transaction_id,user_id) references public.bank_transactions(id,user_id),
  foreign key(user_id,request_id) references public.transfer_requests(user_id,request_id) deferrable initially deferred
);
create table public.transfer_reversals (
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),pair_id uuid not null unique,
  author uuid not null references auth.users(id),rationale text not null check(length(btrim(rationale)) between 1 and 1000),
  request_id uuid not null,created_at timestamptz not null default now(),
  foreign key(pair_id,user_id) references public.transfer_pairs(id,user_id),
  foreign key(user_id,request_id) references public.transfer_requests(user_id,request_id) deferrable initially deferred
);
alter table public.bank_transactions add column active_transfer_id uuid,
  add constraint bank_transactions_active_transfer_owner_fk foreign key(active_transfer_id,user_id) references public.transfer_pairs(id,user_id);
create index transactions_active_transfer on public.bank_transactions(active_transfer_id,user_id);
create index transfer_pairs_owner_outgoing on public.transfer_pairs(user_id,outgoing_transaction_id,id);
create index transfer_pairs_owner_incoming on public.transfer_pairs(user_id,incoming_transaction_id,id);
create index transfer_pairs_request on public.transfer_pairs(user_id,request_id);
create index transfer_reversals_owner on public.transfer_reversals(user_id,id);
create index transfer_reversals_request on public.transfer_reversals(user_id,request_id);
alter table public.transfer_requests enable row level security;
alter table public.transfer_pairs enable row level security;
alter table public.transfer_reversals enable row level security;
revoke all on public.transfer_requests,public.transfer_pairs,public.transfer_reversals from public,anon,authenticated,service_role;
grant select on public.transfer_requests,public.transfer_pairs,public.transfer_reversals to authenticated,service_role;
create policy transfer_requests_owner_read on public.transfer_requests for select to authenticated using(user_id=(select auth.uid()));
create policy transfer_pairs_owner_read on public.transfer_pairs for select to authenticated using(user_id=(select auth.uid()));
create policy transfer_reversals_owner_read on public.transfer_reversals for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_transfer_requests before update or delete on public.transfer_requests for each row execute function public.reject_source_mutation();
create trigger immutable_transfer_pairs before update or delete on public.transfer_pairs for each row execute function public.reject_source_mutation();
create trigger immutable_transfer_reversals before update or delete on public.transfer_reversals for each row execute function public.reject_source_mutation();

create view public.active_transfer_pairs with(security_invoker=true) as
select p.* from public.transfer_pairs p where not exists(select 1 from public.transfer_reversals r where r.pair_id=p.id and r.user_id=p.user_id);
create view public.transfer_transaction_choices with(security_invoker=true) as
select t.id,t.user_id,t.account_id,t.import_id,t.transaction_date,t.signed_amount_pence,t.currency,t.description,t.reference,
  t.classification,t.decision_version,t.dedupe_status,t.active_transfer_id,
  a.label as account_label,a.masked_identifier as account_mask,a.account_type,
  i.status as import_status,f.status as record_status,
  case when f.status='approved' then (f.amount*100)::bigint else 0 end as recognized_pence,
  coalesce(s.allocated_pence,0)::bigint as invoice_allocated_pence
from public.bank_transactions t join public.financial_accounts a on a.id=t.account_id and a.user_id=t.user_id
join public.record_imports i on i.id=t.import_id and i.user_id=t.user_id
left join public.financial_records f on f.id=t.recognized_record_id and f.user_id=t.user_id
left join (select user_id,transaction_id,sum(amount_pence) allocated_pence from public.active_invoice_allocations group by user_id,transaction_id) s on s.transaction_id=t.id and s.user_id=t.user_id;
revoke all on public.active_transfer_pairs,public.transfer_transaction_choices from public,anon,authenticated;
grant select on public.active_transfer_pairs,public.transfer_transaction_choices to authenticated;

create function public.approve_transfer_pair(p_outgoing uuid,p_outgoing_version integer,p_incoming uuid,p_incoming_version integer,p_kind text,p_reason text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); outgoing public.bank_transactions; incoming public.bank_transactions;
  out_type text; in_type text; payload text; existing public.transfer_requests; pair uuid; result jsonb;
begin
  if owner_id is null then raise exception 'Sign in to review transfers.'; end if;
  if p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 or p_kind is null or p_kind not in ('transfer','card_repayment') then raise exception 'Choose a transfer type, reason and request ID.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reconciliation:'||owner_id::text,0));
  payload:=md5(jsonb_build_object('action','pair','outgoing',p_outgoing,'outgoing_version',p_outgoing_version,'incoming',p_incoming,'incoming_version',p_incoming_version,'kind',p_kind,'reason',btrim(p_reason))::text);
  select * into existing from public.transfer_requests where user_id=owner_id and request_id=p_request;
  if found then
    if existing.payload_hash<>payload then raise exception 'Request ID was already used for a different transfer review.'; end if;
    return existing.result;
  end if;
  perform 1 from public.bank_transactions where user_id=owner_id and id in (p_outgoing,p_incoming) order by id for update;
  select * into outgoing from public.bank_transactions where id=p_outgoing and user_id=owner_id;
  if not found then raise exception 'Outgoing transaction not found.'; end if;
  select * into incoming from public.bank_transactions where id=p_incoming and user_id=owner_id;
  if not found then raise exception 'Incoming transaction not found.'; end if;
  if outgoing.decision_version is distinct from p_outgoing_version or incoming.decision_version is distinct from p_incoming_version then raise exception 'Transfer decisions changed. Reload the read-back.'; end if;
  if outgoing.account_id=incoming.account_id or outgoing.signed_amount_pence>=0 or incoming.signed_amount_pence<=0 or
     outgoing.signed_amount_pence<>-incoming.signed_amount_pence or outgoing.currency<>'GBP' or incoming.currency<>'GBP'
    then raise exception 'Choose equal opposite GBP amounts from different owned accounts.'; end if;
  if outgoing.dedupe_status<>'clear' or incoming.dedupe_status<>'clear' then raise exception 'Resolve possible duplicate observations before pairing.'; end if;
  if outgoing.active_transfer_id is not null or incoming.active_transfer_id is not null then raise exception 'A transaction already has an active transfer pair.'; end if;
  if exists(select 1 from public.record_imports where id in (outgoing.import_id,incoming.import_id) and user_id=owner_id and status='discarded') then raise exception 'Reopen reversed imports before reviewing transfers.'; end if;
  if exists(select 1 from public.active_invoice_allocations where transaction_id in (outgoing.id,incoming.id) and user_id=owner_id) then raise exception 'Reverse invoice allocations before pairing a transfer.'; end if;
  select account_type into out_type from public.financial_accounts where id=outgoing.account_id and user_id=owner_id;
  select account_type into in_type from public.financial_accounts where id=incoming.account_id and user_id=owner_id;
  if (p_kind='transfer' and (out_type<>'bank' or in_type<>'bank')) or (p_kind='card_repayment' and (out_type<>'bank' or in_type<>'credit_card')) then raise exception 'Use bank-to-bank transfer or bank-to-card repayment as appropriate.'; end if;
  perform public.review_bank_transaction_v1(outgoing.id,outgoing.decision_version,'Transfer',null,0,btrim(p_reason));
  perform public.review_bank_transaction_v1(incoming.id,incoming.decision_version,'Transfer',null,0,btrim(p_reason));
  insert into public.transfer_pairs(user_id,outgoing_transaction_id,incoming_transaction_id,kind,amount_pence,outgoing_version,incoming_version,author,rationale,request_id)
    values(owner_id,outgoing.id,incoming.id,p_kind,incoming.signed_amount_pence,outgoing.decision_version+1,incoming.decision_version+1,owner_id,btrim(p_reason),p_request) returning id into pair;
  update public.bank_transactions set active_transfer_id=pair where id in (outgoing.id,incoming.id) and user_id=owner_id;
  result:=jsonb_build_object('pair_id',pair,'amount_pence',incoming.signed_amount_pence,'income_pence',0,'expense_pence',0);
  insert into public.transfer_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);
  return result;
end; $$;
revoke all on function public.approve_transfer_pair(uuid,integer,uuid,integer,text,text,uuid) from public,anon;
grant execute on function public.approve_transfer_pair(uuid,integer,uuid,integer,text,text,uuid) to authenticated;

create function public.reverse_transfer_pair(p_pair uuid,p_reason text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); pair public.transfer_pairs; tx public.bank_transactions;
  payload text; existing public.transfer_requests; reversal uuid; result jsonb;
begin
  if owner_id is null then raise exception 'Sign in to reverse transfers.'; end if;
  if p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Confirm a reason and request ID.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reconciliation:'||owner_id::text,0));
  payload:=md5(jsonb_build_object('action','reverse','pair',p_pair,'reason',btrim(p_reason))::text);
  select * into existing from public.transfer_requests where user_id=owner_id and request_id=p_request;
  if found then
    if existing.payload_hash<>payload then raise exception 'Request ID was already used for a different transfer review.'; end if;
    return existing.result;
  end if;
  select * into pair from public.active_transfer_pairs where id=p_pair and user_id=owner_id;
  if not found then raise exception 'Active transfer pair not found.'; end if;
  perform 1 from public.bank_transactions where user_id=owner_id and id in (pair.outgoing_transaction_id,pair.incoming_transaction_id) order by id for update;
  insert into public.transfer_reversals(user_id,pair_id,author,rationale,request_id) values(owner_id,pair.id,owner_id,btrim(p_reason),p_request) returning id into reversal;
  update public.bank_transactions set active_transfer_id=null where user_id=owner_id and active_transfer_id=pair.id;
  for tx in select * from public.bank_transactions where user_id=owner_id and id in (pair.outgoing_transaction_id,pair.incoming_transaction_id) order by id loop
    perform public.review_bank_transaction_v1(tx.id,tx.decision_version,'Unknown',null,0,btrim(p_reason));
  end loop;
  result:=jsonb_build_object('reversal_id',reversal,'amount_pence',pair.amount_pence,'restored_financial_pence',0);
  insert into public.transfer_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);
  return result;
end; $$;
revoke all on function public.reverse_transfer_pair(uuid,text,uuid) from public,anon;
grant execute on function public.reverse_transfer_pair(uuid,text,uuid) to authenticated;

alter function public.review_bank_transaction(uuid,integer,text,uuid,integer,text) rename to review_bank_transaction_v2;
revoke all on function public.review_bank_transaction_v2(uuid,integer,text,uuid,integer,text) from public,anon,authenticated,service_role;
create function public.review_bank_transaction(p_id uuid,p_version integer,p_classification text,p_category uuid,p_bps integer,p_rationale text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();
begin
  if owner_id is null then raise exception 'Sign in to review transactions.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reconciliation:'||owner_id::text,0));
  if exists(select 1 from public.bank_transactions where id=p_id and user_id=owner_id and active_transfer_id is not null) then raise exception 'Reverse the transfer pair before changing this classification.'; end if;
  return public.review_bank_transaction_v2(p_id,p_version,p_classification,p_category,p_bps,p_rationale);
end; $$;
revoke all on function public.review_bank_transaction(uuid,integer,text,uuid,integer,text) from public,anon;
grant execute on function public.review_bank_transaction(uuid,integer,text,uuid,integer,text) to authenticated;

create or replace function public.source_import_summary(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
  with tx as (select * from public.bank_transactions where import_id=p_id and user_id=(select auth.uid())),
  allocations as (select a.* from public.active_invoice_allocations a join tx on tx.id=a.transaction_id and tx.user_id=a.user_id),
  invoice_events as (select a.id from public.invoice_settlements a join tx on tx.id=a.transaction_id and tx.user_id=a.user_id),
  pair_history as (select p.* from public.transfer_pairs p where p.user_id=(select auth.uid()) and exists(select 1 from tx where tx.id in (p.outgoing_transaction_id,p.incoming_transaction_id))),
  pairs as (select p.* from pair_history p where not exists(select 1 from public.transfer_reversals r where r.pair_id=p.id and r.user_id=p.user_id)),
  pair_stamp as (select coalesce(string_agg(p.id::text||':'||coalesce(r.id::text,''),',' order by p.id),'') stamp from pair_history p left join public.transfer_reversals r on r.pair_id=p.id and r.user_id=p.user_id),
  counterpart_stamp as (select coalesce(string_agg(t.id::text||':'||t.decision_version::text,',' order by t.id),'') stamp from public.bank_transactions t where t.user_id=(select auth.uid()) and exists(select 1 from pairs p where t.id in (p.outgoing_transaction_id,p.incoming_transaction_id)))
  select jsonb_build_object('transactions',count(tx.id),
    'income_pence',coalesce(sum(case when f.status='approved' and tx.signed_amount_pence>0 then f.amount*100 else 0 end),0),
    'expense_pence',coalesce(sum(case when f.status='approved' and tx.signed_amount_pence<0 then f.amount*100 else 0 end),0),
    'allocation_count',(select count(*) from allocations),'allocation_pence',(select coalesce(sum(amount_pence),0) from allocations),
    'transfer_count',(select count(*) from pairs),'transfer_pence',(select coalesce(sum(amount_pence),0) from pairs),
    'stamp',md5(coalesce(string_agg(tx.id::text||':'||tx.decision_version::text,',' order by tx.id),'')||'|'||(select coalesce(string_agg(id::text,',' order by id),'') from invoice_events)||'|'||(select stamp from pair_stamp)||'|'||(select stamp from counterpart_stamp)))
  from tx left join public.financial_records f on f.id=tx.recognized_record_id and f.user_id=tx.user_id;
$$;

alter function public.reverse_source_import(uuid,text,text) rename to reverse_source_import_v2;
revoke all on function public.reverse_source_import_v2(uuid,text,text) from public,anon,authenticated,service_role;
create function public.reverse_source_import(p_id uuid,p_stamp text,p_reason text) returns integer
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); summary jsonb; pair public.transfer_pairs;
begin
  if owner_id is null then raise exception 'Sign in to reverse an import.'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Add a reversal reason.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reconciliation:'||owner_id::text,0));
  if not exists(select 1 from public.record_imports where id=p_id and user_id=owner_id and source_file_id is not null) then raise exception 'Preserved import not found.'; end if;
  if exists(select 1 from public.record_imports where id=p_id and user_id=owner_id and status='discarded') then return 0; end if;
  summary:=public.source_import_summary(p_id);
  if summary->>'stamp' is distinct from p_stamp then raise exception 'Import decisions, allocations or transfers changed. Review the totals again.'; end if;
  for pair in select p.* from public.active_transfer_pairs p where p.user_id=owner_id and exists(select 1 from public.bank_transactions t where t.user_id=owner_id and t.import_id=p_id and t.id in (p.outgoing_transaction_id,p.incoming_transaction_id)) order by p.id loop
    perform public.reverse_transfer_pair(pair.id,'Import reversal: '||left(btrim(p_reason),980),gen_random_uuid());
  end loop;
  summary:=public.source_import_summary(p_id);
  return public.reverse_source_import_v2(p_id,summary->>'stamp',p_reason);
end; $$;
revoke all on function public.reverse_source_import(uuid,text,text) from public,anon;
grant execute on function public.reverse_source_import(uuid,text,text) to authenticated;

create or replace view public.receipt_allocation_balances with(security_invoker=true) as
select t.id,t.user_id,t.import_id,t.transaction_date,t.description,t.reference,t.signed_amount_pence,t.currency,t.classification,
  t.business_use_bps,t.dedupe_status,t.decision_version,t.source_row_id,t.recognized_record_id,
  f.status as record_status,(f.amount*100)::bigint as recognized_pence,
  coalesce(a.allocated_pence,0)::bigint as allocated_pence,
  (t.signed_amount_pence-coalesce(a.allocated_pence,0))::bigint as unallocated_pence,t.active_transfer_id
from public.bank_transactions t left join public.financial_records f on f.id=t.recognized_record_id and f.user_id=t.user_id
left join (select user_id,transaction_id,sum(amount_pence) allocated_pence from public.active_invoice_allocations group by user_id,transaction_id) a
on a.transaction_id=t.id and a.user_id=t.user_id where t.signed_amount_pence>0;
create or replace function public.reconciliation_export_stamp() returns text language sql stable security invoker set search_path='' as $$
  select md5(
    (select coalesce(string_agg(id::text||':'||updated_at::text,',' order by id),'') from public.invoices where user_id=(select auth.uid()))||'|'||
    (select coalesce(string_agg(id::text||':'||decision_version::text||':'||coalesce(active_transfer_id::text,''),',' order by id),'') from public.bank_transactions where user_id=(select auth.uid()))||'|'||
    (select coalesce(string_agg(id::text,',' order by id),'') from public.invoice_settlements where user_id=(select auth.uid()))||'|'||
    (select coalesce(string_agg(id::text,',' order by id),'') from public.transfer_pairs where user_id=(select auth.uid()))||'|'||
    (select coalesce(string_agg(id::text,',' order by id),'') from public.transfer_reversals where user_id=(select auth.uid()))
  );
$$;

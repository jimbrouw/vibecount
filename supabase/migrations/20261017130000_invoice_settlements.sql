-- Reviewed invoice/receipt relationships. Allocations never create income.
alter table public.invoices add column currency text not null default 'GBP' check(currency='GBP');
create table public.settlement_requests (
  user_id uuid not null references auth.users(id), request_id uuid not null,
  payload_hash text not null, result jsonb not null, created_at timestamptz not null default now(),
  primary key(user_id,request_id)
);
create table public.invoice_settlements (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  invoice_id uuid not null, transaction_id uuid not null,
  amount_pence bigint not null check(amount_pence between 1 and 999999999999),
  event_kind text not null check(event_kind in ('allocation','reversal')),
  reverses_id uuid unique, request_id uuid not null,
  invoice_snapshot jsonb not null, author uuid not null references auth.users(id),
  rationale text not null check(length(btrim(rationale)) between 1 and 1000),
  created_at timestamptz not null default now(), unique(id,user_id),
  check((event_kind='allocation' and reverses_id is null) or (event_kind='reversal' and reverses_id is not null)),
  foreign key(invoice_id,user_id) references public.invoices(id,user_id),
  foreign key(transaction_id,user_id) references public.bank_transactions(id,user_id),
  foreign key(reverses_id,user_id) references public.invoice_settlements(id,user_id),
  foreign key(user_id,request_id) references public.settlement_requests(user_id,request_id) deferrable initially deferred
);
alter table public.settlement_requests enable row level security;
alter table public.invoice_settlements enable row level security;
revoke all on public.settlement_requests,public.invoice_settlements from public,anon,authenticated,service_role;
grant select on public.settlement_requests,public.invoice_settlements to authenticated,service_role;
create policy settlement_request_owner_read on public.settlement_requests for select to authenticated using(user_id=(select auth.uid()));
create policy settlement_owner_read on public.invoice_settlements for select to authenticated using(user_id=(select auth.uid()));
create index settlements_owner_invoice on public.invoice_settlements(user_id,invoice_id,id);
create index settlements_owner_transaction on public.invoice_settlements(user_id,transaction_id,id);
create index settlements_reversal_owner on public.invoice_settlements(reverses_id,user_id);
create index settlements_request on public.invoice_settlements(user_id,request_id);
create trigger immutable_settlement_requests before update or delete on public.settlement_requests for each row execute function public.reject_source_mutation();
create trigger immutable_settlements before update or delete on public.invoice_settlements for each row execute function public.reject_source_mutation();

create view public.active_invoice_allocations with(security_invoker=true) as
select a.* from public.invoice_settlements a where event_kind='allocation'
and not exists(select 1 from public.invoice_settlements r where r.reverses_id=a.id and r.user_id=a.user_id);
create view public.invoice_payment_balances with(security_invoker=true) as
select i.id,i.user_id,i.number,i.invoice_date,i.client_id,i.status,i.currency,i.updated_at,
  i.delivery_status,i.paid_at,(i.amount*100)::bigint as invoice_pence,
  coalesce(a.allocated_pence,0)::bigint as allocated_pence,
  ((i.amount*100)-coalesce(a.allocated_pence,0))::bigint as outstanding_pence
from public.invoices i left join (
  select user_id,invoice_id,sum(amount_pence) allocated_pence from public.active_invoice_allocations group by user_id,invoice_id
) a on a.invoice_id=i.id and a.user_id=i.user_id;
create view public.receipt_allocation_balances with(security_invoker=true) as
select t.id,t.user_id,t.import_id,t.transaction_date,t.description,t.reference,t.signed_amount_pence,t.currency,t.classification,
  t.business_use_bps,t.dedupe_status,t.decision_version,t.source_row_id,t.recognized_record_id,
  f.status as record_status,(f.amount*100)::bigint as recognized_pence,
  coalesce(a.allocated_pence,0)::bigint as allocated_pence,
  (t.signed_amount_pence-coalesce(a.allocated_pence,0))::bigint as unallocated_pence
from public.bank_transactions t left join public.financial_records f on f.id=t.recognized_record_id and f.user_id=t.user_id
left join (select user_id,transaction_id,sum(amount_pence) allocated_pence from public.active_invoice_allocations group by user_id,transaction_id) a
on a.transaction_id=t.id and a.user_id=t.user_id where t.signed_amount_pence>0;
revoke all on public.active_invoice_allocations,public.invoice_payment_balances,public.receipt_allocation_balances from public,anon,authenticated;
grant select on public.active_invoice_allocations,public.invoice_payment_balances,public.receipt_allocation_balances to authenticated;

create function public.protect_settled_invoice() returns trigger language plpgsql set search_path='' as $$
declare row_id uuid; row_owner uuid;
begin
  if tg_op='DELETE' then row_id:=old.id; row_owner:=old.user_id; else row_id:=new.id; row_owner:=new.user_id; end if;
  if exists(select 1 from public.invoice_settlements where invoice_id=row_id and user_id=row_owner) then
    if tg_op='DELETE' then raise exception 'Preserve invoices with settlement history.'; end if;
    if (new.user_id,new.client_id,new.amount,new.currency,new.number,new.invoice_date,new.description,new.status)
       is distinct from (old.user_id,old.client_id,old.amount,old.currency,old.number,old.invoice_date,old.description,old.status)
       then raise exception 'Invoices with settlement history require a reviewed correction.'; end if;
    if current_user in ('authenticated','anon') and
      (new.paid_at is distinct from old.paid_at or (new.delivery_status is distinct from old.delivery_status and (new.delivery_status='paid' or old.delivery_status='paid')))
      then raise exception 'Use reconciliation to change evidence-backed paid status.'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
create trigger protect_invoice_settlement_facts before update or delete on public.invoices for each row execute function public.protect_settled_invoice();

create function public.sync_invoice_settlement_state(p_invoice uuid,p_owner uuid) returns void
language plpgsql security definer set search_path='' as $$
declare total bigint; paid bigint; last_date date;
begin
  select (amount*100)::bigint into total from public.invoices where id=p_invoice and user_id=p_owner for update;
  select coalesce(sum(a.amount_pence),0)::bigint,max(t.transaction_date) into paid,last_date
    from public.active_invoice_allocations a join public.bank_transactions t on t.id=a.transaction_id and t.user_id=a.user_id
    where a.invoice_id=p_invoice and a.user_id=p_owner;
  update public.invoices set delivery_status=case when paid>=total and total>0 then 'paid' when sent_at is not null then 'sent' else 'not_sent' end,
    paid_at=case when paid>=total and total>0 then last_date::timestamp at time zone 'UTC' else null end,
    reminder_enabled=false,next_reminder_at=null where id=p_invoice and user_id=p_owner;
end; $$;
revoke all on function public.sync_invoice_settlement_state(uuid,uuid) from public,anon,authenticated,service_role;

create function public.approve_invoice_allocations(p_transaction uuid,p_version integer,p_allocations jsonb,p_reason text,p_request uuid,p_expected_allocated bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); tx public.bank_transactions; inv public.invoices; entry jsonb; existing public.settlement_requests;
  payload text; amount bigint; requested bigint:=0; allocated bigint; total bigint; settlement_id uuid; ids jsonb:='[]'; result jsonb;
begin
  if owner_id is null then raise exception 'Sign in to reconcile receipts.'; end if;
  if p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Confirm the allocation with a reason and request ID.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reconciliation:'||owner_id::text,0));
  payload:=md5(jsonb_build_object('action','allocate','transaction',p_transaction,'version',p_version,'allocations',p_allocations,'expected_allocated',p_expected_allocated,'reason',btrim(p_reason))::text);
  select * into existing from public.settlement_requests where user_id=owner_id and request_id=p_request;
  if found then
    if existing.payload_hash<>payload then raise exception 'Request ID was already used for a different review.'; end if;
    return existing.result;
  end if;
  if jsonb_typeof(p_allocations) is distinct from 'array' then raise exception 'Choose invoice allocations.'; end if;
  if jsonb_array_length(p_allocations) not between 1 and 50 or
    (select count(distinct value->>'invoice_id') from jsonb_array_elements(p_allocations))<>jsonb_array_length(p_allocations)
    then raise exception 'Choose 1 to 50 distinct invoices.'; end if;
  select * into tx from public.bank_transactions where id=p_transaction and user_id=owner_id for update;
  if not found then raise exception 'Receipt not found.'; end if;
  if tx.decision_version is distinct from p_version then raise exception 'Receipt decision changed. Review again.'; end if;
  if tx.signed_amount_pence<=0 or tx.currency<>'GBP' or tx.classification<>'Business' or tx.business_use_bps<>10000 or tx.dedupe_status<>'clear' or
    not exists(select 1 from public.record_imports where id=tx.import_id and user_id=owner_id and status<>'discarded') or
    not exists(select 1 from public.financial_records f where f.id=tx.recognized_record_id and f.user_id=owner_id and f.record_type='income' and f.status='approved' and f.amount*100=tx.signed_amount_pence)
    then raise exception 'Review the complete receipt as Business income before allocating it.'; end if;
  -- Invoice row locks serialize allocations with ordinary invoice edits too.
  perform 1 from public.invoices where user_id=owner_id and id in (select (value->>'invoice_id')::uuid from jsonb_array_elements(p_allocations)) order by id for update;
  for entry in select value from jsonb_array_elements(p_allocations) loop
    if (entry->>'amount_pence') is null or (entry->>'amount_pence') !~ '^[1-9][0-9]{0,11}$' then raise exception 'Allocation must be positive integer pence.'; end if;
    amount:=(entry->>'amount_pence')::bigint;
    select * into inv from public.invoices where id=(entry->>'invoice_id')::uuid and user_id=owner_id;
    if not found or inv.status<>'finalised' or inv.currency<>'GBP' then raise exception 'Choose an owned finalised GBP invoice.'; end if;
    if inv.updated_at is distinct from (entry->>'invoice_updated_at')::timestamptz then raise exception 'Invoice changed. Reload the review.'; end if;
    total:=(inv.amount*100)::bigint;
    select coalesce(sum(amount_pence),0)::bigint into allocated from public.active_invoice_allocations where invoice_id=inv.id and user_id=owner_id;
    if amount>total-allocated then raise exception 'Allocation exceeds invoice outstanding amount.'; end if;
    requested:=requested+amount;
  end loop;
  select coalesce(sum(amount_pence),0)::bigint into allocated from public.active_invoice_allocations where transaction_id=tx.id and user_id=owner_id;
  if allocated is distinct from p_expected_allocated then raise exception 'Receipt allocations changed. Review the remaining amount again.'; end if;
  if requested>tx.signed_amount_pence-allocated then raise exception 'Allocations exceed unallocated receipt amount.'; end if;
  for entry in select value from jsonb_array_elements(p_allocations) loop
    select * into inv from public.invoices where id=(entry->>'invoice_id')::uuid and user_id=owner_id;
    insert into public.invoice_settlements(user_id,invoice_id,transaction_id,amount_pence,event_kind,request_id,invoice_snapshot,author,rationale)
      values(owner_id,inv.id,tx.id,(entry->>'amount_pence')::bigint,'allocation',p_request,
        jsonb_build_object('number',inv.number,'invoice_date',inv.invoice_date,'client_id',inv.client_id,'gross_pence',(inv.amount*100)::bigint,'currency',inv.currency,'status',inv.status,'updated_at',inv.updated_at),owner_id,btrim(p_reason)) returning id into settlement_id;
    ids:=ids||jsonb_build_array(settlement_id);
    perform public.sync_invoice_settlement_state(inv.id,owner_id);
  end loop;
  result:=jsonb_build_object('allocation_ids',ids,'allocated_pence',requested,'unallocated_pence',tx.signed_amount_pence-allocated-requested);
  insert into public.settlement_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);
  return result;
end; $$;
revoke all on function public.approve_invoice_allocations(uuid,integer,jsonb,text,uuid,bigint) from public,anon;
grant execute on function public.approve_invoice_allocations(uuid,integer,jsonb,text,uuid,bigint) to authenticated;

create function public.reverse_invoice_allocation(p_allocation uuid,p_reason text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); a public.invoice_settlements; existing public.settlement_requests; payload text; reversal uuid; result jsonb;
begin
  if owner_id is null then raise exception 'Sign in to reverse allocations.'; end if;
  if p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Confirm a reason and request ID.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reconciliation:'||owner_id::text,0));
  payload:=md5(jsonb_build_object('action','reverse','allocation',p_allocation,'reason',btrim(p_reason))::text);
  select * into existing from public.settlement_requests where user_id=owner_id and request_id=p_request;
  if found then
    if existing.payload_hash<>payload then raise exception 'Request ID was already used for a different review.'; end if;
    return existing.result;
  end if;
  select * into a from public.active_invoice_allocations where id=p_allocation and user_id=owner_id;
  if not found then raise exception 'Active allocation not found.'; end if;
  perform 1 from public.bank_transactions where id=a.transaction_id and user_id=owner_id for update;
  perform 1 from public.invoices where id=a.invoice_id and user_id=owner_id for update;
  insert into public.invoice_settlements(user_id,invoice_id,transaction_id,amount_pence,event_kind,reverses_id,request_id,invoice_snapshot,author,rationale)
    values(owner_id,a.invoice_id,a.transaction_id,a.amount_pence,'reversal',a.id,p_request,a.invoice_snapshot,owner_id,btrim(p_reason)) returning id into reversal;
  perform public.sync_invoice_settlement_state(a.invoice_id,owner_id);
  result:=jsonb_build_object('reversal_id',reversal,'restored_outstanding_pence',a.amount_pence);
  insert into public.settlement_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);
  return result;
end; $$;
revoke all on function public.reverse_invoice_allocation(uuid,text,uuid) from public,anon;
grant execute on function public.reverse_invoice_allocation(uuid,text,uuid) to authenticated;

-- Wrap existing review functions so every affected mutation takes the same lock first.
alter function public.review_bank_transaction(uuid,integer,text,uuid,integer,text) rename to review_bank_transaction_v1;
revoke all on function public.review_bank_transaction_v1(uuid,integer,text,uuid,integer,text) from public,anon,authenticated,service_role;
create function public.review_bank_transaction(p_id uuid,p_version integer,p_classification text,p_category uuid,p_bps integer,p_rationale text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();
begin
  if owner_id is null then raise exception 'Sign in to review transactions.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reconciliation:'||owner_id::text,0));
  if exists(select 1 from public.active_invoice_allocations where transaction_id=p_id and user_id=owner_id) then raise exception 'Reverse invoice allocations before changing this receipt classification.'; end if;
  return public.review_bank_transaction_v1(p_id,p_version,p_classification,p_category,p_bps,p_rationale);
end; $$;
revoke all on function public.review_bank_transaction(uuid,integer,text,uuid,integer,text) from public,anon;
grant execute on function public.review_bank_transaction(uuid,integer,text,uuid,integer,text) to authenticated;

create or replace function public.source_import_summary(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
  with tx as (select * from public.bank_transactions where import_id=p_id and user_id=(select auth.uid())),
  allocations as (select a.* from public.active_invoice_allocations a join tx on tx.id=a.transaction_id and tx.user_id=a.user_id),
  events as (select a.id from public.invoice_settlements a join tx on tx.id=a.transaction_id and tx.user_id=a.user_id)
  select jsonb_build_object('transactions',count(tx.id),
    'income_pence',coalesce(sum(case when f.status='approved' and tx.signed_amount_pence>0 then f.amount*100 else 0 end),0),
    'expense_pence',coalesce(sum(case when f.status='approved' and tx.signed_amount_pence<0 then f.amount*100 else 0 end),0),
    'allocation_count',(select count(*) from allocations),'allocation_pence',(select coalesce(sum(amount_pence),0) from allocations),
    'stamp',md5(coalesce(string_agg(tx.id::text||':'||tx.decision_version::text,',' order by tx.id),'')||'|'||(select coalesce(string_agg(id::text,',' order by id),'') from events)))
  from tx left join public.financial_records f on f.id=tx.recognized_record_id and f.user_id=tx.user_id;
$$;

alter function public.reverse_source_import(uuid,text,text) rename to reverse_source_import_v1;
revoke all on function public.reverse_source_import_v1(uuid,text,text) from public,anon,authenticated,service_role;
create function public.reverse_source_import(p_id uuid,p_stamp text,p_reason text) returns integer
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); summary jsonb; a public.invoice_settlements;
begin
  if owner_id is null then raise exception 'Sign in to reverse an import.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reconciliation:'||owner_id::text,0));
  if not exists(select 1 from public.record_imports where id=p_id and user_id=owner_id and source_file_id is not null) then raise exception 'Preserved import not found.'; end if;
  if exists(select 1 from public.record_imports where id=p_id and user_id=owner_id and status='discarded') then return 0; end if;
  summary:=public.source_import_summary(p_id);
  if (summary->>'stamp') is distinct from p_stamp then raise exception 'Import decisions or allocations changed. Review the totals again.'; end if;
  for a in select s.* from public.active_invoice_allocations s join public.bank_transactions t on t.id=s.transaction_id and t.user_id=s.user_id where t.import_id=p_id and t.user_id=owner_id order by s.id loop
    perform public.reverse_invoice_allocation(a.id,'Import reversal: '||left(btrim(p_reason),980),gen_random_uuid());
  end loop;
  summary:=public.source_import_summary(p_id);
  return public.reverse_source_import_v1(p_id,summary->>'stamp',p_reason);
end; $$;
revoke all on function public.reverse_source_import(uuid,text,text) from public,anon;
grant execute on function public.reverse_source_import(uuid,text,text) to authenticated;

-- Detect changes across separately paged export reads. This is a consistency guard,
-- not a locked filing snapshot or an authenticity signature.
create function public.reconciliation_export_stamp() returns text language sql stable security invoker set search_path='' as $$
  select md5(
    (select coalesce(string_agg(id::text||':'||updated_at::text,',' order by id),'') from public.invoices where user_id=(select auth.uid()))||'|'||
    (select coalesce(string_agg(id::text||':'||decision_version::text,',' order by id),'') from public.bank_transactions where user_id=(select auth.uid()))||'|'||
    (select coalesce(string_agg(id::text,',' order by id),'') from public.invoice_settlements where user_id=(select auth.uid()))
  );
$$;
revoke all on function public.reconciliation_export_stamp() from public,anon;
grant execute on function public.reconciliation_export_stamp() to authenticated;

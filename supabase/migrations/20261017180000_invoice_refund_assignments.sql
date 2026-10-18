-- Commercial reconciliation only. The bank refund already supplies its accounting effect.
create table public.invoice_refund_requests (
 user_id uuid not null references auth.users(id),request_id uuid not null,payload_hash text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(user_id,request_id)
);
create table public.invoice_refund_assignments (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),invoice_id uuid not null,allocation_id uuid not null,credit_id uuid not null,refund_id uuid not null,
 amount_pence bigint not null check(amount_pence between 1 and 999999999999),author uuid not null references auth.users(id),rationale text not null check(length(btrim(rationale)) between 1 and 1000),request_id uuid not null,created_at timestamptz not null default now(),
 invoice_snapshot jsonb not null,allocation_snapshot jsonb not null,credit_snapshot jsonb not null,refund_snapshot jsonb not null,
 unique(id,user_id),unique(user_id,request_id),foreign key(invoice_id,user_id) references public.invoices(id,user_id),foreign key(allocation_id,user_id) references public.invoice_settlements(id,user_id),
 foreign key(credit_id,user_id) references public.invoice_credit_notes(id,user_id),foreign key(refund_id,user_id) references public.refund_links(id,user_id),
 foreign key(user_id,request_id) references public.invoice_refund_requests(user_id,request_id) deferrable initially deferred
);
create table public.invoice_refund_assignment_reversals (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),assignment_id uuid not null unique,author uuid not null references auth.users(id),rationale text not null check(length(btrim(rationale)) between 1 and 1000),request_id uuid not null,created_at timestamptz not null default now(),
 unique(user_id,request_id),foreign key(assignment_id,user_id) references public.invoice_refund_assignments(id,user_id),foreign key(user_id,request_id) references public.invoice_refund_requests(user_id,request_id) deferrable initially deferred
);
create index invoice_refund_invoice on public.invoice_refund_assignments(user_id,invoice_id,id);
create index invoice_refund_allocation on public.invoice_refund_assignments(user_id,allocation_id,id);
create index invoice_refund_credit on public.invoice_refund_assignments(user_id,credit_id,id);
create index invoice_refund_refund on public.invoice_refund_assignments(user_id,refund_id,id);
create index invoice_refund_reversal_owner on public.invoice_refund_assignment_reversals(user_id,id);
alter table public.invoice_refund_requests enable row level security;
alter table public.invoice_refund_assignments enable row level security;
alter table public.invoice_refund_assignment_reversals enable row level security;
revoke all on public.invoice_refund_requests,public.invoice_refund_assignments,public.invoice_refund_assignment_reversals from public,anon,authenticated,service_role;
grant select on public.invoice_refund_requests,public.invoice_refund_assignments,public.invoice_refund_assignment_reversals to authenticated,service_role;
create policy invoice_refund_requests_read on public.invoice_refund_requests for select to authenticated using(user_id=(select auth.uid()));
create policy invoice_refund_assignments_read on public.invoice_refund_assignments for select to authenticated using(user_id=(select auth.uid()));
create policy invoice_refund_reversals_read on public.invoice_refund_assignment_reversals for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_invoice_refund_requests before update or delete on public.invoice_refund_requests for each row execute function public.reject_source_mutation();
create trigger immutable_invoice_refund_assignments before update or delete on public.invoice_refund_assignments for each row execute function public.reject_source_mutation();
create trigger immutable_invoice_refund_reversals before update or delete on public.invoice_refund_assignment_reversals for each row execute function public.reject_source_mutation();
create view public.active_invoice_refund_assignments with(security_invoker=true) as select a.* from public.invoice_refund_assignments a where not exists(select 1 from public.invoice_refund_assignment_reversals r where r.assignment_id=a.id and r.user_id=a.user_id);
revoke all on public.active_invoice_refund_assignments from public,anon,authenticated,service_role;
grant select on public.active_invoice_refund_assignments to authenticated,service_role;

create function public.protect_invoice_refund_parents() returns trigger language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||new.user_id::text,0));
 if tg_table_name='invoice_settlements' then
  if new.event_kind='reversal' and exists(select 1 from public.active_invoice_refund_assignments where allocation_id=new.reverses_id and user_id=new.user_id) then raise exception 'Reverse invoice refund assignments before reversing this receipt allocation.'; end if;
 elsif tg_table_name='invoice_credit_reversals' then
  if exists(select 1 from public.active_invoice_refund_assignments where credit_id=new.credit_id and user_id=new.user_id) then raise exception 'Reverse invoice refund assignments before reversing this credit.'; end if;
 elsif tg_table_name='refund_reversals' then
  if exists(select 1 from public.active_invoice_refund_assignments where refund_id=new.refund_id and user_id=new.user_id) then raise exception 'Reverse invoice refund assignments before reversing this refund group or source import.'; end if;
 end if;
 return new;
end; $$;
create trigger protect_assigned_allocation before insert on public.invoice_settlements for each row execute function public.protect_invoice_refund_parents();
create trigger protect_assigned_credit before insert on public.invoice_credit_reversals for each row execute function public.protect_invoice_refund_parents();
create trigger protect_assigned_refund before insert on public.refund_reversals for each row execute function public.protect_invoice_refund_parents();

create or replace view public.invoice_payment_balances with(security_invoker=true) as
select i.id,i.user_id,i.number,i.invoice_date,i.client_id,i.status,i.currency,i.updated_at,i.delivery_status,i.paid_at,(i.amount*100)::bigint invoice_pence,
 coalesce(a.allocated_pence,0)::bigint allocated_pence,
 greatest((i.amount*100)-coalesce(c.credited_pence,0)-coalesce(a.allocated_pence,0)+coalesce(f.returned_pence,0),0)::bigint outstanding_pence,
 coalesce(c.credited_pence,0)::bigint credited_pence,((i.amount*100)-coalesce(c.credited_pence,0))::bigint entitlement_pence,
 greatest(coalesce(a.allocated_pence,0)-coalesce(f.returned_pence,0)-(i.amount*100)+coalesce(c.credited_pence,0),0)::bigint refund_due_pence,
 (coalesce(a.allocated_pence,0)-coalesce(f.returned_pence,0))::bigint retained_cash_pence,
 coalesce(c.net_pence,0)::bigint credited_net_pence,coalesce(c.vat_pence,0)::bigint credited_vat_pence,
 case when coalesce(a.allocated_pence,0)-coalesce(f.returned_pence,0)>(i.amount*100)-coalesce(c.credited_pence,0) then 'refund_due'
 when i.amount*100=coalesce(c.credited_pence,0) then 'fully_credited'
 when coalesce(a.allocated_pence,0)-coalesce(f.returned_pence,0)=i.amount*100-coalesce(c.credited_pence,0) then 'settled'
 when coalesce(a.allocated_pence,0)-coalesce(f.returned_pence,0)>0 then 'part_paid' else 'unpaid' end settlement_state,
 exists(select 1 from public.invoice_settlements s where s.invoice_id=i.id and s.user_id=i.user_id) or exists(select 1 from public.invoice_credit_notes c where c.invoice_id=i.id and c.user_id=i.user_id) as has_reconciliation_history,
 exists(select 1 from public.invoice_credit_notes c where c.invoice_id=i.id and c.user_id=i.user_id) as has_credit_history,
 coalesce(f.returned_pence,0)::bigint returned_pence,i.due_date
from public.invoices i
left join(select user_id,invoice_id,sum(amount_pence) allocated_pence from public.active_invoice_allocations group by user_id,invoice_id) a on a.invoice_id=i.id and a.user_id=i.user_id
left join(select user_id,invoice_id,sum(gross_pence) credited_pence,sum(net_pence) net_pence,sum(vat_pence) vat_pence from public.active_invoice_credits group by user_id,invoice_id) c on c.invoice_id=i.id and c.user_id=i.user_id
left join(select user_id,invoice_id,sum(amount_pence) returned_pence from public.active_invoice_refund_assignments group by user_id,invoice_id) f on f.invoice_id=i.id and f.user_id=i.user_id;

-- Preserve every existing choice-column position; append returned cash last.
create or replace view public.invoice_credit_choices with(security_invoker=true) as
select b.id,b.user_id,b.number,b.invoice_date,b.client_id,b.status,b.currency,b.updated_at,b.delivery_status,b.paid_at,b.invoice_pence,b.allocated_pence,b.outstanding_pence,b.credited_pence,b.entitlement_pence,b.refund_due_pence,b.retained_cash_pence,b.credited_net_pence,b.credited_vat_pence,b.settlement_state,b.has_reconciliation_history,b.has_credit_history,
 i.net_pence,i.vat_pence,i.vat_rate_bps,i.vat_number_snapshot,i.economics_version,i.description,public.invoice_balance_stamp(i.id) balance_stamp,
 coalesce((select max(ordinal) from public.invoice_credit_notes c where c.invoice_id=i.id and c.user_id=i.user_id),0)+1 next_ordinal,b.returned_pence
from public.invoice_payment_balances b join public.invoices i on i.id=b.id and i.user_id=b.user_id;

create view public.customer_refund_balances with(security_invoker=true) as
select r.id,r.user_id,r.original_transaction_id,r.refund_transaction_id,r.amount_pence,coalesce(s.assigned_pence,0)::bigint assigned_pence,(r.amount_pence-coalesce(s.assigned_pence,0))::bigint unassigned_pence,
 t.transaction_date,t.description,t.import_id,t.source_row_id,a.label account_label,a.masked_identifier account_mask,
 o.import_id original_import_id,o.transaction_date original_date,o.description original_description
from public.active_refunds r
join public.bank_transactions t on t.id=r.refund_transaction_id and t.user_id=r.user_id
join public.bank_transactions o on o.id=r.original_transaction_id and o.user_id=r.user_id
join public.financial_accounts a on a.id=t.account_id and a.user_id=t.user_id
left join(select user_id,refund_id,sum(amount_pence) assigned_pence from public.active_invoice_refund_assignments group by user_id,refund_id) s on s.refund_id=r.id and s.user_id=r.user_id
where r.record_type='income' and r.business_use_bps=10000;
create view public.invoice_refund_choices with(security_invoker=true) as
select c.id::text||':'||a.id::text id,c.user_id,c.id credit_id,c.number credit_number,c.pdf_sha256 credit_pdf_sha256,a.id allocation_id,r.id refund_id,r.original_transaction_id,r.refund_transaction_id,
 b.id invoice_id,b.number invoice_number,b.invoice_pence,b.allocated_pence,b.credited_pence,b.returned_pence,b.retained_cash_pence,b.outstanding_pence,b.refund_due_pence,
 (c.gross_pence-coalesce(cs.assigned_pence,0))::bigint credit_remaining_pence,(a.amount_pence-coalesce(ax.assigned_pence,0))::bigint allocation_remaining_pence,r.unassigned_pence refund_remaining_pence
from public.customer_refund_balances r
join public.active_invoice_allocations a on a.transaction_id=r.original_transaction_id and a.user_id=r.user_id
join public.active_invoice_credits c on c.invoice_id=a.invoice_id and c.user_id=a.user_id
join public.invoice_payment_balances b on b.id=c.invoice_id and b.user_id=c.user_id
left join(select user_id,credit_id,sum(amount_pence) assigned_pence from public.active_invoice_refund_assignments group by user_id,credit_id) cs on cs.credit_id=c.id and cs.user_id=c.user_id
left join(select user_id,allocation_id,sum(amount_pence) assigned_pence from public.active_invoice_refund_assignments group by user_id,allocation_id) ax on ax.allocation_id=a.id and ax.user_id=a.user_id;
revoke all on public.customer_refund_balances,public.invoice_refund_choices from public,anon,authenticated,service_role;
grant select on public.customer_refund_balances,public.invoice_refund_choices to authenticated;

create function public.approve_invoice_refund_assignment(p_credit uuid,p_allocation uuid,p_refund uuid,p_amount bigint,p_stamp text,p_reason text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); c public.invoice_credit_notes; a public.invoice_settlements; r public.refund_links; prior public.invoice_refund_requests; b record; payload text; assignment uuid; result jsonb; used bigint;
begin
 if owner_id is null then raise exception 'Sign in to match recorded refunds.'; end if;
 if p_credit is null or p_allocation is null or p_refund is null or p_request is null or p_amount is null or p_amount not between 1 and 999999999999 or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Review the exact refund assignment and reason.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 payload:=encode(sha256(convert_to(jsonb_build_object('action','assign','credit',p_credit,'allocation',p_allocation,'refund',p_refund,'amount',p_amount,'stamp',p_stamp,'reason',btrim(p_reason))::text,'UTF8')),'hex');
 select * into prior from public.invoice_refund_requests where user_id=owner_id and request_id=p_request;
 if found then if prior.payload_hash<>payload then raise exception 'Refund assignment request changed.'; end if; return prior.result; end if;
 if public.reconciliation_export_stamp() is distinct from p_stamp then raise exception 'Reconciliation changed. Review the refund assignment again.'; end if;
 select * into c from public.active_invoice_credits where id=p_credit and user_id=owner_id;
 if not found then raise exception 'Active owned credit not found.'; end if;
 select * into a from public.active_invoice_allocations where id=p_allocation and user_id=owner_id and invoice_id=c.invoice_id;
 if not found then raise exception 'Choose the original receipt allocation for this invoice.'; end if;
 select * into r from public.active_refunds where id=p_refund and user_id=owner_id and original_transaction_id=a.transaction_id and record_type='income' and business_use_bps=10000;
 if not found then raise exception 'Choose an active customer refund of this original receipt.'; end if;
 perform 1 from public.invoices where id=c.invoice_id and user_id=owner_id for update;
 select * into b from public.invoice_payment_balances where id=c.invoice_id and user_id=owner_id and status='finalised' and currency='GBP';
 if not found then raise exception 'Choose a finalised GBP invoice.'; end if;
 if not exists(select 1 from public.bank_transactions t join public.financial_records f on f.id=t.recognized_record_id and f.user_id=t.user_id join public.record_imports i on i.id=t.import_id and i.user_id=t.user_id where t.id=r.refund_transaction_id and t.user_id=owner_id and t.active_refund_id=r.id and t.currency='GBP' and t.signed_amount_pence=-r.amount_pence and f.status='approved' and f.record_type='income' and f.effect_sign=-1 and f.refund_link_id=r.id and i.status<>'discarded') then raise exception 'Review the recorded refund cash before assigning it.'; end if;
 select coalesce(sum(amount_pence),0) into used from public.active_invoice_refund_assignments where user_id=owner_id and refund_id=r.id;
 if p_amount>r.amount_pence-used then raise exception 'Assignment exceeds remaining refund cash.'; end if;
 select coalesce(sum(amount_pence),0) into used from public.active_invoice_refund_assignments where user_id=owner_id and allocation_id=a.id;
 if p_amount>a.amount_pence-used then raise exception 'Assignment exceeds the original receipt allocation.'; end if;
 select coalesce(sum(amount_pence),0) into used from public.active_invoice_refund_assignments where user_id=owner_id and credit_id=c.id;
 if p_amount>c.gross_pence-used or p_amount>b.allocated_pence-b.returned_pence or p_amount>b.credited_pence-b.returned_pence then raise exception 'Assignment exceeds remaining invoice credit or receipt capacity.'; end if;
 insert into public.invoice_refund_assignments(user_id,invoice_id,allocation_id,credit_id,refund_id,amount_pence,author,rationale,request_id,invoice_snapshot,allocation_snapshot,credit_snapshot,refund_snapshot)
 values(owner_id,c.invoice_id,a.id,c.id,r.id,p_amount,owner_id,btrim(p_reason),p_request,to_jsonb(b),to_jsonb(a),to_jsonb(c),to_jsonb(r)) returning id into assignment;
 perform public.sync_invoice_settlement_state(c.invoice_id,owner_id);
 result:=jsonb_build_object('assignment_id',assignment,'amount_pence',p_amount,'recognized_income_change_pence',0);
 insert into public.invoice_refund_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);
 return result;
end; $$;
revoke all on function public.approve_invoice_refund_assignment(uuid,uuid,uuid,bigint,text,text,uuid) from public,anon,service_role;
grant execute on function public.approve_invoice_refund_assignment(uuid,uuid,uuid,bigint,text,text,uuid) to authenticated;

create function public.reverse_invoice_refund_assignment(p_assignment uuid,p_stamp text,p_reason text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); a public.invoice_refund_assignments; prior public.invoice_refund_requests; payload text; reversal uuid; result jsonb;
begin
 if owner_id is null then raise exception 'Sign in to reverse refund assignments.'; end if;
 if p_assignment is null or p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Review the reversal and reason.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 payload:=encode(sha256(convert_to(jsonb_build_object('action','reverse','assignment',p_assignment,'stamp',p_stamp,'reason',btrim(p_reason))::text,'UTF8')),'hex');
 select * into prior from public.invoice_refund_requests where user_id=owner_id and request_id=p_request;
 if found then if prior.payload_hash<>payload then raise exception 'Refund assignment request changed.'; end if; return prior.result; end if;
 if public.reconciliation_export_stamp() is distinct from p_stamp then raise exception 'Reconciliation changed. Review the refund reversal again.'; end if;
 select * into a from public.active_invoice_refund_assignments where id=p_assignment and user_id=owner_id;
 if not found then raise exception 'Active owned refund assignment not found.'; end if;
 perform 1 from public.invoices where id=a.invoice_id and user_id=owner_id for update;
 insert into public.invoice_refund_assignment_reversals(user_id,assignment_id,author,rationale,request_id) values(owner_id,a.id,owner_id,btrim(p_reason),p_request) returning id into reversal;
 perform public.sync_invoice_settlement_state(a.invoice_id,owner_id);
 result:=jsonb_build_object('reversal_id',reversal,'amount_pence',a.amount_pence,'recognized_income_change_pence',0);
 insert into public.invoice_refund_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);
 return result;
end; $$;
revoke all on function public.reverse_invoice_refund_assignment(uuid,text,text,uuid) from public,anon,service_role;
grant execute on function public.reverse_invoice_refund_assignment(uuid,text,text,uuid) to authenticated;


-- Updated compatibility consumers and review stamps.
create or replace function public.approve_invoice_allocations_v1(p_transaction uuid,p_version integer,p_allocations jsonb,p_reason text,p_request uuid,p_expected_allocated bigint)
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
    select entitlement_pence+returned_pence into total from public.invoice_payment_balances where id=inv.id and user_id=owner_id;
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

create or replace function public.approve_invoice_credit(p_invoice uuid,p_credit uuid,p_stamp text,p_date date,p_gross bigint,p_reason text,p_document jsonb,p_pdf_path text,p_pdf_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); inv public.invoices; b record; prior public.invoice_credit_requests; existing_credit public.invoice_credit_notes; revision public.invoice_revisions;
 n bigint; v bigint; next_no integer; note_number text; payload text; result jsonb;
begin
 if owner_id is null then raise exception 'Sign in to review invoice credits.'; end if;
 if p_credit is null or p_invoice is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 or p_gross is null or p_gross not between 1 and 999999999999 or p_date is null then raise exception 'Check credit amount, date and reason.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 payload:=encode(sha256(convert_to(jsonb_build_object('invoice',p_invoice,'stamp',p_stamp,'date',p_date,'gross',p_gross,'reason',btrim(p_reason),'document',p_document,'pdf_path',p_pdf_path,'pdf_sha256',p_pdf_sha256)::text,'UTF8')),'hex');
 select * into prior from public.invoice_credit_requests where user_id=owner_id and request_id=p_credit;
 if found then if prior.payload_hash<>payload then raise exception 'Credit request changed.'; end if; return prior.result; end if;
 select * into inv from public.invoices where id=p_invoice and user_id=owner_id for update;
 if not found or inv.status<>'finalised' or inv.currency<>'GBP' then raise exception 'Choose your finalised GBP invoice.'; end if;
 if public.invoice_balance_stamp(inv.id) is distinct from p_stamp then raise exception 'Invoice balance changed. Review again.'; end if;
 select * into b from public.invoice_credit_choices where id=inv.id and user_id=owner_id;
 if p_gross>b.invoice_pence-b.credited_pence then raise exception 'Credit exceeds remaining invoice value.'; end if;
 if p_date<inv.invoice_date or p_date>(now() at time zone 'Europe/London')::date then raise exception 'Credit date must be between invoice date and today.'; end if;
 if inv.net_pence is not null then
  n:=round((b.credited_pence+p_gross)::numeric*inv.net_pence/b.invoice_pence)::bigint-b.credited_net_pence;v:=p_gross-n;
  if n<0 or v<0 or b.credited_net_pence+n>inv.net_pence or b.credited_vat_pence+v>inv.vat_pence then raise exception 'Credit exceeds verified invoice economics.'; end if;
 end if;
 select coalesce(max(ordinal),0)+1 into next_no from public.invoice_credit_notes where invoice_id=inv.id and user_id=owner_id;
 note_number:='CN-'||inv.number||'-'||lpad(next_no::text,greatest(3,length(next_no::text)),'0');
 if jsonb_typeof(p_document) is distinct from 'object' or p_document->>'number' is distinct from note_number or p_document->>'creditDate' is distinct from p_date::text or p_document->>'invoiceNumber' is distinct from inv.number or p_document->>'invoiceDate' is distinct from inv.invoice_date::text
  or p_document->>'taxStatus' is distinct from (case when n is null then 'unverified' else 'invoice_snapshot' end) or p_document->>'vatRateBps' is distinct from (case when n is null then null else inv.vat_rate_bps::text end) or p_document->>'vatNumber' is distinct from (case when n is null then '' else coalesce(inv.vat_number_snapshot,'') end)
  or p_document->>'grossPence' is distinct from p_gross::text or p_document->>'netPence' is distinct from n::text or p_document->>'vatPence' is distinct from v::text
  or p_document->>'description' is distinct from inv.description or coalesce(p_document->>'reviewHash','') !~ '^[a-f0-9]{64}$'
  or coalesce(length(btrim(p_document->>'sellerName')),0) not between 1 and 200 or coalesce(length(btrim(p_document->>'clientName')),0) not between 1 and 200
  or coalesce(length(p_document->>'sellerAddress'),0)>1000 or coalesce(length(p_document->>'clientAddress'),0)>1000 or p_document->>'reason' is distinct from btrim(p_reason)
  then raise exception 'Reviewed document does not match the credit.'; end if;
 if p_pdf_path is distinct from owner_id::text||'/credits/'||p_credit::text||'.pdf' or p_pdf_sha256 is null or p_pdf_sha256 !~ '^[a-f0-9]{64}$' or not exists(select 1 from storage.objects where bucket_id='invoices' and name=p_pdf_path) then raise exception 'Preserve the credit PDF before approval.'; end if;
 select * into revision from public.invoice_revisions where invoice_id=inv.id and user_id=owner_id and version=inv.economics_version;
 insert into public.invoice_credit_notes(id,user_id,invoice_id,ordinal,number,credit_date,gross_pence,net_pence,vat_pence,tax_status,invoice_snapshot,document_snapshot,pdf_path,pdf_sha256,author,rationale,request_id)
 values(p_credit,owner_id,inv.id,next_no,note_number,p_date,p_gross,n,v,case when n is null then 'unverified' else 'invoice_snapshot' end,
  to_jsonb(inv)||jsonb_build_object('revision_id',revision.id,'pdf_sha256',revision.pdf_sha256,'returned_pence',b.returned_pence,'allocated_pence',b.allocated_pence,'credited_pence',b.credited_pence,'outstanding_pence',b.outstanding_pence,'refund_due_pence',b.refund_due_pence),
  p_document,p_pdf_path,p_pdf_sha256,owner_id,btrim(p_reason),p_credit);
 perform public.sync_invoice_settlement_state(inv.id,owner_id);
 result:=jsonb_build_object('credit_id',p_credit,'number',note_number,'gross_pence',p_gross,'recognized_income_change_pence',0);
 insert into public.invoice_credit_requests(user_id,request_id,payload_hash,result) values(owner_id,p_credit,payload,result);
 return result;
end; $$;

create or replace function public.invoice_balance_stamp(p_invoice uuid) returns text language sql stable security invoker set search_path='' as $$
 select md5(coalesce((select updated_at::text from public.invoices where id=p_invoice and user_id=(select auth.uid())),'')||'|'||
 coalesce((select string_agg(c.id::text||':'||coalesce(r.id::text,''),',' order by c.id) from public.invoice_credit_notes c left join public.invoice_credit_reversals r on r.credit_id=c.id and r.user_id=c.user_id where c.invoice_id=p_invoice and c.user_id=(select auth.uid())),'')||'|'||
 coalesce((select string_agg(id::text,',' order by id) from public.invoice_settlements where invoice_id=p_invoice and user_id=(select auth.uid())), '')||'|'||coalesce((select string_agg(a.id::text||':'||coalesce(r.id::text,''),',' order by a.id) from public.invoice_refund_assignments a left join public.invoice_refund_assignment_reversals r on r.assignment_id=a.id and r.user_id=a.user_id where a.invoice_id=p_invoice and a.user_id=(select auth.uid())),''));
$$;

create or replace function public.refund_group_stamp(p_original uuid) returns text language sql stable security invoker set search_path='' as $$
 select md5(coalesce((select decision_version::text from public.bank_transactions where id=p_original and user_id=(select auth.uid())),'')||'|'||
 coalesce((select string_agg(l.id::text||':'||coalesce(r.id::text,''),',' order by l.id) from public.refund_links l left join public.refund_reversals r on r.refund_id=l.id and r.user_id=l.user_id where l.original_transaction_id=p_original and l.user_id=(select auth.uid())), '')||'|'||coalesce((select string_agg(a.id::text||':'||coalesce(r.id::text,''),',' order by a.id) from public.invoice_refund_assignments a join public.refund_links l on l.id=a.refund_id and l.user_id=a.user_id left join public.invoice_refund_assignment_reversals r on r.assignment_id=a.id and r.user_id=a.user_id where l.original_transaction_id=p_original and a.user_id=(select auth.uid())),''));
$$;

create or replace function public.source_import_summary(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
  with tx as (select * from public.bank_transactions where import_id=p_id and user_id=(select auth.uid())),
  allocations as (select a.* from public.active_invoice_allocations a join tx on tx.id=a.transaction_id and tx.user_id=a.user_id),
  invoice_events as (select a.id from public.invoice_settlements a join tx on tx.id=a.transaction_id and tx.user_id=a.user_id),
  pair_history as (select p.* from public.transfer_pairs p where p.user_id=(select auth.uid()) and exists(select 1 from tx where tx.id in (p.outgoing_transaction_id,p.incoming_transaction_id))),
  pairs as (select p.* from pair_history p where not exists(select 1 from public.transfer_reversals r where r.pair_id=p.id and r.user_id=p.user_id)),
  pair_stamp as (select coalesce(string_agg(p.id::text||':'||coalesce(r.id::text,''),',' order by p.id),'') stamp from pair_history p left join public.transfer_reversals r on r.pair_id=p.id and r.user_id=p.user_id),
  counterpart_stamp as (select coalesce(string_agg(t.id::text||':'||t.decision_version::text,',' order by t.id),'') stamp from public.bank_transactions t where t.user_id=(select auth.uid()) and exists(select 1 from pairs p where t.id in (p.outgoing_transaction_id,p.incoming_transaction_id)))
  , refund_originals as (select distinct l.original_transaction_id from public.refund_links l where l.user_id=(select auth.uid()) and exists(select 1 from tx where tx.id in (l.original_transaction_id,l.refund_transaction_id))),
  refund_history as (select l.* from public.refund_links l join refund_originals o on o.original_transaction_id=l.original_transaction_id where l.user_id=(select auth.uid())),
  refunds as (select l.* from refund_history l where not exists(select 1 from public.refund_reversals r where r.refund_id=l.id and r.user_id=l.user_id)),
  refund_stamp as (select coalesce(string_agg(l.id::text||':'||coalesce(r.id::text,''),',' order by l.id),'') stamp from refund_history l left join public.refund_reversals r on r.refund_id=l.id and r.user_id=l.user_id),
  refund_counterparts as (select coalesce(string_agg(t.id::text||':'||t.decision_version::text,',' order by t.id),'') stamp from public.bank_transactions t where t.user_id=(select auth.uid()) and exists(select 1 from refunds l where t.id in (l.original_transaction_id,l.refund_transaction_id)))
  , assignment_history as (select a.* from public.invoice_refund_assignments a where a.user_id=(select auth.uid()) and (a.refund_id in (select id from refund_history) or a.allocation_id in (select id from allocations))),
  active_assignments as (select a.* from assignment_history a where not exists(select 1 from public.invoice_refund_assignment_reversals r where r.assignment_id=a.id and r.user_id=a.user_id)),
  assignment_stamp as (select coalesce(string_agg(a.id::text||':'||coalesce(r.id::text,''),',' order by a.id),'') stamp from assignment_history a left join public.invoice_refund_assignment_reversals r on r.assignment_id=a.id and r.user_id=a.user_id)
  select jsonb_build_object('transactions',count(tx.id),
    'income_pence',coalesce(sum(case when f.status='approved' and f.record_type='income' then f.amount*100*f.effect_sign else 0 end),0),
    'expense_pence',coalesce(sum(case when f.status='approved' and f.record_type='expense' then f.amount*100*f.effect_sign else 0 end),0),
    'allocation_count',(select count(*) from allocations),'allocation_pence',(select coalesce(sum(amount_pence),0) from allocations),
    'transfer_count',(select count(*) from pairs),'transfer_pence',(select coalesce(sum(amount_pence),0) from pairs),
    'refund_count',(select count(*) from refunds),'refund_pence',(select coalesce(sum(amount_pence),0) from refunds),
    'refund_income_reduction_pence',(select coalesce(sum(recognized_pence) filter(where record_type='income'),0) from refunds),
    'refund_expense_reduction_pence',(select coalesce(sum(recognized_pence) filter(where record_type='expense'),0) from refunds),
    'refund_assignment_count',(select count(*) from active_assignments),'refund_assignment_pence',(select coalesce(sum(amount_pence),0) from active_assignments),
    'stamp',md5(coalesce(string_agg(tx.id::text||':'||tx.decision_version::text,',' order by tx.id),'')||'|'||(select coalesce(string_agg(id::text,',' order by id),'') from invoice_events)||'|'||(select stamp from pair_stamp)||'|'||(select stamp from counterpart_stamp)||'|'||(select stamp from refund_stamp)||'|'||(select stamp from refund_counterparts)||'|'||(select stamp from assignment_stamp)))
  from tx left join public.financial_records f on f.id=tx.recognized_record_id and f.user_id=tx.user_id;
$$;

create or replace function public.reconciliation_export_stamp() returns text language sql stable security invoker set search_path='' as $$
  select md5(
    (select coalesce(string_agg(id::text||':'||updated_at::text,',' order by id),'') from public.invoices where user_id=(select auth.uid()))||'|'||
    (select coalesce(string_agg(id::text||':'||decision_version::text||':'||coalesce(active_transfer_id::text,''),',' order by id),'') from public.bank_transactions where user_id=(select auth.uid()))||'|'||
    (select coalesce(string_agg(id::text,',' order by id),'') from public.invoice_settlements where user_id=(select auth.uid()))||'|'||
    (select coalesce(string_agg(id::text,',' order by id),'') from public.transfer_pairs where user_id=(select auth.uid()))||'|'||
    (select coalesce(string_agg(id::text,',' order by id),'') from public.transfer_reversals where user_id=(select auth.uid()))
    ||'|'||(select coalesce(string_agg(id::text,',' order by id),'') from public.refund_links where user_id=(select auth.uid()))
    ||'|'||(select coalesce(string_agg(id::text,',' order by id),'') from public.refund_reversals where user_id=(select auth.uid()))
    ||'|'||(select coalesce(string_agg(id::text||':'||updated_at::text||':'||status||':'||amount::text||':'||effect_sign::text,',' order by id),'') from public.financial_records where user_id=(select auth.uid()))
    ||'|'||(select coalesce(string_agg(id::text||':'||status,',' order by id),'') from public.record_imports where user_id=(select auth.uid()))
    ||'|'||(select coalesce(string_agg(id::text,',' order by id),'') from public.invoice_credit_notes where user_id=(select auth.uid()))
    ||'|'||(select coalesce(string_agg(id::text,',' order by id),'') from public.invoice_credit_reversals where user_id=(select auth.uid()))
    ||'|'||(select coalesce(string_agg(id::text,',' order by id),'') from public.invoice_refund_assignments where user_id=(select auth.uid()))
    ||'|'||(select coalesce(string_agg(id::text,',' order by id),'') from public.invoice_refund_assignment_reversals where user_id=(select auth.uid()))
  );
$$;

-- Credits can make the outstanding change smaller than the released receipt match.
create or replace function public.reverse_invoice_allocation(p_allocation uuid,p_reason text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); a public.invoice_settlements; existing public.settlement_requests; payload text; reversal uuid; result jsonb; before_outstanding bigint; current_balance record;
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
  select outstanding_pence into before_outstanding from public.invoice_payment_balances where id=a.invoice_id and user_id=owner_id;
  insert into public.invoice_settlements(user_id,invoice_id,transaction_id,amount_pence,event_kind,reverses_id,request_id,invoice_snapshot,author,rationale)
    values(owner_id,a.invoice_id,a.transaction_id,a.amount_pence,'reversal',a.id,p_request,a.invoice_snapshot,owner_id,btrim(p_reason)) returning id into reversal;
  perform public.sync_invoice_settlement_state(a.invoice_id,owner_id);
  select * into current_balance from public.invoice_payment_balances where id=a.invoice_id and user_id=owner_id;
  result:=jsonb_build_object('reversal_id',reversal,'restored_outstanding_pence',current_balance.outstanding_pence-before_outstanding,'released_allocation_pence',a.amount_pence,'outstanding_pence',current_balance.outstanding_pence,'refund_due_pence',current_balance.refund_due_pence,'retained_cash_pence',current_balance.retained_cash_pence);
  insert into public.settlement_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);
  return result;
end; $$;

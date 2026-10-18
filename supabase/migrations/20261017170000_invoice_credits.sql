-- Reviewed commercial entitlement credits. They do not post income/expense.
create table public.invoice_credit_requests (
 user_id uuid not null references auth.users(id),request_id uuid not null,payload_hash text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(user_id,request_id)
);
create table public.invoice_credit_notes (
 id uuid primary key,user_id uuid not null references auth.users(id),invoice_id uuid not null,ordinal integer not null check(ordinal>0),number text not null,
 credit_date date not null,gross_pence bigint not null check(gross_pence between 1 and 999999999999),net_pence bigint,vat_pence bigint,
 tax_status text not null check(tax_status in ('invoice_snapshot','unverified')),invoice_snapshot jsonb not null,document_snapshot jsonb not null,
 pdf_path text not null,pdf_sha256 text not null check(pdf_sha256 ~ '^[a-f0-9]{64}$'),author uuid not null references auth.users(id),
 rationale text not null check(length(btrim(rationale)) between 1 and 1000),request_id uuid not null,created_at timestamptz not null default now(),
 unique(id,user_id),unique(invoice_id,user_id,ordinal),unique(user_id,number),foreign key(invoice_id,user_id) references public.invoices(id,user_id),
 foreign key(user_id,request_id) references public.invoice_credit_requests(user_id,request_id) deferrable initially deferred,
 check((tax_status='unverified' and net_pence is null and vat_pence is null) or (tax_status='invoice_snapshot' and net_pence is not null and vat_pence is not null and net_pence>=0 and vat_pence>=0 and gross_pence=net_pence+vat_pence))
);
create table public.invoice_credit_reversals (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),credit_id uuid not null unique,author uuid not null references auth.users(id),
 rationale text not null check(length(btrim(rationale)) between 1 and 1000),request_id uuid not null,created_at timestamptz not null default now(),
 foreign key(credit_id,user_id) references public.invoice_credit_notes(id,user_id),foreign key(user_id,request_id) references public.invoice_credit_requests(user_id,request_id) deferrable initially deferred
);
create index invoice_credits_invoice on public.invoice_credit_notes(user_id,invoice_id,id);
create index invoice_credits_requests on public.invoice_credit_notes(user_id,request_id);
create index invoice_credit_reversals_owner on public.invoice_credit_reversals(user_id,id);
alter table public.invoice_credit_requests enable row level security;
alter table public.invoice_credit_notes enable row level security;
alter table public.invoice_credit_reversals enable row level security;
revoke all on public.invoice_credit_requests,public.invoice_credit_notes,public.invoice_credit_reversals from public,anon,authenticated,service_role;
grant select on public.invoice_credit_requests,public.invoice_credit_notes,public.invoice_credit_reversals to authenticated,service_role;
create policy invoice_credit_requests_read on public.invoice_credit_requests for select to authenticated using(user_id=(select auth.uid()));
create policy invoice_credit_notes_read on public.invoice_credit_notes for select to authenticated using(user_id=(select auth.uid()));
create policy invoice_credit_reversals_read on public.invoice_credit_reversals for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_credit_requests before update or delete on public.invoice_credit_requests for each row execute function public.reject_source_mutation();
create trigger immutable_credit_notes before update or delete on public.invoice_credit_notes for each row execute function public.reject_source_mutation();
create trigger immutable_credit_reversals before update or delete on public.invoice_credit_reversals for each row execute function public.reject_source_mutation();
create view public.active_invoice_credits with(security_invoker=true) as select c.* from public.invoice_credit_notes c where not exists(select 1 from public.invoice_credit_reversals r where r.credit_id=c.id and r.user_id=c.user_id);
revoke all on public.active_invoice_credits from public,anon,authenticated,service_role;
grant select on public.active_invoice_credits to authenticated,service_role;

create or replace view public.invoice_payment_balances with(security_invoker=true) as
select i.id,i.user_id,i.number,i.invoice_date,i.client_id,i.status,i.currency,i.updated_at,i.delivery_status,i.paid_at,(i.amount*100)::bigint invoice_pence,
 coalesce(a.allocated_pence,0)::bigint allocated_pence,
 greatest((i.amount*100)-coalesce(c.credited_pence,0)-coalesce(a.allocated_pence,0),0)::bigint outstanding_pence,
 coalesce(c.credited_pence,0)::bigint credited_pence,((i.amount*100)-coalesce(c.credited_pence,0))::bigint entitlement_pence,
 greatest(coalesce(a.allocated_pence,0)-(i.amount*100)+coalesce(c.credited_pence,0),0)::bigint refund_due_pence,
 coalesce(a.allocated_pence,0)::bigint retained_cash_pence,
 coalesce(c.net_pence,0)::bigint credited_net_pence,coalesce(c.vat_pence,0)::bigint credited_vat_pence,
 case when coalesce(a.allocated_pence,0)>(i.amount*100)-coalesce(c.credited_pence,0) then 'refund_due'
 when i.amount*100=coalesce(c.credited_pence,0) then 'fully_credited'
 when coalesce(a.allocated_pence,0)=i.amount*100-coalesce(c.credited_pence,0) then 'settled'
 when coalesce(a.allocated_pence,0)>0 then 'part_paid' else 'unpaid' end settlement_state,
 exists(select 1 from public.invoice_settlements s where s.invoice_id=i.id and s.user_id=i.user_id) or exists(select 1 from public.invoice_credit_notes c where c.invoice_id=i.id and c.user_id=i.user_id) as has_reconciliation_history,
 exists(select 1 from public.invoice_credit_notes c where c.invoice_id=i.id and c.user_id=i.user_id) as has_credit_history
from public.invoices i
left join(select user_id,invoice_id,sum(amount_pence) allocated_pence from public.active_invoice_allocations group by user_id,invoice_id) a on a.invoice_id=i.id and a.user_id=i.user_id
left join(select user_id,invoice_id,sum(gross_pence) credited_pence,sum(net_pence) net_pence,sum(vat_pence) vat_pence from public.active_invoice_credits group by user_id,invoice_id) c on c.invoice_id=i.id and c.user_id=i.user_id;
grant select on public.invoice_payment_balances to service_role;

create function public.invoice_balance_stamp(p_invoice uuid) returns text language sql stable security invoker set search_path='' as $$
 select md5(coalesce((select updated_at::text from public.invoices where id=p_invoice and user_id=(select auth.uid())),'')||'|'||
 coalesce((select string_agg(c.id::text||':'||coalesce(r.id::text,''),',' order by c.id) from public.invoice_credit_notes c left join public.invoice_credit_reversals r on r.credit_id=c.id and r.user_id=c.user_id where c.invoice_id=p_invoice and c.user_id=(select auth.uid())),'')||'|'||
 coalesce((select string_agg(id::text,',' order by id) from public.invoice_settlements where invoice_id=p_invoice and user_id=(select auth.uid())),''));
$$;
revoke all on function public.invoice_balance_stamp(uuid) from public,anon,service_role;
grant execute on function public.invoice_balance_stamp(uuid) to authenticated;
create view public.invoice_credit_choices with(security_invoker=true) as
select b.*,i.net_pence,i.vat_pence,i.vat_rate_bps,i.vat_number_snapshot,i.economics_version,i.description,
 public.invoice_balance_stamp(i.id) balance_stamp,
 coalesce((select max(ordinal) from public.invoice_credit_notes c where c.invoice_id=i.id and c.user_id=i.user_id),0)+1 next_ordinal
from public.invoice_payment_balances b join public.invoices i on i.id=b.id and i.user_id=b.user_id;
revoke all on public.invoice_credit_choices from public,anon,authenticated,service_role;
grant select on public.invoice_credit_choices to authenticated;

create or replace function public.sync_invoice_settlement_state(p_invoice uuid,p_owner uuid) returns void
language plpgsql security definer set search_path='' as $$
declare b record; last_date date;
begin
 perform 1 from public.invoices where id=p_invoice and user_id=p_owner for update;
 select * into b from public.invoice_payment_balances where id=p_invoice and user_id=p_owner;
 select max(t.transaction_date) into last_date from public.active_invoice_allocations a join public.bank_transactions t on t.id=a.transaction_id and t.user_id=a.user_id where a.invoice_id=p_invoice and a.user_id=p_owner;
 update public.invoices set delivery_status=case when b.settlement_state='settled' then 'paid' when sent_at is not null then 'sent' else 'not_sent' end,
 paid_at=case when b.settlement_state='settled' then last_date::timestamp at time zone 'UTC' else null end,reminder_enabled=false,next_reminder_at=null where id=p_invoice and user_id=p_owner;
 update public.invoice_reminders set status='skipped',error='Invoice balance changed. Review a fresh reminder.' where invoice_id=p_invoice and user_id=p_owner and status='pending';
end; $$;

create function public.approve_invoice_credit(p_invoice uuid,p_credit uuid,p_stamp text,p_date date,p_gross bigint,p_reason text,p_document jsonb,p_pdf_path text,p_pdf_sha256 text)
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
  to_jsonb(inv)||jsonb_build_object('revision_id',revision.id,'pdf_sha256',revision.pdf_sha256,'allocated_pence',b.allocated_pence,'credited_pence',b.credited_pence,'outstanding_pence',b.outstanding_pence,'refund_due_pence',b.refund_due_pence),
  p_document,p_pdf_path,p_pdf_sha256,owner_id,btrim(p_reason),p_credit);
 perform public.sync_invoice_settlement_state(inv.id,owner_id);
 result:=jsonb_build_object('credit_id',p_credit,'number',note_number,'gross_pence',p_gross,'recognized_income_change_pence',0);
 insert into public.invoice_credit_requests(user_id,request_id,payload_hash,result) values(owner_id,p_credit,payload,result);
 return result;
end; $$;
revoke all on function public.approve_invoice_credit(uuid,uuid,text,date,bigint,text,jsonb,text,text) from public,anon,service_role;
grant execute on function public.approve_invoice_credit(uuid,uuid,text,date,bigint,text,jsonb,text,text) to authenticated;

create function public.reverse_invoice_credit(p_credit uuid,p_stamp text,p_reason text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); c public.invoice_credit_notes; prior public.invoice_credit_requests; payload text; reversal uuid; result jsonb;
begin
 if owner_id is null then raise exception 'Sign in to reverse a credit.'; end if;
 if p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Review the reversal and reason.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 payload:=md5(jsonb_build_object('action','reverse_credit','credit',p_credit,'stamp',p_stamp,'reason',btrim(p_reason))::text);
 select * into prior from public.invoice_credit_requests where user_id=owner_id and request_id=p_request;
 if found then if prior.payload_hash<>payload then raise exception 'Credit request changed.'; end if; return prior.result; end if;
 select * into c from public.active_invoice_credits where id=p_credit and user_id=owner_id;
 if not found then raise exception 'Active credit not found.'; end if;
 perform 1 from public.invoices where id=c.invoice_id and user_id=owner_id for update;
 if public.invoice_balance_stamp(c.invoice_id) is distinct from p_stamp then raise exception 'Invoice balance changed. Review again.'; end if;
 if exists(select 1 from public.active_invoice_credits where invoice_id=c.invoice_id and user_id=owner_id and ordinal>c.ordinal) then raise exception 'Reverse the latest active credit first to preserve penny rounding.'; end if;
 insert into public.invoice_credit_reversals(user_id,credit_id,author,rationale,request_id) values(owner_id,c.id,owner_id,btrim(p_reason),p_request) returning id into reversal;
 perform public.sync_invoice_settlement_state(c.invoice_id,owner_id);
 result:=jsonb_build_object('reversal_id',reversal,'gross_pence',c.gross_pence,'recognized_income_change_pence',0);
 insert into public.invoice_credit_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);
 return result;
end; $$;
revoke all on function public.reverse_invoice_credit(uuid,text,text,uuid) from public,anon,service_role;
grant execute on function public.reverse_invoice_credit(uuid,text,text,uuid) to authenticated;

-- Credit history freezes invoice economics, even if every credit was later reversed.
create function public.protect_credited_invoice() returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.invoice_credit_notes where invoice_id=old.id and user_id=old.user_id) then
  if tg_op='DELETE' then raise exception 'Preserve invoices with credit history.'; end if;
  if (new.user_id,new.client_id,new.amount,new.currency,new.number,new.invoice_date,new.description,new.status,new.payment_terms,new.due_date,new.pdf_path,new.net_pence,new.vat_pence,new.vat_rate_bps,new.vat_enabled,new.vat_number_snapshot,new.economics_version,new.finalised_at)
   is distinct from (old.user_id,old.client_id,old.amount,old.currency,old.number,old.invoice_date,old.description,old.status,old.payment_terms,old.due_date,old.pdf_path,old.net_pence,old.vat_pence,old.vat_rate_bps,old.vat_enabled,old.vat_number_snapshot,old.economics_version,old.finalised_at) then raise exception 'Invoices with credit history require a reviewed correction.'; end if;
  if current_user in ('authenticated','anon','service_role') and (new.paid_at is distinct from old.paid_at or (new.delivery_status is distinct from old.delivery_status and (new.delivery_status='paid' or old.delivery_status='paid')) or (new.reminder_enabled and not old.reminder_enabled)) then raise exception 'Use reviewed balances for credited invoice paid/reminder state.'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;return new;
end; $$;
create trigger protect_invoice_credit_facts before update or delete on public.invoices for each row execute function public.protect_credited_invoice();

alter table public.invoice_reminders add column balance_updated_at timestamptz,add column amount_due_pence bigint;

-- Preserve request/receipt checks while applying the credited entitlement cap.
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
    select entitlement_pence into total from public.invoice_payment_balances where id=inv.id and user_id=owner_id;
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
  );
$$;

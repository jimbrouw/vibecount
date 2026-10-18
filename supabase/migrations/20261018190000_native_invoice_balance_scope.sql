-- Preserve the legacy GBP balance contract before any external invoice enablement.
-- CREATE OR REPLACE retains relation identity, column order/types, dependencies and ACLs.
-- No status/positive-value filter: native zero drafts retain their existing projection.
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
left join(select user_id,invoice_id,sum(amount_pence) returned_pence from public.active_invoice_refund_assignments group by user_id,invoice_id) f on f.invoice_id=i.id and f.user_id=i.user_id
where i.origin='native_gbp' and i.currency='GBP' and i.amount is not null
 and i.original_total_minor is null and i.currency_ruleset_id is null
 and i.source_fact_revision_id is null and i.source_fact_family_id is null;

-- Use the same complete native shape at contextual/commercial relationship writes.
-- This does not enable external rows or dimensioned settlements.
create or replace function public.require_native_invoice_relationship() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.invoice_id is not null and not exists(select 1 from public.invoices i where i.id=new.invoice_id and i.user_id=new.user_id and i.origin='native_gbp' and i.currency='GBP' and i.amount is not null
 and i.original_total_minor is null and i.currency_ruleset_id is null
 and i.source_fact_revision_id is null and i.source_fact_family_id is null) then
  raise exception 'Use the reviewed currency-aware invoice relationship workflow.';
 end if;
 return new;
end;$$;
revoke all on function public.require_native_invoice_relationship() from public,anon,authenticated,service_role;

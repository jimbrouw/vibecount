-- One accounting projection per cash observation. Does not relax posting
-- uniqueness or expose split approval; prepares every existing totals reader.
create index financial_records_owner_bank_effects on public.financial_records(user_id,bank_transaction_id,id) where bank_transaction_id is not null;
create view public.bank_transaction_record_effects with(security_invoker=true) as
select f.user_id,f.bank_transaction_id,
 count(*)::integer record_count,count(*) filter(where f.status='approved')::integer approved_record_count,
 array_agg(f.id order by f.id) record_ids,
 coalesce(array_agg(f.id order by f.id) filter(where f.status='approved'),'{}'::uuid[]) approved_record_ids,
 coalesce(sum(f.amount*100*f.effect_sign) filter(where f.status='approved'),0)::bigint recognized_pence,
 coalesce(sum(f.amount*100*f.effect_sign) filter(where f.status='approved' and f.record_type='income'),0)::bigint income_pence,
 coalesce(sum(f.amount*100*f.effect_sign) filter(where f.status='approved' and f.record_type='expense'),0)::bigint expense_pence,
 case when count(*) filter(where f.status='approved')>0 then 'approved' else max(f.status) end status,
 case when count(*) filter(where f.status='approved')>0 then
  case when count(distinct f.record_type) filter(where f.status='approved')=1 then max(f.record_type) filter(where f.status='approved') end
  else case when count(distinct f.record_type)=1 then max(f.record_type) end end record_type,
 case when count(*) filter(where f.status='approved')>0 then
  case when count(distinct f.effect_sign) filter(where f.status='approved')=1 then max(f.effect_sign) filter(where f.status='approved') end
  else case when count(distinct f.effect_sign)=1 then max(f.effect_sign) end end effect_sign,
 case when count(distinct f.category_id) filter(where f.status='approved')=1 and count(*) filter(where f.status='approved' and f.category_id is null)=0
  then (max(f.category_id::text) filter(where f.status='approved'))::uuid end category_id
from public.financial_records f where f.bank_transaction_id is not null group by f.user_id,f.bank_transaction_id;
revoke all on public.bank_transaction_record_effects from public,anon,authenticated,service_role;
grant select on public.bank_transaction_record_effects to authenticated,service_role;

-- Preserve current public view column order and owner joins.
create or replace view public.transfer_transaction_choices with(security_invoker=true) as
select t.id,t.user_id,t.account_id,t.import_id,t.transaction_date,t.signed_amount_pence,t.currency,t.description,t.reference,
  t.classification,t.decision_version,t.dedupe_status,t.active_transfer_id,
  a.label as account_label,a.masked_identifier as account_mask,a.account_type,
  i.status as import_status,f.status as record_status,
  coalesce(f.recognized_pence,0)::bigint as recognized_pence,
  coalesce(s.allocated_pence,0)::bigint as invoice_allocated_pence,t.active_refund_id,exists(select 1 from public.active_refunds r where r.user_id=t.user_id and t.id in (r.original_transaction_id,r.refund_transaction_id)) as has_refunds
from public.bank_transactions t join public.financial_accounts a on a.id=t.account_id and a.user_id=t.user_id
join public.record_imports i on i.id=t.import_id and i.user_id=t.user_id
left join public.bank_transaction_record_effects f on f.bank_transaction_id=t.id and f.user_id=t.user_id
left join (select user_id,transaction_id,sum(amount_pence) allocated_pence from public.active_invoice_allocations group by user_id,transaction_id) s on s.transaction_id=t.id and s.user_id=t.user_id;

create or replace view public.refund_transaction_choices with(security_invoker=true) as
select c.*,t.business_use_bps,f.record_type,f.effect_sign,f.category_id,
 coalesce(r.refunded_pence,0)::bigint refunded_pence,coalesce(r.reduced_pence,0)::bigint reduced_pence,
 coalesce(r.refund_count,0)::integer refund_count,public.refund_group_stamp(c.id) refund_stamp
from public.transfer_transaction_choices c join public.bank_transactions t on t.id=c.id and t.user_id=c.user_id
left join public.bank_transaction_record_effects f on f.bank_transaction_id=t.id and f.user_id=t.user_id
left join(select user_id,original_transaction_id,sum(amount_pence) refunded_pence,sum(recognized_pence) reduced_pence,count(*) refund_count from public.active_refunds group by user_id,original_transaction_id) r on r.original_transaction_id=c.id and r.user_id=c.user_id;

create or replace view public.receipt_allocation_balances with(security_invoker=true) as
select t.id,t.user_id,t.import_id,t.transaction_date,t.description,t.reference,t.signed_amount_pence,t.currency,t.classification,
 t.business_use_bps,t.dedupe_status,t.decision_version,t.source_row_id,t.recognized_record_id,
 f.status as record_status,coalesce(f.recognized_pence,0)::bigint as recognized_pence,
 coalesce(a.allocated_pence,0)::bigint as allocated_pence,
 (t.signed_amount_pence-coalesce(a.allocated_pence,0))::bigint as unallocated_pence,t.active_transfer_id,
 t.active_refund_id,coalesce(r.refunded_pence,0)::bigint refunded_pence,f.record_type
from public.bank_transactions t left join public.bank_transaction_record_effects f on f.bank_transaction_id=t.id and f.user_id=t.user_id
left join(select user_id,transaction_id,sum(amount_pence) allocated_pence from public.active_invoice_allocations group by user_id,transaction_id) a on a.transaction_id=t.id and a.user_id=t.user_id
left join(select user_id,original_transaction_id,sum(amount_pence) refunded_pence from public.active_refunds group by user_id,original_transaction_id) r on r.original_transaction_id=t.id and r.user_id=t.user_id
where t.signed_amount_pence>0;

create or replace view public.duplicate_review_transactions with(security_invoker=true) as
select t.id,t.user_id,t.account_id,t.import_id,t.source_row_id,t.transaction_date,t.signed_amount_pence,t.currency,t.description,t.reference,t.fingerprint,
 t.classification,t.business_use_bps,t.category_id,t.decision_version,t.dedupe_status,t.active_duplicate_decision_id,
 a.label account_label,a.masked_identifier account_mask,i.status import_status,i.file_hash,i.parser_version,
 s.row_number,s.row_hash,f.record_type,f.status record_status,
 coalesce(f.recognized_pence,0)::bigint recognized_pence,
 (select count(*) from public.bank_transactions p where p.user_id=t.user_id and p.account_id=t.account_id and p.fingerprint=t.fingerprint and p.id<>t.id) peer_count,
 (select count(*) from public.active_duplicate_decisions d where d.user_id=t.user_id and d.retained_transaction_id=t.id) incoming_duplicate_count,
 (exists(select 1 from public.active_invoice_allocations x where x.user_id=t.user_id and x.transaction_id=t.id)
  or t.active_transfer_id is not null
  or exists(select 1 from public.active_refunds x where x.user_id=t.user_id and t.id in (x.original_transaction_id,x.refund_transaction_id))) has_financial_dependencies
from public.bank_transactions t
join public.financial_accounts a on a.id=t.account_id and a.user_id=t.user_id
join public.record_imports i on i.id=t.import_id and i.user_id=t.user_id
join public.source_rows s on s.id=t.source_row_id and s.user_id=t.user_id
left join public.bank_transaction_record_effects f on f.bank_transaction_id=t.id and f.user_id=t.user_id;

-- Keep duplicate-aware public summary wrapper; update its totals base only.
create or replace function public.source_import_summary_v19_base(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
  with recursive tx as (select * from public.bank_transactions where import_id=p_id and user_id=(select auth.uid())),
  allocations as (select a.* from public.active_invoice_allocations a join tx on tx.id=a.transaction_id and tx.user_id=a.user_id),
  invoice_events as (select a.id from public.invoice_settlements a join tx on tx.id=a.transaction_id and tx.user_id=a.user_id),
  pair_history as (select p.* from public.transfer_pairs p where p.user_id=(select auth.uid()) and exists(select 1 from tx where tx.id in (p.outgoing_transaction_id,p.incoming_transaction_id))),
  pairs as (select p.* from pair_history p where not exists(select 1 from public.transfer_reversals r where r.pair_id=p.id and r.user_id=p.user_id)),
  pair_stamp as (select coalesce(string_agg(p.id::text||':'||coalesce(r.id::text,''),',' order by p.id),'') stamp from pair_history p left join public.transfer_reversals r on r.pair_id=p.id and r.user_id=p.user_id),
  counterpart_stamp as (select coalesce(string_agg(t.id::text||':'||t.decision_version::text,',' order by t.id),'') stamp from public.bank_transactions t where t.user_id=(select auth.uid()) and exists(select 1 from pairs p where t.id in (p.outgoing_transaction_id,p.incoming_transaction_id)))
  , refund_nodes(id) as (
    select id from tx
    union select case when l.original_transaction_id=n.id then l.refund_transaction_id else l.original_transaction_id end
     from refund_nodes n join public.active_refunds l on l.user_id=(select auth.uid()) and n.id in(l.original_transaction_id,l.refund_transaction_id)
  ),refund_originals as (select distinct l.original_transaction_id from public.refund_links l where l.user_id=(select auth.uid()) and exists(select 1 from refund_nodes n where n.id in (l.original_transaction_id,l.refund_transaction_id))),
  refund_history as (select l.* from public.refund_links l join refund_originals o on o.original_transaction_id=l.original_transaction_id where l.user_id=(select auth.uid())),
  refunds as (select l.* from refund_history l where not exists(select 1 from public.refund_reversals r where r.refund_id=l.id and r.user_id=l.user_id)),
  refund_stamp as (select coalesce(string_agg(l.id::text||':'||coalesce(r.id::text,''),',' order by l.id),'') stamp from refund_history l left join public.refund_reversals r on r.refund_id=l.id and r.user_id=l.user_id),
  refund_counterparts as (select coalesce(string_agg(t.id::text||':'||t.decision_version::text,',' order by t.id),'') stamp from public.bank_transactions t where t.user_id=(select auth.uid()) and exists(select 1 from refunds l where t.id in (l.original_transaction_id,l.refund_transaction_id)))
  , assignment_history as (select a.* from public.invoice_refund_assignments a where a.user_id=(select auth.uid()) and (a.refund_id in (select id from refund_history) or a.allocation_id in (select id from allocations))),
  active_assignments as (select a.* from assignment_history a where not exists(select 1 from public.invoice_refund_assignment_reversals r where r.assignment_id=a.id and r.user_id=a.user_id)),
  assignment_stamp as (select coalesce(string_agg(a.id::text||':'||coalesce(r.id::text,''),',' order by a.id),'') stamp from assignment_history a left join public.invoice_refund_assignment_reversals r on r.assignment_id=a.id and r.user_id=a.user_id)
  select jsonb_build_object('transactions',count(tx.id),
    'income_pence',coalesce(sum(f.income_pence),0),
    'expense_pence',coalesce(sum(f.expense_pence),0),
    'allocation_count',(select count(*) from allocations),'allocation_pence',(select coalesce(sum(amount_pence),0) from allocations),
    'transfer_count',(select count(*) from pairs),'transfer_pence',(select coalesce(sum(amount_pence),0) from pairs),
    'refund_count',(select count(*) from refunds),'refund_pence',(select coalesce(sum(amount_pence),0) from refunds),
    'refund_income_reduction_pence',(select coalesce(sum(recognized_pence) filter(where record_type='income'),0) from refunds),
    'refund_expense_reduction_pence',(select coalesce(sum(recognized_pence) filter(where record_type='expense'),0) from refunds),
    'refund_assignment_count',(select count(*) from active_assignments),'refund_assignment_pence',(select coalesce(sum(amount_pence),0) from active_assignments),
    'stamp',md5(coalesce(string_agg(tx.id::text||':'||tx.decision_version::text,',' order by tx.id),'')||'|'||(select coalesce(string_agg(id::text,',' order by id),'') from invoice_events)||'|'||(select stamp from pair_stamp)||'|'||(select stamp from counterpart_stamp)||'|'||(select stamp from refund_stamp)||'|'||(select stamp from refund_counterparts)||'|'||(select stamp from assignment_stamp)))
  from tx left join public.bank_transaction_record_effects f on f.bank_transaction_id=tx.id and f.user_id=tx.user_id;
$$;

-- Explicit-owner filing reader retains all source/event allowlists and immutable saved bytes.
create or replace function public.tax_filing_pack_input_for_owner(p_owner uuid,p_calculation uuid) returns jsonb language sql stable security definer set search_path='' as $$
with recursive calc as materialized(select c.* from public.tax_calculations c where c.id=p_calculation and c.user_id=p_owner),
year as(select tax_year_start y from calc),
edges(a,b) as materialized(
 select 't:'||s.transaction_id,'i:'||s.invoice_id from public.invoice_settlements s where s.user_id=p_owner
 union select 't:'||p.outgoing_transaction_id,'t:'||p.incoming_transaction_id from public.transfer_pairs p where p.user_id=p_owner
 union select 't:'||r.original_transaction_id,'t:'||r.refund_transaction_id from public.refund_links r where r.user_id=p_owner
 union select 't:'||d.transaction_id,'t:'||d.retained_transaction_id from public.duplicate_decisions d where d.user_id=p_owner and d.retained_transaction_id is not null
 union select 't:'||d.transaction_id,'t:'||(v->>'id') from public.duplicate_decisions d cross join lateral jsonb_array_elements(d.cohort_snapshot) v where d.user_id=p_owner and v->>'id' is not null
 union select 't:'||r.refund_transaction_id,'i:'||a.invoice_id from public.invoice_refund_assignments a join public.refund_links r on r.id=a.refund_id and r.user_id=a.user_id where a.user_id=p_owner
),undirected(a,b) as(select a,b from edges union select b,a from edges),
roots(node) as(
 select 't:'||t.id from public.bank_transactions t where t.user_id=p_owner and t.tax_year_start=(select y from year)
 union select 't:'||r.bank_transaction_id from public.financial_records r where r.user_id=p_owner and r.tax_year_start=(select y from year) and r.bank_transaction_id is not null
 union select 't:'||(s->>'transaction_id') from calc c cross join lateral jsonb_array_elements(c.input->'sources') s where s->>'transaction_id' is not null
 union select 't:'||r.bank_transaction_id from calc c cross join lateral jsonb_array_elements(c.input->'sources') s join public.financial_records r on r.id=(s->>'record_id')::uuid and r.user_id=p_owner where r.bank_transaction_id is not null
 union select 'i:'||i.id from public.invoices i where i.user_id=p_owner and i.invoice_date between make_date((select y from year),4,6) and make_date((select y from year)+1,4,5)
 union select 'i:'||c.invoice_id from public.invoice_credit_notes c where c.user_id=p_owner and c.credit_date between make_date((select y from year),4,6) and make_date((select y from year)+1,4,5)
),connected(node) as(select node from roots union select e.b from connected c join undirected e on e.a=c.node),
tx as materialized(select t.* from public.bank_transactions t where t.user_id=p_owner and ('t:'||t.id) in(select node from connected)),
inv as materialized(select i.* from public.invoice_payment_balances i where i.user_id=p_owner and ('i:'||i.id) in(select node from connected)),
imports as materialized(select i.id,i.status,i.file_hash,i.parser_version,i.account_id,i.coverage_start,i.coverage_end,i.created_at from public.record_imports i where i.user_id=p_owner and i.id in(select import_id from tx)),
merchant_items as materialized(select m.* from public.merchant_review_items m where m.user_id=p_owner and m.transaction_id in(select id from tx)),
merchant_versions as materialized(select v.* from public.merchant_rule_versions v where v.user_id=p_owner and v.id in(select rule_version_id from merchant_items)),
selected_docs(id) as(
 select s.document_id from public.tax_fact_sources s join public.current_tax_facts f on f.id=s.revision_id and f.user_id=s.user_id where s.user_id=p_owner and f.tax_year_start=(select y from year) and s.document_id is not null
 union select (c.input->'scope'->>'evidence_document_id')::uuid from calc c where c.input->'scope'->>'evidence_document_id' is not null
 union select e.document_id from public.merchant_review_evidence e where e.user_id=p_owner and e.item_id in(select id from merchant_items)
 union select b.root_document_id from public.document_batches b where b.user_id=p_owner and b.tax_year_start=(select y from year)
),batches as materialized(select b.id,b.root_document_id,b.tax_year_start,b.purpose,b.parser_version,b.created_at from public.document_batches b where b.user_id=p_owner and (b.tax_year_start=(select y from year) or b.root_document_id in(select id from selected_docs) or b.id in(select i.batch_id from public.document_batch_items i where i.user_id=p_owner and i.document_id in(select id from selected_docs)))),
documents as materialized(select d.id,d.file_hash,d.media_type,d.size_bytes,d.created_at from public.evidence_documents d where d.user_id=p_owner and (d.id in(select id from selected_docs) or d.id in(select root_document_id from batches) or d.id in(select i.document_id from public.document_batch_items i where i.user_id=p_owner and i.batch_id in(select id from batches)))),
observations as materialized(
 select t.id,t.account_id,t.import_id,t.source_row_id,t.transaction_date,t.tax_year_start,t.tax_year_start=(select y from year) in_tax_year,t.signed_amount_pence,t.currency,
 public.tax_pack_safe_text(t.description) description,public.tax_pack_safe_text(t.reference) reference,t.classification,t.business_use_bps,t.category_id,t.decision_version,t.dedupe_status,t.active_transfer_id,t.active_refund_id,t.active_duplicate_decision_id,
 t.recognized_record_id,f.record_type,f.status record_status,coalesce(f.recognized_pence,0)::bigint recognized_pence,
 a.provider,a.account_type,a.masked_identifier,s.row_number,s.row_hash,i.file_hash,i.parser_version
 from tx t join public.financial_accounts a on a.id=t.account_id and a.user_id=t.user_id join public.source_rows s on s.id=t.source_row_id and s.user_id=t.user_id join imports i on i.id=t.import_id
 left join public.bank_transaction_record_effects f on f.bank_transaction_id=t.id and f.user_id=t.user_id
),decisions as(
 select d.id,d.transaction_id,d.import_id,d.version,d.classification,d.business_use_bps,d.category_id,public.tax_pack_safe_text(d.rationale) rationale,d.recognized_pence,d.author,d.evidence_status,d.created_at,t.tax_year_start=(select y from year) in_tax_year
 from public.classification_decisions d join tx t on t.id=d.transaction_id and t.user_id=d.user_id where d.user_id=p_owner
),source_events as(select e.id,e.import_id,e.event,public.tax_pack_safe_text(e.reason) reason,e.author,e.created_at from public.source_import_events e where e.user_id=p_owner and e.import_id in(select id from imports)),
invoice_balances as(select i.id,i.number,i.invoice_date,i.status,i.currency,i.invoice_pence,i.allocated_pence,i.credited_pence,i.entitlement_pence,i.outstanding_pence,i.refund_due_pence,i.retained_cash_pence,i.returned_pence,i.settlement_state,i.delivery_status,i.invoice_date between make_date((select y from year),4,6) and make_date((select y from year)+1,4,5) in_tax_year from inv i),
receipt_balances as(select r.id,r.transaction_date,r.signed_amount_pence,r.recognized_pence,r.allocated_pence,r.unallocated_pence,r.classification,r.record_status,r.active_transfer_id,r.active_refund_id,r.refunded_pence,t.tax_year_start=(select y from year) in_tax_year from public.receipt_allocation_balances r join tx t on t.id=r.id and t.user_id=r.user_id where r.user_id=p_owner),
reconciliation_events as(
 select 'settlement' kind,s.id,public.tax_pack_fields(to_jsonb(s),array['invoice_id','transaction_id','amount_pence','event_kind','reverses_id','request_id','author','rationale','created_at'])||jsonb_build_object('invoice_source',public.tax_pack_fields(s.invoice_snapshot,array['number','gross_pence','currency','revision_id','pdf_sha256'])) data from public.invoice_settlements s where s.user_id=p_owner and s.invoice_id in(select id from inv)
 union all select 'transfer',p.id,public.tax_pack_fields(to_jsonb(p),array['outgoing_transaction_id','incoming_transaction_id','kind','amount_pence','outgoing_version','incoming_version','author','rationale','request_id','created_at']) from public.transfer_pairs p where p.user_id=p_owner and p.outgoing_transaction_id in(select id from tx)
 union all select 'transfer_reversal',r.id,public.tax_pack_fields(to_jsonb(r),array['pair_id','author','rationale','request_id','created_at']) from public.transfer_reversals r join public.transfer_pairs p on p.id=r.pair_id and p.user_id=r.user_id where r.user_id=p_owner and p.outgoing_transaction_id in(select id from tx)
 union all select 'refund',r.id,public.tax_pack_fields(to_jsonb(r),array['original_transaction_id','refund_transaction_id','amount_pence','recognized_pence','record_type','business_use_bps','category_id','author','rationale','request_id','created_at'])||jsonb_build_object('original_source',public.tax_pack_fields(r.original_snapshot,array['decision_version','source_row_id','import_id','gross_pence','recognized_pence','record_id','date']),'refund_source',public.tax_pack_fields(r.refund_snapshot,array['decision_version','source_row_id','import_id','date'])) from public.refund_links r where r.user_id=p_owner and r.original_transaction_id in(select id from tx)
 union all select 'refund_reversal',v.id,public.tax_pack_fields(to_jsonb(v),array['refund_id','author','rationale','request_id','created_at']) from public.refund_reversals v join public.refund_links r on r.id=v.refund_id and r.user_id=v.user_id where v.user_id=p_owner and r.original_transaction_id in(select id from tx)
 union all select 'credit',c.id,public.tax_pack_fields(to_jsonb(c),array['invoice_id','ordinal','number','credit_date','gross_pence','net_pence','vat_pence','tax_status','pdf_sha256','author','rationale','request_id','created_at'])||jsonb_build_object('invoice_source',public.tax_pack_fields(c.invoice_snapshot,array['id','number','revision_id','pdf_sha256'])) from public.invoice_credit_notes c where c.user_id=p_owner and c.invoice_id in(select id from inv)
 union all select 'credit_reversal',r.id,public.tax_pack_fields(to_jsonb(r),array['credit_id','author','rationale','request_id','created_at']) from public.invoice_credit_reversals r join public.invoice_credit_notes c on c.id=r.credit_id and c.user_id=r.user_id where r.user_id=p_owner and c.invoice_id in(select id from inv)
 union all select 'refund_assignment',a.id,public.tax_pack_fields(to_jsonb(a),array['invoice_id','allocation_id','credit_id','refund_id','amount_pence','author','rationale','request_id','created_at']) from public.invoice_refund_assignments a where a.user_id=p_owner and a.invoice_id in(select id from inv)
 union all select 'refund_assignment_reversal',r.id,public.tax_pack_fields(to_jsonb(r),array['assignment_id','author','rationale','request_id','created_at']) from public.invoice_refund_assignment_reversals r join public.invoice_refund_assignments a on a.id=r.assignment_id and a.user_id=r.user_id where r.user_id=p_owner and a.invoice_id in(select id from inv)
 union all select 'duplicate_decision',d.id,public.tax_pack_fields(to_jsonb(d),array['transaction_id','retained_transaction_id','verdict','rationale','author','request_id','created_at'])||jsonb_build_object('subject_source',public.tax_pack_fields(d.subject_snapshot,array['id','import_id','source_row_id','file_hash','row_hash','decision_version','recognized_pence','dedupe_status']),'retained_source',public.tax_pack_fields(coalesce(d.retained_snapshot,'{}'::jsonb),array['id','import_id','source_row_id','file_hash','row_hash','decision_version','dedupe_status']),'cohort',(select jsonb_agg(public.tax_pack_fields(v,array['id','import_id','source_row_id','file_hash','row_hash','decision_version','dedupe_status','import_status'])) from jsonb_array_elements(d.cohort_snapshot) v)) from public.duplicate_decisions d where d.user_id=p_owner and d.transaction_id in(select id from tx)
 union all select 'duplicate_reversal',r.id,public.tax_pack_fields(to_jsonb(r),array['decision_id','rationale','author','request_id','created_at']) from public.duplicate_reversals r join public.duplicate_decisions d on d.id=r.decision_id and d.user_id=r.user_id where r.user_id=p_owner and d.transaction_id in(select id from tx)
),merchant_events as(
 select 'application' kind,m.id,public.tax_pack_fields(to_jsonb(m),array['batch_id','transaction_id','rule_version_id','origin','after_version','classification','business_use_bps','category_id','evidence_status','recognized_pence','rationale','created_at'])||jsonb_build_object('category',public.tax_pack_fields(coalesce(m.category_snapshot,'{}'::jsonb),array['id','name','record_type'])) data from merchant_items m
 union all select 'rule_version',v.id,public.tax_pack_fields(to_jsonb(v),array['rule_id','ordinal','status','account_id','tax_year_start','effective_from','expires_on','priority','classification','business_use_bps','category_id','evidence_status','seed_transaction_id','rationale','author','request_id','created_at'])||jsonb_build_object('category',public.tax_pack_fields(coalesce(v.category_snapshot,'{}'::jsonb),array['id','name','record_type']),'seed_source',public.tax_pack_fields(v.seed_snapshot,array['id','import_id','source_row_id','file_hash','row_hash','row_number','transaction_date','signed_amount_pence','currency','decision_version','classification','recognized_pence'])) from merchant_versions v
 union all select 'batch',b.id,public.tax_pack_fields(to_jsonb(b),array['reviewed_stamp','rationale','author','request_id','created_at']) from public.merchant_review_batches b where b.user_id=p_owner and b.id in(select batch_id from merchant_items)
 union all select 'evidence',e.id,public.tax_pack_fields(to_jsonb(e),array['item_id','document_id'])||jsonb_build_object('document',public.tax_pack_fields(e.document_snapshot,array['id','file_sha256','media_type','size_bytes'])) from public.merchant_review_evidence e where e.user_id=p_owner and e.item_id in(select id from merchant_items)
 union all select 'batch_reversal',r.id,public.tax_pack_fields(to_jsonb(r),array['batch_id','reviewed_stamp','rationale','author','request_id','created_at']) from public.merchant_review_reversals r where r.user_id=p_owner and r.batch_id in(select batch_id from merchant_items)
 union all select 'undo',u.id,public.tax_pack_fields(to_jsonb(u),array['reversal_id','item_id','transaction_id','after_version']) from public.merchant_review_undo_items u where u.user_id=p_owner and u.item_id in(select id from merchant_items)
),legacy_changes as(
 select h.id,h.record_id,h.changed_by,h.action,h.changed_at,
 public.tax_pack_fields(coalesce(h.previous_record,'{}'::jsonb),array['id','record_type','record_date','effect_sign','status','category_id','tax_year_start','source_type','bank_transaction_id'])||case when h.previous_record->>'amount' is not null then jsonb_build_object('amount_pence',((h.previous_record->>'amount')::numeric*100)::bigint) else '{}'::jsonb end previous_record,
 public.tax_pack_fields(coalesce(h.new_record,'{}'::jsonb),array['id','record_type','record_date','effect_sign','status','category_id','tax_year_start','source_type','bank_transaction_id'])||case when h.new_record->>'amount' is not null then jsonb_build_object('amount_pence',((h.new_record->>'amount')::numeric*100)::bigint) else '{}'::jsonb end new_record
 from public.financial_record_changes h where h.user_id=p_owner and (h.previous_record->>'tax_year_start'=(select y::text from year) or h.new_record->>'tax_year_start'=(select y::text from year))
),attachments as(select a.id,a.record_id,a.content_type,a.size_bytes,a.status,a.created_at,'unavailable'::text content_hash_status from public.record_attachments a join public.financial_records f on f.id=a.record_id and f.user_id=a.user_id where a.user_id=p_owner and f.tax_year_start=(select y from year)),
revisions as(select v.id,v.invoice_id,v.version,v.pdf_sha256,v.author,v.created_at from public.invoice_revisions v where v.user_id=p_owner and v.invoice_id in(select id from inv)),
batch_items as(select i.id,i.batch_id,i.document_id,i.ordinal from public.document_batch_items i where i.user_id=p_owner and i.batch_id in(select id from batches))
select jsonb_build_object('schema_version','filing-pack-input/1','owner_id',p_owner,'tax_year_start',(select y from year),
 'calculation',(select public.tax_pack_fields(to_jsonb(c),array['id','tax_year_start','ruleset_id','engine_version','input','result','input_canonical_json','result_canonical_json','input_sha256','result_sha256','rationale','author','request_id','created_at']) from calc c),
 'rules',(select jsonb_build_object('id',r.id,'canonical_json',r.canonical_json,'sha256',r.sha256) from public.tax_rulesets r join calc c on c.ruleset_id=r.id),
 'calculation_is_current',(select c.input=public.tax_calculation_input_for_owner(p_owner,c.tax_year_start) from calc c),
 'observations',coalesce((select jsonb_agg(to_jsonb(t) order by id) from observations t),'[]'::jsonb),
 'imports',coalesce((select jsonb_agg(to_jsonb(i) order by id) from imports i),'[]'::jsonb),
 'classifications',coalesce((select jsonb_agg(to_jsonb(d) order by id) from decisions d),'[]'::jsonb),
 'source_events',coalesce((select jsonb_agg(to_jsonb(e) order by id) from source_events e),'[]'::jsonb),
 'invoice_balances',coalesce((select jsonb_agg(to_jsonb(i) order by id) from invoice_balances i),'[]'::jsonb),
 'receipt_balances',coalesce((select jsonb_agg(to_jsonb(r) order by id) from receipt_balances r),'[]'::jsonb),
 'reconciliation',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'data',data) order by kind,id) from reconciliation_events),'[]'::jsonb),
 'merchant',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'data',data) order by kind,id) from merchant_events),'[]'::jsonb),
 'documents',coalesce((select jsonb_agg(to_jsonb(d) order by id) from documents d),'[]'::jsonb),
 'document_batches',coalesce((select jsonb_agg(to_jsonb(b) order by id) from batches b),'[]'::jsonb),
 'document_items',coalesce((select jsonb_agg(to_jsonb(i) order by id) from batch_items i),'[]'::jsonb),
 'invoice_revisions',coalesce((select jsonb_agg(to_jsonb(v) order by id) from revisions v),'[]'::jsonb),
 'legacy_changes',coalesce((select jsonb_agg(to_jsonb(h) order by id) from legacy_changes h),'[]'::jsonb),
 'legacy_attachments',coalesce((select jsonb_agg(to_jsonb(a) order by id) from attachments a),'[]'::jsonb));
$$;

-- New captures use the complete-effect artifact version. Exact retained v1
-- requests recover before current-state/version checks; prior bytes are untouched.
create or replace function public.capture_filing_pack(p_owner uuid,p_calculation uuid,p_input text,p_bundle text,p_reason text,p_request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare prior public.filing_packs;input_data jsonb;output jsonb;review jsonb;artifact jsonb;saved uuid;mapping_text text;
begin
 if p_owner is null or p_calculation is null or p_input is null or p_bundle is null or p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Review draft pack inputs and reason.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||p_owner::text,0));
 select * into prior from public.filing_packs where user_id=p_owner and request_id=p_request;
 if found then if prior.calculation_id<>p_calculation or prior.input_canonical_json<>p_input or prior.bundle_canonical_json<>p_bundle or prior.reason<>btrim(p_reason) then raise exception 'Pack request has different inputs.';end if;return prior.id;end if;
 perform public.freeze_tax_pack_inputs();input_data:=p_input::jsonb;output:=p_bundle::jsonb;
 if input_data is distinct from public.tax_filing_pack_input_for_owner(p_owner,p_calculation) or input_data->>'owner_id' is distinct from p_owner::text or input_data->>'calculation_is_current' is distinct from 'true' then raise exception 'Pack inputs changed. Save a current calculation and review again.';end if;
 if output->>'schema_version' is distinct from 'draft-filing-pack/2' or output->>'document_status' is distinct from 'Draft — not submitted to HMRC' or output->>'input_sha256' is distinct from encode(sha256(convert_to(p_input,'UTF8')),'hex') or output->>'review_status' is null or output->>'review_status' not in ('draft_incomplete','draft_reviewed') or output->>'mapping_version' is null or jsonb_typeof(output->'artifacts') is distinct from 'array' or jsonb_array_length(output->'artifacts')<>7 or jsonb_typeof(output->'reviews') is distinct from 'array' then raise exception 'Review all seven draft outputs and versions.';end if;
 for review in select * from jsonb_array_elements(output->'reviews') loop
  if not exists(select 1 from public.filing_pack_step_reviews r where r.user_id=p_owner and r.tax_year_start=(input_data->>'tax_year_start')::integer and r.id=(review->>'id')::uuid and r.step=review->>'step' and r.digest=review->>'digest' and r.data=review->'data' and not exists(select 1 from public.filing_pack_step_reviews later where later.user_id=r.user_id and later.tax_year_start=r.tax_year_start and later.step=r.step and later.digest=r.digest and later.ordinal>r.ordinal)) then raise exception 'Step review provenance changed.';end if;
 end loop;
 if output->>'review_status'='draft_reviewed' and (output->>'completeness_attested' is distinct from 'true' or jsonb_array_length(output->'reviews')<>10 or (select count(distinct v->>'step') from jsonb_array_elements(output->'reviews') v)<>10 or jsonb_array_length(output->'blocking_issues')<>0 or input_data->'calculation'->'result'->>'status' is distinct from 'estimate') then raise exception 'Completeness needs current reviews and no unresolved blockers.';end if;
 if (output->>'tax_year_start')::integer is distinct from (input_data->>'tax_year_start')::integer or (output->>'completeness_attested'='true') is distinct from (output->>'review_status'='draft_reviewed') or output->>'request_id' is distinct from p_request::text or jsonb_typeof(output->'blocking_issues') is distinct from 'array' or jsonb_typeof(output->'completeness_attested') is distinct from 'boolean' or (select count(distinct a->>'name') from jsonb_array_elements(output->'artifacts') a)<>7 or exists(select 1 from jsonb_array_elements(output->'artifacts') a where a->>'name' is null or a->>'name' not in ('worksheet.html','normalized-ledger.csv','invoice-payment-reconciliation.csv','expense-decisions.csv','exceptions.csv','calculation-trace.json','evidence-manifest.json')) then raise exception 'Review distinct artifacts, request and completeness status.';end if;
 for artifact in select * from jsonb_array_elements(output->'artifacts') loop
  if jsonb_typeof(artifact->'body') is distinct from 'string' or artifact->>'sha256' is distinct from encode(sha256(convert_to(artifact->>'body','UTF8')),'hex') or (artifact->>'size_bytes')::bigint is distinct from octet_length(convert_to(artifact->>'body','UTF8')) then raise exception 'Artifact integrity failed.';end if;
 end loop;
 mapping_text:=output->>'mapping_canonical_json';
 if mapping_text is null or mapping_text::jsonb is distinct from output->'mapping' or output->>'mapping_sha256' is distinct from encode(sha256(convert_to(mapping_text,'UTF8')),'hex') or output->'mapping'->>'id' is distinct from output->>'mapping_version' or (output->'mapping'->>'tax_year_start')::integer is distinct from (input_data->>'tax_year_start')::integer then raise exception 'Annual mapping integrity failed.';end if;
 insert into public.tax_form_mappings(id,tax_year_start,mapping,canonical_json,sha256) values(output->>'mapping_version',(input_data->>'tax_year_start')::integer,output->'mapping',mapping_text,output->>'mapping_sha256') on conflict(id) do nothing;
 if not exists(select 1 from public.tax_form_mappings m where m.id=output->>'mapping_version' and m.canonical_json=mapping_text) then raise exception 'Mapping version already has different content.';end if;
 insert into public.filing_packs(user_id,tax_year_start,calculation_id,mapping_version,input,input_canonical_json,input_sha256,bundle,bundle_canonical_json,bundle_sha256,review_status,completeness_attested,reason,author,request_id)
 values(p_owner,(input_data->>'tax_year_start')::integer,p_calculation,output->>'mapping_version',input_data,p_input,encode(sha256(convert_to(p_input,'UTF8')),'hex'),output,p_bundle,encode(sha256(convert_to(p_bundle,'UTF8')),'hex'),output->>'review_status',coalesce((output->>'completeness_attested')::boolean,false),btrim(p_reason),p_owner,p_request) returning id into saved;return saved;
end;$$;

-- Add link/project identity to new calculation source records. Retained inputs
-- lacking these optional metadata fields remain replayable without rewriting.
create or replace function public.tax_calculation_input_for_owner(p_owner uuid,p_year integer) returns jsonb language sql stable security definer set search_path='' as $$
with financial as materialized(select public.tax_financial_stamp_for_owner(p_owner) stamp),
facts as materialized (
 select v.id,v.family_id,v.ordinal,f.kind,f.label,f.tax_year_start,v.state,v.data,v.rationale,v.created_at
 from public.tax_fact_families f join public.tax_fact_revisions v on v.family_id=f.id and v.user_id=f.user_id
 where f.user_id=p_owner and f.tax_year_start=p_year and not exists(select 1 from public.tax_fact_revisions n where n.user_id=v.user_id and n.family_id=v.family_id and n.ordinal>v.ordinal)
),profile as (
 select v.id,v.profile_id,v.ordinal,v.state,v.data,v.financial_stamp,v.rationale,v.created_at,v.financial_stamp=(select stamp from financial) ledger_is_current
 from public.tax_profiles p join public.tax_profile_revisions v on v.profile_id=p.id and v.user_id=p.user_id
 where p.user_id=p_owner and p.tax_year_start=p_year order by v.ordinal desc limit 1
),sections as (
 select a.id,a.kind,a.verdict,a.fact_digest,a.fact_digest=(select md5(coalesce(string_agg(f.id::text||':'||f.state,',' order by f.id),'')) from facts f where f.kind=a.kind) is_current
 from public.tax_section_attestations a where a.user_id=p_owner and a.tax_year_start=p_year
 and not exists(select 1 from public.tax_section_attestations n where n.user_id=a.user_id and n.tax_year_start=a.tax_year_start and n.kind=a.kind and n.ordinal>a.ordinal)
),scope as (
 select s.id,s.ordinal,s.state,s.input_stamp,s.input_stamp=public.tax_review_stamp_for_owner(p_owner,p_year) is_current,s.data,s.evidence_document_id,s.document_snapshot,s.rationale,s.author,s.created_at
 from public.tax_calculation_scopes s where s.user_id=p_owner and s.tax_year_start=p_year order by s.ordinal desc limit 1
),records as (
 select f.id,f.record_type,f.record_date,(f.amount*100)::bigint amount_pence,f.effect_sign,f.status,f.bank_transaction_id,f.refund_link_id,f.project_id,r.original_transaction_id original_bank_transaction_id,f.source_type,
 case when c.id is null then null else jsonb_build_object('id',c.id,'name',c.name,'record_type',c.record_type,'sa103_box',c.sa103_box,'valid',c.record_type=f.record_type and (c.user_id=p_owner or (c.user_id is null and c.is_default))) end category
 from public.financial_records f left join public.refund_links r on r.id=f.refund_link_id and r.user_id=f.user_id left join public.record_categories c on c.id=f.category_id and (c.user_id=p_owner or (c.user_id is null and c.is_default))
 where f.user_id=p_owner and f.tax_year_start=p_year
),observations as (
 select t.id,t.account_id,jsonb_build_object('id',a.id,'provider',a.provider,'account_type',a.account_type,'masked_identifier',a.masked_identifier) account,t.import_id,t.source_row_id,t.file_hash,t.row_hash,t.row_number,t.transaction_date,t.signed_amount_pence,t.currency,t.classification,t.decision_version,t.business_use_bps,t.dedupe_status,t.import_status,t.recognized_pence,t.has_financial_dependencies
 from public.duplicate_review_transactions t join public.bank_transactions b on b.id=t.id and b.user_id=t.user_id join public.financial_accounts a on a.id=t.account_id and a.user_id=t.user_id where t.user_id=p_owner and b.tax_year_start=p_year
),sources as (
 select s.id,s.revision_id,s.document_id,s.transaction_id,s.record_id,
 (select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(s.snapshot) where key=any(case when s.document_id is not null then array['id','file_sha256','media_type','size_bytes'] when s.transaction_id is not null then array['id','import_id','source_row_id','file_sha256','row_sha256','row_number','transaction_date','signed_amount_pence','currency','classification','decision_version','recognized_pence'] else array['id','record_type','effect_sign','record_date','tax_year_start','status','bank_transaction_id'] end)) || case when s.record_id is not null then jsonb_build_object('amount_pence',((s.snapshot->>'amount')::numeric*100)::bigint) else '{}'::jsonb end snapshot,
 case when s.transaction_id is not null then coalesce(t.recognized_pence,0) when f.status='approved' then (f.amount*100*f.effect_sign)::bigint else 0 end current_recognized_pence,
 case when s.transaction_id is not null then coalesce(t.import_status='discarded' or t.dedupe_status<>'clear' or t.decision_version<>(s.snapshot->>'decision_version')::integer,true)
 when s.record_id is not null then coalesce(f.status<>'approved' or f.amount<>(s.snapshot->>'amount')::numeric or f.record_type<>s.snapshot->>'record_type' or f.record_date<>(s.snapshot->>'record_date')::date or f.effect_sign<>(s.snapshot->>'effect_sign')::integer,true) else false end source_unresolved
 from public.tax_fact_sources s join facts v on v.id=s.revision_id left join public.duplicate_review_transactions t on t.id=s.transaction_id and t.user_id=s.user_id left join public.financial_records f on f.id=s.record_id and f.user_id=s.user_id where s.user_id=p_owner
)
select jsonb_build_object('schema_version','tax-calculation-input/1','owner_id',p_owner,'tax_year_start',p_year,'financial_stamp',(select stamp from financial),
 'profile',(select to_jsonb(p) from profile p),'scope',(select to_jsonb(s) from scope s),
 'facts',coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from facts f),'[]'::jsonb),
 'sections',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from sections s),'[]'::jsonb),
 'records',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from records r),'[]'::jsonb),
 'observations',coalesce((select jsonb_agg(to_jsonb(o) order by o.id) from observations o),'[]'::jsonb),
 'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from sources s),'[]'::jsonb));
$$;

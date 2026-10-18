-- Safe read model only. Approval/reversal grants deliberately remain private.
create function public.read_fx_settlement_catalog() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();evidence jsonb;invoices jsonb;receipts jsonb;lots jsonb;result jsonb;
 invoice_count integer;receipt_count integer;lot_count integer;
begin
 if owner_id is null then raise exception 'Sign in to review FX settlements.';end if;
 select count(*) into invoice_count from public.invoices where user_id=owner_id and origin='preserved_external';
 select count(*) into receipt_count from public.bank_transactions where user_id=owner_id and currency='GBP' and signed_amount_pence>0;
 select count(*) into lot_count from public.fx_conversion_lots where user_id=owner_id;
 if greatest(invoice_count,receipt_count,lot_count)>10000 then raise exception 'Complete FX settlement context exceeds the safe catalog limit.';end if;
 evidence:=public.read_fx_evidence_catalog();
 select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') into invoices from(
  select i.id,i.user_id,i.status,i.invoice_date,i.currency,i.original_total_minor invoice_minor,
   r.id revision_id,r.source_fact_revision_id,coalesce(a.original_minor,0)::bigint allocated_minor,
   coalesce(a.cash_pence,0)::bigint allocated_cash_pence
  from public.invoices i left join public.invoice_revisions r on r.invoice_id=i.id and r.user_id=i.user_id and r.version=i.external_revision and r.origin='preserved_external' and r.source_fact_revision_id=i.source_fact_revision_id
  left join(select user_id,invoice_id,sum(invoice_minor) original_minor,sum(amount_pence) cash_pence from public.active_dimensioned_invoice_allocations where settlement_kind='fx_gbp_cash' and user_id=owner_id group by user_id,invoice_id) a on a.invoice_id=i.id and a.user_id=i.user_id
  where i.user_id=owner_id and i.origin='preserved_external'
 ) s;
 select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') into receipts from(
  select t.id,t.user_id,t.import_id,t.source_row_id,t.transaction_date,t.currency,t.signed_amount_pence signed_minor,
   t.decision_version,t.classification,t.business_use_bps,t.dedupe_status,t.active_transfer_id,t.active_refund_id,i.status import_status,
   t.recognized_record_id,r.bank_transaction_id record_transaction_id,r.record_type,r.status record_status,r.effect_sign,
   case when r.id is null then null else (r.amount*100)::bigint end recognized_gbp_pence,
   coalesce(a.cash_pence,0)::bigint allocated_minor
  from public.bank_transactions t left join public.record_imports i on i.id=t.import_id and i.user_id=t.user_id
  left join public.financial_records r on r.id=t.recognized_record_id and r.user_id=t.user_id
  left join(select user_id,transaction_id,sum(amount_pence) cash_pence from public.active_invoice_allocations where user_id=owner_id group by user_id,transaction_id) a on a.transaction_id=t.id and a.user_id=t.user_id
  where t.user_id=owner_id and t.currency='GBP' and t.signed_amount_pence>0
 ) s;
 -- Retained history is separate from latest-per-family evidence. Source loss or
 -- withdrawal cannot erase a lot or its zero-cash reversal dependency.
 select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') into lots from(
  select l.id,l.user_id,l.invoice_id,l.invoice_revision_id,l.invoice_fact_revision_id,
   p.document_id invoice_document_id,d.file_hash invoice_document_sha256,
   l.conversion_document_id,c.file_hash conversion_document_sha256,l.conversion_family_id,l.conversion_fact_revision_id,
   l.transaction_id receipt_id,l.transaction_version receipt_version,l.ruleset_id,l.invoice_currency,l.cash_currency,
   l.invoice_limit_minor,l.cash_limit_minor,l.rate,l.conversion_date,l.evidence_date,
   coalesce(h.version,0)::bigint version,coalesce(a.active_count,0)::bigint active_count,
   coalesce(a.original_minor,0)::bigint prior_invoice_minor,coalesce(a.cash_pence,0)::bigint prior_cash_minor
  from public.fx_conversion_lots l
  left join public.fx_document_fact_revisions p on p.id=l.invoice_fact_revision_id and p.user_id=l.user_id
  left join public.evidence_documents d on d.id=p.document_id and d.user_id=l.user_id
  left join public.evidence_documents c on c.id=l.conversion_document_id and c.user_id=l.user_id
  left join(select user_id,conversion_lot_id,count(*) version from public.invoice_settlements where user_id=owner_id and conversion_lot_id is not null group by user_id,conversion_lot_id) h on h.conversion_lot_id=l.id and h.user_id=l.user_id
  left join(select user_id,conversion_lot_id,count(*) active_count,sum(invoice_minor) original_minor,sum(amount_pence) cash_pence from public.active_dimensioned_invoice_allocations where user_id=owner_id and settlement_kind='fx_gbp_cash' group by user_id,conversion_lot_id) a on a.conversion_lot_id=l.id and a.user_id=l.user_id
  where l.user_id=owner_id
 ) s;
 if jsonb_array_length(invoices)<>invoice_count or jsonb_array_length(receipts)<>receipt_count or jsonb_array_length(lots)<>lot_count then raise exception 'Complete FX settlement context unavailable.';end if;
 result:=jsonb_build_object('schema_version','fx-settlement-catalog/1','owner_id',owner_id,'ruleset_id','vibecount-currencies/1',
  'financial_stamp',public.fx_settlement_review_stamp(),'scope','external_invoice_gbp_receipt_no_fees',
  'counts',jsonb_build_object('invoices',invoice_count,'receipts',receipt_count,'lots',lot_count),
  'invoices',invoices,'receipts',receipts,'lots',lots,'evidence',evidence,'valuations','[]'::jsonb,'financial_action','preview_only');
 if octet_length(result::text)>2000000 then raise exception 'Complete FX settlement context exceeds the safe payload limit.';end if;
 return result;
end;$$;
revoke all on function public.read_fx_settlement_catalog() from public,anon,service_role;
grant execute on function public.read_fx_settlement_catalog() to authenticated;

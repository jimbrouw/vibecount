-- Retained source/filing provenance only. No financial writer grants.
create view public.fx_provenance_lot_sources with(security_invoker=true) as
select l.*,
 (select count(*) from public.invoice_settlements s where s.user_id=l.user_id and s.conversion_lot_id=l.id)::bigint event_count,
 (select count(*) from public.active_dimensioned_invoice_allocations s where s.user_id=l.user_id and s.conversion_lot_id=l.id and s.settlement_kind='fx_gbp_cash')::bigint active_count
from public.fx_lot_export_sources l;
revoke all on public.fx_provenance_lot_sources from public,anon,authenticated,service_role;
grant select on public.fx_provenance_lot_sources to authenticated;

create function public.fx_provenance_for_owner(p_owner uuid,p_receipts uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if p_owner is null or p_receipts is null then raise exception 'Owned source scope required.';end if;
 with lots as materialized(select l.* from public.fx_provenance_lot_sources l where l.user_id=p_owner and l.receipt_id=any(p_receipts)),
 events as materialized(select s.* from public.invoice_settlements s where s.user_id=p_owner and s.conversion_lot_id in(select id from lots))
 select jsonb_build_object('schema_version','vibecount.fx-provenance/1','scope','selected_source_receipts_complete_retained_history_not_accounting_effects','owner_id',p_owner,
 'counts',jsonb_build_object('lots',(select count(*) from lots),'events',(select count(*) from events)),
 'lots',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from lots l),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(public.tax_pack_fields(to_jsonb(s),array['id','user_id','invoice_id','transaction_id','settlement_kind','event_kind','reverses_id','request_id','author','created_at','rationale','amount_pence','invoice_minor','invoice_currency','invoice_revision_id','conversion_lot_id','lot_event_ordinal','invoice_snapshot','fx_snapshot']) order by s.id) from events s),'[]'::jsonb)) into result;
 if octet_length(result::text)>2000000 then raise exception 'Complete FX provenance exceeds the safe payload limit.';end if;
 return result;
end;$$;
revoke all on function public.fx_provenance_for_owner(uuid,uuid[]) from public,anon,authenticated,service_role;

-- Copy the compatibility body, preserving the current entry-point OID.
do $$declare definition text;copied text;begin
 select pg_get_functiondef('public.tax_filing_pack_input_for_owner(uuid,uuid)'::regprocedure) into definition;
 copied:=replace(definition,'FUNCTION public.tax_filing_pack_input_for_owner(','FUNCTION public.tax_filing_pack_input_v2_for_owner(');
 if copied=definition or position('filing-pack-input/2' in definition)=0 then raise exception 'Expected filing V2 predecessor unavailable.';end if;
 execute copied;
end;$$;
revoke all on function public.tax_filing_pack_input_v2_for_owner(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.tax_filing_pack_input_for_owner(p_owner uuid,p_calculation uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base jsonb;provenance jsonb;receipts uuid[];result jsonb;begin
 base:=public.tax_filing_pack_input_v2_for_owner(p_owner,p_calculation);
 if base->>'owner_id' is distinct from p_owner::text or base->'calculation'->>'id' is distinct from p_calculation::text then raise exception 'Owned saved calculation required.';end if;
 select coalesce(array_agg((r->>'id')::uuid),'{}'::uuid[]) into receipts from jsonb_array_elements(base->'observations') r;
 provenance:=public.fx_provenance_for_owner(p_owner,receipts);
 -- V3 emits FX exactly once, through complete retained history, never a native-shaped event.
 select base||jsonb_build_object('schema_version','filing-pack-input/3','fx_provenance',provenance,
 'reconciliation',coalesce((select jsonb_agg(e.value order by e.ordinality) from jsonb_array_elements(base->'reconciliation') with ordinality e where not
 (e.value->>'kind'='settlement' and exists(select 1 from public.invoice_settlements s where s.user_id=p_owner and s.id::text=e.value->>'id' and s.settlement_kind='fx_gbp_cash'))),'[]'::jsonb)) into result;
 if octet_length(result::text)>4000000 then raise exception 'Complete filing input exceeds direct review capacity.';end if;
 return result;
end;$$;
revoke all on function public.tax_filing_pack_input_for_owner(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.freeze_tax_pack_inputs() returns void language plpgsql set search_path='' as $$begin
 lock table public.financial_accounts,public.financial_records,public.record_categories,public.bank_transactions,public.record_imports,public.invoices,public.record_attachments,public.financial_record_changes,public.evidence_documents,public.document_batches,public.document_batch_items,public.source_import_events,public.classification_decisions,
 public.fx_conversion_lots,public.invoice_settlements,public.invoice_revisions,public.fx_document_fact_families,public.fx_document_fact_revisions,storage.objects in share mode nowait;
end;$$;

-- Exact retained requests still recover before any current-version checks.
do $$declare definition text;changed text;begin
 select pg_get_functiondef('public.capture_filing_pack(uuid,uuid,text,text,text,uuid)'::regprocedure) into definition;
 if position('draft-filing-pack/3' in definition)=0 or position('filing-pack-input/2' in definition)=0 then raise exception 'Expected filing capture V3 predecessor unavailable.';end if;
 changed:=replace(replace(definition,'draft-filing-pack/3','draft-filing-pack/4'),'filing-pack-input/2','filing-pack-input/3');
 if position('perform public.freeze_tax_pack_inputs();' in changed)=0 then raise exception 'Expected retry-first capture boundary unavailable.';end if;
 changed:=replace(changed,'perform public.freeze_tax_pack_inputs();','if octet_length(p_input)>4000000 or octet_length(p_bundle)>4000000 then raise exception ''Complete filing capture exceeds the safe payload limit.'';end if; perform public.freeze_tax_pack_inputs();');
 execute changed;
end;$$;

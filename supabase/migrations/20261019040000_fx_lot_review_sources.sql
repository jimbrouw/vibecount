-- Retained ancestry, not current evidence eligibility. No financial grants.
create view public.fx_lot_export_sources with(security_invoker=true) as
select l.id,l.user_id,l.invoice_id,l.invoice_revision_id,l.invoice_fact_revision_id,l.conversion_document_id,l.conversion_family_id,l.conversion_fact_revision_id,
 l.transaction_id receipt_id,l.transaction_version receipt_version,l.ruleset_id,l.invoice_currency,l.cash_currency,l.invoice_limit_minor,l.cash_limit_minor,l.rate,l.conversion_date,l.evidence_date,
 r.snapshot invoice_snapshot,
 jsonb_build_object('id',p.id,'user_id',p.user_id,'family_id',p.family_id,'kind',p.kind,'ordinal',p.ordinal,'state',p.state,'ruleset_id',p.ruleset_id,'document_id',p.document_id,
 'invoice_evidence_revision_id',p.invoice_evidence_revision_id,'transaction_id',p.transaction_id,'transaction_version',p.transaction_version,'data',p.data,'source_snapshot',p.source_snapshot,
 'human_read_original',p.human_read_original,'created_at',p.created_at,'author',p.author,'rationale',p.rationale) invoice_fact,
 jsonb_build_object('id',c.id,'user_id',c.user_id,'family_id',c.family_id,'kind',c.kind,'ordinal',c.ordinal,'state',c.state,'ruleset_id',c.ruleset_id,'document_id',c.document_id,
 'invoice_evidence_revision_id',c.invoice_evidence_revision_id,'transaction_id',c.transaction_id,'transaction_version',c.transaction_version,'data',c.data,'source_snapshot',c.source_snapshot,
 'human_read_original',c.human_read_original,'created_at',c.created_at,'author',c.author,'rationale',c.rationale) conversion_fact
from public.fx_conversion_lots l
left join public.invoice_revisions r on r.id=l.invoice_revision_id and r.user_id=l.user_id and r.invoice_id=l.invoice_id
left join public.fx_document_fact_revisions p on p.id=l.invoice_fact_revision_id and p.user_id=l.user_id
left join public.fx_document_fact_revisions c on c.id=l.conversion_fact_revision_id and c.user_id=l.user_id;
revoke all on public.fx_lot_export_sources from public,anon,authenticated,service_role;
grant select on public.fx_lot_export_sources to authenticated;

create function public.read_fx_lot_portions(p_lot uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();lot jsonb;portions jsonb;head bigint;active_count integer;result jsonb;begin
 if owner_id is null or p_lot is null then raise exception 'Sign in and choose a retained FX lot.';end if;
 select to_jsonb(l) into lot from public.fx_lot_export_sources l where l.user_id=owner_id and l.id=p_lot;
 if lot is null then raise exception 'Owned retained FX lot unavailable.';end if;
 select count(*) into head from public.invoice_settlements where user_id=owner_id and conversion_lot_id=p_lot;
 select count(*) into active_count from public.active_dimensioned_invoice_allocations where user_id=owner_id and conversion_lot_id=p_lot and settlement_kind='fx_gbp_cash';
 if active_count>10000 or head>=2147483647 then raise exception 'Complete retained FX review exceeds the safe limit.';end if;
 select coalesce(jsonb_agg(to_jsonb(s) order by s.lot_event_ordinal),'[]') into portions from(
  select id,user_id,invoice_id,transaction_id,settlement_kind,event_kind,reverses_id,request_id,author,created_at,rationale,amount_pence,invoice_minor,invoice_currency,invoice_revision_id,conversion_lot_id,lot_event_ordinal,invoice_snapshot,fx_snapshot
  from public.active_dimensioned_invoice_allocations where user_id=owner_id and conversion_lot_id=p_lot and settlement_kind='fx_gbp_cash'
 ) s;
 if jsonb_array_length(portions)<>active_count then raise exception 'Complete active FX portions unavailable.';end if;
 result:=jsonb_build_object('schema_version','fx-lot-portions/1','owner_id',owner_id,'financial_stamp',public.fx_settlement_review_stamp(),'version',head,'active_count',active_count,'lot',lot,'portions',portions,'financial_action','preview_only');
 if octet_length(result::text)>2000000 then raise exception 'Complete retained FX review exceeds the safe payload limit.';end if;
 return result;
end;$$;
revoke all on function public.read_fx_lot_portions(uuid) from public,anon,service_role;
grant execute on function public.read_fx_lot_portions(uuid) to authenticated;

-- Safe receipt dimensions, never merchant descriptions or original documents.
-- NULL preserves native records with no receipt-specific cash semantics.
create function public.financial_record_receipt_dimensions(p_record jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select case when p_record->>'source_type'='receipt_document'
  or coalesce(p_record->>'payment_status','legacy')<>'legacy'
  or coalesce(p_record->>'currency','GBP')<>'GBP'
  or p_record->>'expense_kind'='refund'
 then jsonb_build_object('currency',coalesce(p_record->>'currency','GBP'),
  'payment_status',coalesce(p_record->>'payment_status','legacy'),
  'expense_kind',coalesce(p_record->>'expense_kind','expense'),
  'payment_date',p_record->'payment_date','document_date',p_record->'document_date','refund_of',p_record->'refund_of') end;
$$;
revoke all on function public.financial_record_receipt_dimensions(jsonb) from public,anon;
grant execute on function public.financial_record_receipt_dimensions(jsonb) to authenticated,service_role;

-- Only new explicit fact reviews capture these dimensions. Withdrawal copies
-- and completed-request retries keep their original immutable snapshots.
do $$declare original text;changed text;needle text;begin
 select pg_get_functiondef('public.review_tax_inputs(integer,jsonb,text,text,uuid)'::regprocedure) into original;
 needle:='''bank_transaction_id'',f.bank_transaction_id) into source_snapshot';
 changed:=replace(original,needle,'''bank_transaction_id'',f.bank_transaction_id,''receipt_dimensions'',public.financial_record_receipt_dimensions(to_jsonb(f))) into source_snapshot');
 if changed=original then raise exception 'Inspect receipt tax fact snapshot predecessor.';end if;
 execute changed;
end;$$;

create or replace view public.tax_fact_source_status with(security_invoker=true) as
select s.*,v.tax_year_start,v.kind,v.state fact_state,
 case when s.transaction_id is not null then coalesce(t.recognized_pence,0)
  else (coalesce(public.financial_record_cash_effect(to_jsonb(f)),0)*100)::bigint end current_recognized_pence,
 (case when s.transaction_id is not null then coalesce(t.import_status='discarded' or t.dedupe_status<>'clear' or t.decision_version<>(s.snapshot->>'decision_version')::integer,true)
  when s.record_id is not null then coalesce(f.status<>'approved' or f.amount<>(s.snapshot->>'amount')::numeric
   or f.record_type<>s.snapshot->>'record_type' or f.record_date<>(s.snapshot->>'record_date')::date
   or f.effect_sign<>(s.snapshot->>'effect_sign')::integer,true)
   or public.financial_record_receipt_dimensions(to_jsonb(f)) is distinct from nullif(s.snapshot->'receipt_dimensions','null'::jsonb)
  else false end
  or public.owned_evidence_reference_targeted(s.document_id,s.transaction_id,s.record_id)) source_unresolved
from public.tax_fact_sources s join public.current_tax_facts v on v.id=s.revision_id and v.user_id=s.user_id
left join public.duplicate_review_transactions t on t.id=s.transaction_id and t.user_id=s.user_id
left join public.financial_records f on f.id=s.record_id and f.user_id=s.user_id;

-- Current inputs consume current source status, including deletion fences.
-- Retained old input builders and saved calculation snapshots are untouched.
alter function public.tax_calculation_input_for_owner(uuid,integer) rename to tax_calculation_input_v105_for_owner;
revoke all on function public.tax_calculation_input_v105_for_owner(uuid,integer) from public,anon,authenticated,service_role;
create function public.tax_calculation_input_for_owner(p_owner uuid,p_year integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;sources jsonb;begin
 result:=public.tax_calculation_input_v105_for_owner(p_owner,p_year);
 select coalesce(jsonb_agg(s||jsonb_build_object(
  'current_recognized_pence',coalesce(v.current_recognized_pence,0),
  'source_unresolved',coalesce(v.source_unresolved,true) or (s->>'source_unresolved')::boolean,
  'snapshot',(s->'snapshot')||case when v.snapshot ? 'receipt_dimensions'
   then jsonb_build_object('receipt_dimensions',v.snapshot->'receipt_dimensions') else '{}'::jsonb end)
  order by n),'[]'::jsonb) into sources
 from jsonb_array_elements(result->'sources') with ordinality as entries(s,n)
 left join public.tax_fact_source_status v on v.id=(s->>'id')::uuid and v.user_id=p_owner;
 return jsonb_set(result,'{sources}',sources);
end;$$;
revoke all on function public.tax_calculation_input_for_owner(uuid,integer) from public,anon,authenticated,service_role;

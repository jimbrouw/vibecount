-- Preserve hosted receipt cash semantics alongside vNext signed records.
-- JSON field access also supports installations predating receipt metadata.
create function public.financial_record_cash_effect(p_record jsonb) returns numeric
language sql immutable set search_path='' as $$
 select case when p_record->>'status'='approved'
   and coalesce(p_record->>'currency','GBP')='GBP'
   and coalesce(p_record->>'payment_status','legacy')<>'unpaid'
  then (p_record->>'amount')::numeric * case when p_record->>'expense_kind'='refund' then -1 else coalesce((p_record->>'effect_sign')::smallint,1) end
  else null end;
$$;
revoke all on function public.financial_record_cash_effect(jsonb) from public,anon;
grant execute on function public.financial_record_cash_effect(jsonb) to authenticated,service_role;

create or replace view public.financial_record_quarter_summaries with(security_invoker=true) as
with effects as (
 select user_id,tax_year_start,tax_quarter,record_type,public.financial_record_cash_effect(to_jsonb(f)) as cash_effect
 from public.financial_records f
)
select user_id,tax_year_start,tax_quarter,
 coalesce(sum(cash_effect) filter(where record_type='income'),0) income_total,
 coalesce(sum(cash_effect) filter(where record_type='expense'),0) expense_total,
 count(*) filter(where record_type='income' and cash_effect is not null) income_count,
 count(*) filter(where record_type='expense' and cash_effect is not null) expense_count,
 coalesce(sum(cash_effect) filter(where record_type='income'),0)-coalesce(sum(cash_effect) filter(where record_type='expense'),0) net_total
from effects group by user_id,tax_year_start,tax_quarter;

-- Keep the hosted receipt reporting view's existing column order and grants.
-- Adding vNext columns in front of reporting_amount would break CREATE OR
-- REPLACE VIEW compatibility; list its retained columns explicitly instead.
do $$declare columns text;begin
 if to_regclass('public.financial_record_reporting') is not null then
  select string_agg(format('r.%I',attname),',' order by attnum) into columns from pg_attribute
   where attrelid='public.financial_record_reporting'::regclass and attnum>0 and not attisdropped and attname<>'reporting_amount';
  execute 'create or replace view public.financial_record_reporting with(security_invoker=true) as select '
   ||columns||',public.financial_record_cash_effect(to_jsonb(r)) as reporting_amount from public.financial_records r where public.financial_record_cash_effect(to_jsonb(r)) is not null';
 end if;
end $$;

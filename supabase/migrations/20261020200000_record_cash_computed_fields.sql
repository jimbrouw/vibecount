-- PostgREST computed fields on the existing table retain its RLS and embedded
-- category/attachment relationships, without depending on hosted-only columns.
create function public.cash_effect_pence(public.financial_records) returns bigint
language sql immutable set search_path='' as $$
 select (public.financial_record_cash_effect(to_jsonb($1))*100)::bigint;
$$;
create function public.cash_treatment(public.financial_records) returns text
language sql immutable set search_path='' as $$
 select case when $1.status<>'approved' then 'not_approved'
  when coalesce(to_jsonb($1)->>'currency','GBP')<>'GBP' then 'unsupported_currency'
  when to_jsonb($1)->>'payment_status'='unpaid' then 'unpaid' else 'recognized' end;
$$;
revoke all on function public.cash_effect_pence(public.financial_records),public.cash_treatment(public.financial_records) from public,anon;
grant execute on function public.cash_effect_pence(public.financial_records),public.cash_treatment(public.financial_records) to authenticated,service_role;
notify pgrst,'reload schema';

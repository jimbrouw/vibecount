-- Receipt-aware inputs are explicit V5. Native-only input contracts remain V4;
-- earlier saved calculations and their raw amounts/signs remain unchanged.
alter function public.tax_calculation_input_for_owner(uuid,integer) rename to tax_calculation_input_v106_for_owner;
revoke all on function public.tax_calculation_input_v106_for_owner(uuid,integer) from public,anon,authenticated,service_role;
create function public.tax_calculation_input_for_owner(p_owner uuid,p_year integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;records jsonb;has_receipts boolean;begin
 result:=public.tax_calculation_input_v106_for_owner(p_owner,p_year);
 select coalesce(jsonb_agg(r||jsonb_build_object('receipt_dimensions',public.financial_record_receipt_dimensions(to_jsonb(f))) order by n),'[]'::jsonb),
  coalesce(bool_or(public.financial_record_receipt_dimensions(to_jsonb(f)) is not null),false)
 into records,has_receipts from jsonb_array_elements(result->'records') with ordinality as entries(r,n)
 join public.financial_records f on f.id=(r->>'id')::uuid and f.user_id=p_owner;
 if jsonb_array_length(records)<>jsonb_array_length(result->'records') then raise exception 'Complete receipt cash projection unavailable.';end if;
 if has_receipts then result:=result||jsonb_build_object('schema_version','tax-calculation-input/5','records',records);end if;
 if octet_length(result::text)>4000000 then raise exception 'Complete tax input exceeds direct review capacity.';end if;
 return result;
end;$$;
revoke all on function public.tax_calculation_input_for_owner(uuid,integer) from public,anon,authenticated,service_role;

-- V5 retains the identical bank accounting coverage contract and withholding.
do $$declare original text;changed text;begin
 select pg_get_functiondef('public.tax_bank_sources_blocked(jsonb)'::regprocedure) into original;
 changed:=replace(original,'if p_input->>''schema_version'' is distinct from ''tax-calculation-input/4'' then',
 'if p_input->>''schema_version'' is distinct from ''tax-calculation-input/4'' and p_input->>''schema_version'' is distinct from ''tax-calculation-input/5'' then');
 if changed=original then raise exception 'Inspect tax bank withholding predecessor.';end if;
 execute changed;
end;$$;

-- Admission still compares the complete frozen input. Also independently check
-- receipt-aware cash candidate totals before accepting the supplied result.
do $$declare original text;changed text;needle text;begin
 select pg_get_functiondef('public.capture_tax_calculation(uuid,integer,text,text,text,text,uuid)'::regprocedure) into original;
 changed:=replace(original,'if input_data->>''schema_version'' is distinct from ''tax-calculation-input/4'' then',
 'if input_data->>''schema_version'' is distinct from ''tax-calculation-input/4'' and input_data->>''schema_version'' is distinct from ''tax-calculation-input/5'' then');
 if changed=original then raise exception 'Inspect receipt tax capture admission.';end if;
 needle:='rule_id:=rules_data->>''id'';';
 if position(needle in changed)=0 then raise exception 'Inspect receipt candidate capture boundary.';end if;
 changed:=replace(changed,needle,$patch$
 if input_data->>'schema_version'='tax-calculation-input/5' and exists(
  select 1 from unnest(array['income','expense']) kind
  where (output_data#>>array['totals',case kind when 'income' then 'ledger_income' else 'ledger_expenses' end])::numeric
   is distinct from (select coalesce(sum(public.financial_record_cash_effect(to_jsonb(f))*100),0)
    from public.financial_records f where f.user_id=p_owner and f.tax_year_start=p_year and f.record_type=kind)
 ) then raise exception 'Receipt cash candidate totals differ from approved evidence.';end if;
 $patch$||needle);
 execute changed;
end;$$;

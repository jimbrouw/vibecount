-- Correct current operational cash projections without rewriting retained V1
-- behavior or approved receipt rows. Bank coverage and private ACLs stay intact.
do $$declare original text;changed text;begin
 select pg_get_functiondef('public.financial_review_catalog_v1(uuid,integer,date)'::regprocedure) into original;
 changed:=replace(original,'FUNCTION public.financial_review_catalog_v1(','FUNCTION public.financial_review_cash_catalog(');
 changed:=replace(changed,'f.tax_quarter,f.updated_at from public.financial_records f',
  'f.tax_quarter,f.updated_at,public.financial_record_cash_effect(to_jsonb(f)) cash_effect,to_jsonb(f)->>''payment_status'' payment_status,to_jsonb(f)->>''currency'' currency,to_jsonb(f)->>''expense_kind'' expense_kind from public.financial_records f');
 changed:=replace(changed,'r.amount*100*r.effect_sign','r.cash_effect*100');
 changed:=replace(changed,'(amount*100*effect_sign)::bigint amount_pence','(coalesce(cash_effect,0)*100)::bigint amount_pence,case when currency is not null and currency<>''GBP'' then ''unsupported_currency'' when payment_status=''unpaid'' then ''unpaid'' else ''recognized'' end cash_treatment');
 changed:=replace(changed,'''categorised'',categorised)', '''categorised'',categorised,''cash_treatment'',cash_treatment)');
 if changed=original or position('f.tax_quarter,f.updated_at from public.financial_records f' in changed)>0
  or position('r.amount*100*r.effect_sign' in changed)>0 or position('(amount*100*effect_sign)' in changed)>0
  or position('''cash_treatment'',cash_treatment' in changed)=0 then
  raise exception 'Inspect the operational cash projection predecessor.';
 end if;
 execute changed;
 select pg_get_functiondef('public.financial_review_catalog(uuid,integer,date)'::regprocedure) into original;
 changed:=replace(original,'public.financial_review_catalog_v1(p_owner,p_year,p_as_of)','public.financial_review_cash_catalog(p_owner,p_year,p_as_of)');
 if changed=original then raise exception 'Inspect the current operational review wrapper.';end if;
 execute changed;
end;$$;
revoke all on function public.financial_review_cash_catalog(uuid,integer,date) from public,anon,authenticated,service_role;

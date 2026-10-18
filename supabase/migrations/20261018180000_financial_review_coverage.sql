-- Operational review only; never tax completeness, source certification or filing readiness.
-- Preserve every old check as unverified history; do not rewrite its notes/status.
alter table public.quarterly_readiness_checks
 add column coverage_version text,
 add column source_stamp text,
 add column external_invoice_count integer,
 add column unresolved_source_count integer,
 add column checked_as_of date;

create function public.financial_review_catalog(p_owner uuid,p_year integer,p_as_of date) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_owner is null or p_year not between 2000 and 2100 or p_year is null or p_as_of is null or p_as_of not between make_date(p_year,4,6) and make_date(p_year+1,4,5) then raise exception 'Choose an explicit review year and date.';end if;
 with records as materialized (
  select f.id,f.record_type,f.record_date,f.amount,f.effect_sign,f.status,f.category_id,f.tax_quarter,f.updated_at from public.financial_records f where f.user_id=p_owner and f.tax_year_start=p_year
 ),sources as materialized (
  select t.id,t.transaction_date,t.classification,t.dedupe_status,t.decision_version,t.updated_at,i.status import_status,
   (t.dedupe_status='needs_review' or(t.dedupe_status<>'duplicate' and(t.classification='Unknown'
    or exists(select 1 from public.financial_records f where f.bank_transaction_id=t.id and f.user_id=t.user_id and f.status in('draft','review'))
    or(t.classification in('Business','Mixed') and t.business_use_bps>0 and abs(t.signed_amount_pence)*t.business_use_bps>=5000 and coalesce(e.approved_record_count,0)=0)))) unresolved
  from public.bank_transactions t join public.record_imports i on i.id=t.import_id and i.user_id=t.user_id
  left join public.bank_transaction_record_effects e on e.bank_transaction_id=t.id and e.user_id=t.user_id
  where t.user_id=p_owner and t.tax_year_start=p_year and i.status in('review','committed')
 ),invoices as materialized (
  select i.id,i.origin,i.currency,i.amount,i.original_total_minor,i.currency_ruleset_id,i.source_fact_revision_id,i.source_fact_family_id,i.due_date,i.delivery_status,i.paid_at,i.updated_at,
   case when i.origin='native_gbp' then (i.amount*100)::bigint else i.original_total_minor end original_minor,
   case when i.origin='native_gbp' then b.outstanding_pence end outstanding_pence,
   case when i.origin='native_gbp' then
    i.currency='GBP' and i.amount is not null and i.original_total_minor is null and i.currency_ruleset_id is null and i.source_fact_revision_id is null and i.source_fact_family_id is null
    and b.id is not null and b.currency='GBP' and b.invoice_pence=i.amount*100 and b.outstanding_pence>=0
   else i.origin='preserved_external' and i.amount is null and i.original_total_minor between 1 and 999999999999 and i.currency_ruleset_id='vibecount-currencies/1'
    and i.currency in('GBP','USD','EUR','JPY','KWD') and i.source_fact_revision_id is not null and i.source_fact_family_id is not null end valid
  from public.invoices i left join public.invoice_payment_balances b on b.id=i.id and b.user_id=i.user_id and i.origin='native_gbp'
  where i.user_id=p_owner and i.status='finalised'
 ),quarters as (
  select q,
   coalesce(sum(r.amount*100*r.effect_sign) filter(where r.status='approved' and r.record_type='income'),0)::bigint income,
   coalesce(sum(r.amount*100*r.effect_sign) filter(where r.status='approved' and r.record_type='expense'),0)::bigint expense,
   count(*) filter(where r.status='approved')::integer approved_count,
   count(*) filter(where r.status='approved' and r.category_id is null)::integer uncategorised_count,
   count(*) filter(where r.status in('draft','review'))::integer review_count,
   (select count(*)::integer from sources s where s.unresolved and s.transaction_date>=case q when 1 then make_date(p_year,4,6) when 2 then make_date(p_year,7,6) when 3 then make_date(p_year,10,6) else make_date(p_year+1,1,6) end
    and s.transaction_date<case q when 1 then make_date(p_year,7,6) when 2 then make_date(p_year,10,6) when 3 then make_date(p_year+1,1,6) else make_date(p_year+1,4,6) end) unresolved_sources
  from generate_series(1,4) q left join records r on r.tax_quarter=q group by q
 ),recent as (
  select id,record_type,record_date,(amount*100*effect_sign)::bigint amount_pence,(category_id is not null) categorised from records where status='approved' order by record_date desc,id limit 20
 ),overdue as (
  select id,due_date,original_minor,outstanding_pence,delivery_status,(paid_at is not null or delivery_status='paid') manual_paid_marker from invoices
  where origin='native_gbp' and due_date<p_as_of and outstanding_pence>0 order by due_date,id
 ),groups as (
  select currency,sum(original_minor)::bigint original_total_minor,count(*)::integer invoice_count from invoices group by currency
 )
 select jsonb_build_object('schema_version','vibecount.financial-review/1','owner_id',p_owner,'tax_year_start',p_year,'as_of',p_as_of,
  'stamp',encode(sha256(convert_to(jsonb_build_object('version','vibecount.financial-review/1','owner',p_owner,'year',p_year,'as_of',p_as_of,
   'records',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from records r),'sources',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from sources s),
   'invoices',(select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]') from invoices i))::text,'UTF8')),'hex'),
  'invalid_invoice_count',(select count(*) from invoices where valid is distinct from true),
  'approved_count',(select count(*) from records where status='approved'),'review_count',(select count(*) from records where status in('draft','review')),
  'uncategorised_count',(select count(*) from records where status in('approved','draft','review') and category_id is null),
  'source_count',(select count(*) from sources),'unresolved_source_count',(select count(*) from sources where unresolved),
  'external_invoice_count',(select count(*) from invoices where origin='preserved_external'),'native_overdue_count',(select count(*) from overdue),
  'quarters',(select jsonb_agg(jsonb_build_object('quarter',q,'income_pence',income::text,'expense_pence',expense::text,'net_pence',(income-expense)::text,'approved_count',approved_count,'uncategorised_count',uncategorised_count,'review_count',review_count,'unresolved_source_count',unresolved_sources) order by q) from quarters),
  'recent_records',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'record_type',record_type,'record_date',record_date,'amount_pence',amount_pence::text,'categorised',categorised) order by record_date desc,id),'[]') from recent),
  'overdue_invoices',(select coalesce(jsonb_agg(to_jsonb(o) order by due_date,id),'[]') from(select id,due_date,original_minor::text,outstanding_pence::text,delivery_status,manual_paid_marker from overdue order by due_date,id limit 10)o),
  'invoice_groups',(select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'original_total_minor',original_total_minor::text,'invoice_count',invoice_count) order by currency),'[]') from groups),
  'coverage','operational_ledger_and_invoice_review_only; source_and_tax_completeness_not_certified') into result;
 if (result->>'invalid_invoice_count')::integer<>0 then raise exception 'Complete invoice dimensions and native balances unavailable.';end if;
 return result-'invalid_invoice_count';
end;$$;
revoke all on function public.financial_review_catalog(uuid,integer,date) from public,anon,authenticated,service_role;

create function public.read_financial_review(p_year integer,p_as_of date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to review records.';end if;
 return public.financial_review_catalog(auth.uid(),p_year,p_as_of);
end;$$;
revoke all on function public.read_financial_review(integer,date) from public,anon,authenticated,service_role;
grant execute on function public.read_financial_review(integer,date) to authenticated;

create function public.capture_quarter_readiness(p_owner uuid,p_year integer,p_quarter integer,p_as_of date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare catalog jsonb;q jsonb;needs_attention boolean;note text;
begin
 if p_quarter is null or p_quarter not between 1 and 4 or p_owner is null or not exists(select 1 from auth.users where id=p_owner) then raise exception 'Invalid readiness scope.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||p_owner::text,0));
 catalog:=public.financial_review_catalog(p_owner,p_year,p_as_of);
 select value into q from jsonb_array_elements(catalog->'quarters') where (value->>'quarter')::integer=p_quarter;
 needs_attention:=(q->>'uncategorised_count')::integer>0 or(q->>'review_count')::integer>0 or(q->>'unresolved_source_count')::integer>0 or(catalog->>'external_invoice_count')::integer>0 or(catalog->>'native_overdue_count')::integer>0 or(q->>'approved_count')::integer=0;
 note:='Operational review only; not tax/source completeness. Native overdue: '||(catalog->>'native_overdue_count')||'; unsupported external invoice balances: '||(catalog->>'external_invoice_count')||'; unresolved quarter sources: '||(q->>'unresolved_source_count')||'; uncategorised approved: '||(q->>'uncategorised_count')||'; awaiting review: '||(q->>'review_count')||case when(q->>'approved_count')::integer=0 then '; no approved quarter activity' else '' end||'.';
 insert into public.quarterly_readiness_checks(user_id,tax_year_start,tax_quarter,checked_at,uncategorised_count,review_count,overdue_invoice_count,net_profit_pence,status,notes,coverage_version,source_stamp,external_invoice_count,unresolved_source_count,checked_as_of)
 values(p_owner,p_year,p_quarter,now(),(q->>'uncategorised_count')::integer,(q->>'review_count')::integer,(catalog->>'native_overdue_count')::integer,(q->>'net_pence')::bigint,case when needs_attention then 'needs_attention' else 'ok' end,note,'vibecount.financial-review/1',catalog->>'stamp',(catalog->>'external_invoice_count')::integer,(q->>'unresolved_source_count')::integer,p_as_of)
 on conflict(user_id,tax_year_start,tax_quarter) do update set checked_at=excluded.checked_at,uncategorised_count=excluded.uncategorised_count,review_count=excluded.review_count,overdue_invoice_count=excluded.overdue_invoice_count,net_profit_pence=excluded.net_profit_pence,status=excluded.status,notes=excluded.notes,coverage_version=excluded.coverage_version,source_stamp=excluded.source_stamp,external_invoice_count=excluded.external_invoice_count,unresolved_source_count=excluded.unresolved_source_count,checked_as_of=excluded.checked_as_of;
 return jsonb_build_object('owner_id',p_owner,'tax_year_start',p_year,'tax_quarter',p_quarter,'coverage_version','vibecount.financial-review/1','status',case when needs_attention then 'needs_attention' else 'ok' end);
end;$$;
revoke all on function public.capture_quarter_readiness(uuid,integer,integer,date) from public,anon,authenticated,service_role;
grant execute on function public.capture_quarter_readiness(uuid,integer,integer,date) to service_role;

-- Current tax/filing coverage is versioned separately from retained calculation/pack bytes.
-- Owner-wide invoice context is deliberately not assigned to a tax year by issue date.
create function public.invoice_currency_coverage_for_owner(p_owner uuid) returns jsonb
language sql stable security definer set search_path='' as $$
with invoices as materialized (
 select i.id,i.status,i.origin,i.currency,i.invoice_date,i.amount::text amount,
 i.original_total_minor::text original_total_minor,i.currency_ruleset_id,i.source_fact_revision_id,i.source_fact_family_id,
 b.id is not null native_balance_available,
 case when i.origin='native_gbp' and i.currency='GBP' and i.amount is not null
  and i.original_total_minor is null and i.currency_ruleset_id is null and i.source_fact_revision_id is null and i.source_fact_family_id is null and b.id is not null then 'native_gbp'
 when i.origin='preserved_external' and i.amount is null and i.original_total_minor between 1 and 999999999999
  and i.currency in ('GBP','USD','EUR','JPY','KWD') and i.currency_ruleset_id='vibecount-currencies/1'
  and i.source_fact_revision_id is not null and i.source_fact_family_id is not null then 'unsupported_external'
 else 'invalid' end representation
 from public.invoices i left join public.invoice_payment_balances b on b.id=i.id and b.user_id=i.user_id
 where i.user_id=p_owner and i.status='finalised'
),projection as (
 select jsonb_build_object('schema_version','vibecount.invoice-currency-coverage/1','scope','all_owned_finalised_invoices_not_tax_year_income','owner_id',p_owner,
 'invoice_count',(select count(*) from invoices),'native_invoice_count',(select count(*) from invoices where representation='native_gbp'),
 'unsupported_external_invoice_count',(select count(*) from invoices where representation='unsupported_external'),
 'invalid_invoice_count',(select count(*) from invoices where representation='invalid'),
 'draft_invoice_count',(select count(*) from public.invoices where user_id=p_owner and status='draft'),
 'invoices',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from invoices i),'[]'::jsonb)) value
)
select value||jsonb_build_object('stamp',encode(sha256(convert_to(value::text,'UTF8')),'hex')) from projection;
$$;
revoke all on function public.invoice_currency_coverage_for_owner(uuid) from public,anon,authenticated,service_role;

alter function public.tax_calculation_input_for_owner(uuid,integer) rename to tax_calculation_input_v1_for_owner;
create function public.tax_calculation_input_for_owner(p_owner uuid,p_year integer) returns jsonb
language sql stable security definer set search_path='' as $$
 select public.tax_calculation_input_v1_for_owner(p_owner,p_year)||jsonb_build_object(
 'schema_version','tax-calculation-input/2','invoice_coverage',public.invoice_currency_coverage_for_owner(p_owner));
$$;
revoke all on function public.tax_calculation_input_v1_for_owner(uuid,integer),public.tax_calculation_input_for_owner(uuid,integer) from public,anon,authenticated,service_role;

alter function public.tax_filing_pack_input_for_owner(uuid,uuid) rename to tax_filing_pack_input_v1_for_owner;
create function public.tax_filing_pack_input_for_owner(p_owner uuid,p_calculation uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select public.tax_filing_pack_input_v1_for_owner(p_owner,p_calculation)||jsonb_build_object(
 'schema_version','filing-pack-input/2','invoice_coverage',public.invoice_currency_coverage_for_owner(p_owner));
$$;
revoke all on function public.tax_filing_pack_input_v1_for_owner(uuid,uuid),public.tax_filing_pack_input_for_owner(uuid,uuid) from public,anon,authenticated,service_role;

-- Retained requests recover before current-schema, context or coverage checks.
create or replace function public.capture_tax_calculation(p_owner uuid,p_year integer,p_input text,p_result text,p_rules text,p_reason text,p_request uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare prior public.tax_calculations;input_data jsonb;output_data jsonb;rules_data jsonb;rule_id text;rules_hash text;existing public.tax_rulesets;captured uuid;
begin
 if p_owner is null or p_year is null or p_year not between 2000 and 2100 or p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 or p_input is null or p_result is null or p_rules is null then raise exception 'Review snapshot inputs.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||p_owner::text,0));
 select * into prior from public.tax_calculations where user_id=p_owner and request_id=p_request;
 if found then
  if prior.input_canonical_json<>p_input or prior.result_canonical_json<>p_result or prior.rationale<>btrim(p_reason) or not exists(select 1 from public.tax_rulesets r where r.id=prior.ruleset_id and r.canonical_json=p_rules) or prior.tax_year_start<>p_year then raise exception 'Calculation request used with different inputs.';end if;
  return prior.id;
 end if;
 -- Brief global read locks cover older direct writes and phantom inserts as well as owner RPCs.
 -- NOWAIT avoids lock-order deadlocks; fail/reload if any writer is currently active.
 lock table public.financial_accounts,public.financial_records,public.record_categories,public.bank_transactions,public.record_imports,public.invoices in share mode nowait;
 input_data:=p_input::jsonb;output_data:=p_result::jsonb;rules_data:=p_rules::jsonb;
 if input_data is distinct from public.tax_calculation_input_for_owner(p_owner,p_year) then raise exception 'Calculation inputs changed. Review again.';end if;
 if input_data->>'schema_version' is distinct from 'tax-calculation-input/2' then raise exception 'Review current versioned invoice coverage.';end if;
 if (input_data#>>'{invoice_coverage,unsupported_external_invoice_count}')::bigint>0 or (input_data#>>'{invoice_coverage,invalid_invoice_count}')::bigint>0 then
  if output_data->>'status' is distinct from 'incomplete' or exists(select 1 from jsonb_each(output_data->'totals') t where t.key in ('trade_profit','taxable_trade_profit','income_tax','class4','assessed_liability','net_balance','poa_each','january_combined') and t.value<>'null'::jsonb) then
   raise exception 'Unsupported invoice currency coverage cannot produce tax estimates or completeness.';
  end if;
 end if;
 rule_id:=rules_data->>'id';rules_hash:=encode(sha256(convert_to(p_rules,'UTF8')),'hex');
 if rule_id is null or rules_data->>'engine_version' is null or (rules_data->>'tax_year_start')::integer is distinct from p_year
 or output_data->>'ruleset_id' is distinct from rule_id or output_data->>'engine_version' is distinct from rules_data->>'engine_version' or (output_data->>'tax_year_start')::integer is distinct from p_year
 or output_data->>'document_status' is distinct from 'Draft — not submitted to HMRC' or output_data->>'status' is null or output_data->>'status' not in ('incomplete','estimate') then raise exception 'Unsupported draft calculation or rules version.';end if;
 insert into public.tax_rulesets(id,engine_version,tax_year_start,rules,canonical_json,sha256) values(rule_id,rules_data->>'engine_version',p_year,rules_data,p_rules,rules_hash) on conflict(id) do nothing;
 select * into existing from public.tax_rulesets where id=rule_id;
 if existing.sha256<>rules_hash or existing.canonical_json<>p_rules then raise exception 'Rules version already has different immutable content.';end if;
 insert into public.tax_calculations(user_id,tax_year_start,ruleset_id,engine_version,input,result,input_canonical_json,result_canonical_json,input_sha256,result_sha256,rationale,author,request_id)
 values(p_owner,p_year,rule_id,rules_data->>'engine_version',input_data,output_data,p_input,p_result,encode(sha256(convert_to(p_input,'UTF8')),'hex'),encode(sha256(convert_to(p_result,'UTF8')),'hex'),btrim(p_reason),p_owner,p_request) returning id into captured;
 return captured;
end;$$;
revoke all on function public.capture_tax_calculation(uuid,integer,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.capture_tax_calculation(uuid,integer,text,text,text,text,uuid) to service_role;

create or replace function public.capture_filing_pack(p_owner uuid,p_calculation uuid,p_input text,p_bundle text,p_reason text,p_request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare prior public.filing_packs;input_data jsonb;output jsonb;review jsonb;artifact jsonb;saved uuid;mapping_text text;
begin
 if p_owner is null or p_calculation is null or p_input is null or p_bundle is null or p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Review draft pack inputs and reason.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||p_owner::text,0));
 select * into prior from public.filing_packs where user_id=p_owner and request_id=p_request;
 if found then if prior.calculation_id<>p_calculation or prior.input_canonical_json<>p_input or prior.bundle_canonical_json<>p_bundle or prior.reason<>btrim(p_reason) then raise exception 'Pack request has different inputs.';end if;return prior.id;end if;
 perform public.freeze_tax_pack_inputs();input_data:=p_input::jsonb;output:=p_bundle::jsonb;
 if input_data is distinct from public.tax_filing_pack_input_for_owner(p_owner,p_calculation) or input_data->>'owner_id' is distinct from p_owner::text or input_data->>'calculation_is_current' is distinct from 'true' then raise exception 'Pack inputs changed. Save a current calculation and review again.';end if;
 if output->>'schema_version' is distinct from 'draft-filing-pack/3' or output->>'document_status' is distinct from 'Draft — not submitted to HMRC' or output->>'input_sha256' is distinct from encode(sha256(convert_to(p_input,'UTF8')),'hex') or output->>'review_status' is null or output->>'review_status' not in ('draft_incomplete','draft_reviewed') or output->>'mapping_version' is null or jsonb_typeof(output->'artifacts') is distinct from 'array' or jsonb_array_length(output->'artifacts')<>7 or jsonb_typeof(output->'reviews') is distinct from 'array' then raise exception 'Review all seven draft outputs and versions.';end if;
 if input_data->>'schema_version' is distinct from 'filing-pack-input/2' then raise exception 'Review current versioned invoice coverage.';end if;
 if ((input_data#>>'{invoice_coverage,unsupported_external_invoice_count}')::bigint>0 or (input_data#>>'{invoice_coverage,invalid_invoice_count}')::bigint>0)
 and (output->>'review_status'='draft_reviewed' or output->>'completeness_attested'='true') then raise exception 'Unsupported invoice currency coverage prevents completeness attestation.';end if;
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


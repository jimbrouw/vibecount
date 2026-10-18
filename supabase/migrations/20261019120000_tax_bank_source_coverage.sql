-- Preserve retained inputs/requests; require complete current bank source coverage on fresh captures.
do $$declare definition text;copied text;begin
 select pg_get_functiondef('public.tax_calculation_input_for_owner(uuid,integer)'::regprocedure) into definition;
 copied:=replace(definition,'FUNCTION public.tax_calculation_input_for_owner(','FUNCTION public.tax_calculation_input_v2_for_owner(');
 if copied=definition or position('tax-calculation-input/2' in definition)=0 then raise exception 'Inspect tax input V2 predecessor.';end if;execute copied;
 select pg_get_functiondef('public.tax_filing_pack_input_for_owner(uuid,uuid)'::regprocedure) into definition;
 copied:=replace(definition,'FUNCTION public.tax_filing_pack_input_for_owner(','FUNCTION public.tax_filing_pack_input_v3_for_owner(');
 if copied=definition or position('filing-pack-input/3' in definition)=0 then raise exception 'Inspect filing input V3 predecessor.';end if;execute copied;
end;$$;
revoke all on function public.tax_calculation_input_v2_for_owner(uuid,integer),public.tax_filing_pack_input_v3_for_owner(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.tax_calculation_input_for_owner(p_owner uuid,p_year integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 result:=public.tax_calculation_input_v2_for_owner(p_owner,p_year)||jsonb_build_object('schema_version','tax-calculation-input/3','bank_source_coverage',public.bank_source_coverage_for_owner(p_owner));
 if octet_length(result::text)>4000000 then raise exception 'Complete tax input exceeds direct review capacity.';end if;return result;
end;$$;
create or replace function public.tax_filing_pack_input_for_owner(p_owner uuid,p_calculation uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base jsonb;bank jsonb;result jsonb;begin
 base:=public.tax_filing_pack_input_v3_for_owner(p_owner,p_calculation);
 bank:=public.bank_source_coverage_for_owner(p_owner);
 if exists(select 1 from jsonb_array_elements(base->'observations') o where not exists(select 1 from jsonb_array_elements(bank->'observations') b where b->>'id'=o->>'id')) then raise exception 'Complete connected bank source coverage unavailable.';end if;
 result:=base||jsonb_build_object('schema_version','filing-pack-input/4','bank_source_coverage',bank,
  'observations',coalesce((select jsonb_agg(o||jsonb_build_object('import_status',b->'import_status','original_signed_minor',b->'original_signed_minor','source_units_ruleset',b->'ruleset_id') order by o->>'id') from jsonb_array_elements(base->'observations') o join jsonb_array_elements(bank->'observations') b on b->>'id'=o->>'id'),'[]'::jsonb),
  'calculation_is_current',base->'calculation'->'input'=public.tax_calculation_input_for_owner(p_owner,(base->>'tax_year_start')::integer));
 if octet_length(result::text)>4000000 then raise exception 'Complete filing input exceeds direct review capacity.';end if;return result;
end;$$;

-- Same cash-year + explicit connected-source scope as deterministic TypeScript.
create function public.tax_bank_sources_blocked(p_input jsonb) returns boolean language sql immutable set search_path='' as $$
 with connected as(
  select r->>'bank_transaction_id' id from jsonb_array_elements(p_input->'records') r
  union select r->>'original_bank_transaction_id' from jsonb_array_elements(p_input->'records') r
  union select r->>'transaction_id' from jsonb_array_elements(p_input->'sources') r
  union select r->'snapshot'->>'bank_transaction_id' from jsonb_array_elements(p_input->'sources') r
  union select r->'snapshot'->>'original_bank_transaction_id' from jsonb_array_elements(p_input->'sources') r
  union select r->>'id' from jsonb_array_elements(p_input->'observations') r where r->>'import_status' is distinct from 'discarded' or r->>'in_tax_year'='false'
 ),sources as(select r from jsonb_array_elements(p_input->'bank_source_coverage'->'observations') r)
 select exists(select 1 from connected c where c.id is not null and not exists(select 1 from sources s where s.r->>'id'=c.id))
 or exists(select 1 from sources s where((s.r->>'tax_year_start')::integer=(p_input->>'tax_year_start')::integer or s.r->>'id' in(select id from connected where id is not null))
  and(s.r->>'import_status' is distinct from 'discarded' or s.r->>'id' in(select id from connected where id is not null))
  and(s.r->>'representation' is distinct from 'native_gbp' or s.r->>'source_complete' is distinct from 'true' or s.r->>'source_available' is distinct from 'true' or s.r->>'import_status'='discarded'));
$$;
revoke all on function public.tax_bank_sources_blocked(jsonb) from public,anon,authenticated,service_role;

create function public.freeze_tax_calculation_inputs() returns void language plpgsql set search_path='' as $$begin
 perform public.freeze_financial_review_inputs();
 lock table public.record_categories,public.classification_decisions,public.source_import_events,public.financial_record_changes,public.record_attachments,
 public.duplicate_decisions,public.duplicate_reversals,public.merchant_rules,public.merchant_rule_versions,public.merchant_review_batches,public.merchant_review_items,public.merchant_review_evidence,public.merchant_review_reversals,public.merchant_review_undo_items,
 public.tax_profiles,public.tax_profile_revisions,public.tax_fact_families,public.tax_fact_revisions,public.tax_fact_sources,public.tax_section_attestations,public.tax_calculation_scopes,
 public.invoice_revisions,public.fx_conversion_lots,public.fx_document_fact_families,public.fx_document_fact_revisions in share mode nowait;
end;$$;
revoke all on function public.freeze_tax_calculation_inputs() from public,anon,authenticated,service_role;
create or replace function public.freeze_tax_pack_inputs() returns void language plpgsql set search_path='' as $$begin
 perform public.freeze_tax_calculation_inputs();
end;$$;

do $$declare definition text;changed text;needle text;begin
 select pg_get_functiondef('public.capture_tax_calculation(uuid,integer,text,text,text,text,uuid)'::regprocedure) into definition;
 needle:='lock table public.financial_accounts,public.financial_records,public.record_categories,public.bank_transactions,public.record_imports,public.invoices in share mode nowait;';
 changed:=replace(definition,needle,'if octet_length(p_input)>4000000 or octet_length(p_result)>4000000 or octet_length(p_rules)>4000000 then raise exception ''Complete tax capture exceeds safe capacity.'';end if; perform public.freeze_tax_calculation_inputs();');
 if changed=definition or position('tax-calculation-input/2' in changed)=0 then raise exception 'Inspect retry-first tax capture predecessor.';end if;
 changed:=replace(changed,'tax-calculation-input/2','tax-calculation-input/3');
 needle:='rule_id:=rules_data->>''id'';';
 if position(needle in changed)=0 then raise exception 'Inspect tax capture withholding boundary.';end if;
 changed:=replace(changed,needle,'if public.tax_bank_sources_blocked(input_data) and(output_data->>''status'' is distinct from ''incomplete'' or exists(select 1 from unnest(array[''trade_profit'',''taxable_trade_profit'',''income_tax'',''class4'',''assessed_liability'',''net_balance'',''poa_each'',''january_combined'']) k where(output_data#>array[''totals'',k]) is distinct from ''null''::jsonb)) then raise exception ''Bank source coverage cannot support tax estimates.'';end if; '||needle);
 execute changed;
 select pg_get_functiondef('public.capture_filing_pack(uuid,uuid,text,text,text,uuid)'::regprocedure) into definition;
 if position('draft-filing-pack/4' in definition)=0 or position('filing-pack-input/3' in definition)=0 then raise exception 'Inspect filing capture predecessor.';end if;
 changed:=replace(replace(definition,'draft-filing-pack/4','draft-filing-pack/5'),'filing-pack-input/3','filing-pack-input/4');
 needle:='perform public.freeze_tax_pack_inputs();';
 changed:=replace(changed,needle,needle||' lock table public.filing_pack_step_reviews in share mode nowait;');
 needle:='for review in select * from jsonb_array_elements(output->''reviews'') loop';
 if position(needle in changed)=0 then raise exception 'Inspect filing completeness boundary.';end if;
 changed:=replace(changed,needle,'if public.tax_bank_sources_blocked((input_data->''calculation''->''input'')||jsonb_build_object(''observations'',input_data->''observations'')) and(output->>''review_status''=''draft_reviewed'' or output->>''completeness_attested''=''true'') then raise exception ''Bank source coverage prevents completeness attestation.'';end if; '||needle);
 execute changed;
 -- Step review receives the full new input/digest but still recovers old exact requests first.
 select pg_get_functiondef('public.review_filing_pack_step(uuid,uuid,text,text,text,jsonb,text,uuid)'::regprocedure) into definition;
 needle:='perform public.freeze_tax_pack_inputs();';
 changed:=replace(definition,needle,'if octet_length(p_input)>4000000 then raise exception ''Complete filing review exceeds safe capacity.'';end if; '||needle);
 if changed=definition then raise exception 'Inspect retry-first filing review.';end if;execute changed;
end;$$;

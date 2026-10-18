-- Activate accounting-aware tax/filing inputs without rewriting retained snapshots.
-- Captures still compare supplied inputs with the complete owned database projection.
do $$declare definition text;begin
 select pg_get_functiondef('public.tax_bank_sources_blocked(jsonb)'::regprocedure) into definition;
 if position('bank_source_coverage' in definition)=0 then raise exception 'Inspect bank blocker predecessor.';end if;
 execute replace(definition,'FUNCTION public.tax_bank_sources_blocked(','FUNCTION public.tax_bank_sources_blocked_v1(');
 select pg_get_functiondef('public.tax_filing_pack_input_for_owner(uuid,uuid)'::regprocedure) into definition;
 if position('filing-pack-input/4' in definition)=0 then raise exception 'Inspect filing input predecessor.';end if;
 execute replace(definition,'FUNCTION public.tax_filing_pack_input_for_owner(','FUNCTION public.tax_filing_pack_input_v4_for_owner(');
end;$$;
revoke all on function public.tax_bank_sources_blocked_v1(jsonb),public.tax_filing_pack_input_v4_for_owner(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.tax_calculation_input_for_owner(p_owner uuid,p_year integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 result:=public.tax_calculation_input_v2_for_owner(p_owner,p_year)||jsonb_build_object('schema_version','tax-calculation-input/4','bank_source_coverage',public.bank_accounting_coverage_for_owner(p_owner));
 if octet_length(result::text)>4000000 then raise exception 'Complete tax input exceeds direct review capacity.';end if;return result;
end;$$;
create or replace function public.tax_filing_pack_input_for_owner(p_owner uuid,p_calculation uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 result:=public.tax_filing_pack_input_v4_for_owner(p_owner,p_calculation)||jsonb_build_object('schema_version','filing-pack-input/5','bank_source_coverage',public.bank_accounting_coverage_for_owner(p_owner));
 if octet_length(result::text)>4000000 then raise exception 'Complete filing input exceeds direct review capacity.';end if;return result;
end;$$;

-- Independent withholding gate over authoritative, frozen capture inputs. Full immutable
-- ancestry and exact GBP arithmetic are checked by the deterministic snapshot verifier.
create or replace function public.tax_bank_sources_blocked(p_input jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare blocked boolean;begin
 if p_input->>'schema_version' is distinct from 'tax-calculation-input/4' then return public.tax_bank_sources_blocked_v1(p_input);end if;
 if p_input#>>'{bank_source_coverage,schema_version}' is distinct from 'vibecount.bank-source-coverage/2' then return true;end if;
 with connected as(
  select r->>'bank_transaction_id' id from jsonb_array_elements(p_input->'records') r where r->>'status' is distinct from 'excluded'
  union select r->>'original_bank_transaction_id' from jsonb_array_elements(p_input->'records') r where r->>'status' is distinct from 'excluded'
  union select r->>'transaction_id' from jsonb_array_elements(p_input->'sources') r
  union select r->'snapshot'->>'bank_transaction_id' from jsonb_array_elements(p_input->'sources') r
  union select r->'snapshot'->>'original_bank_transaction_id' from jsonb_array_elements(p_input->'sources') r
  union select r->>'id' from jsonb_array_elements(p_input->'observations') r where r->>'import_status' is distinct from 'discarded' or r->>'in_tax_year'='false'
 ),sources as(select r from jsonb_array_elements(p_input#>'{bank_source_coverage,source_coverage,observations}') r),
 eligible as(select s.r->>'id' id from sources s where s.r->>'source_complete'='true' and s.r->>'source_available'='true' and s.r->>'import_status'<>'discarded' and(
  s.r->>'representation'='native_gbp' or(s.r->>'representation'='foreign' and s.r->>'dedupe_status'='clear'
   and not exists(select 1 from jsonb_array_elements_text(p_input#>'{bank_source_coverage,blocked_transaction_ids}') b where b=s.r->>'id')
   and exists(select 1 from jsonb_array_elements(p_input#>'{bank_source_coverage,classification_decisions}') d
    where d->>'transaction_id'=s.r->>'id' and d->>'version'=s.r->>'decision_version' and d->>'classification'=s.r->>'classification'
     and d->'request'->>'transaction_id'=s.r->>'id' and d->'request'->>'version'=s.r->>'decision_version'
     and(d->>'classification'='Personal' or(d->>'classification' in('Business','Mixed') and s.r#>>'{valuation,source_current}'='true' and s.r#>>'{valuation,state}'='reviewed' and d->>'bank_valuation_revision_id'=s.r#>>'{valuation,id}')))))
 )
 select exists(select 1 from connected c where c.id is not null and not exists(select 1 from sources s where s.r->>'id'=c.id))
 or exists(select 1 from sources s where((s.r->>'tax_year_start')::integer=(p_input->>'tax_year_start')::integer or s.r->>'id' in(select id from connected where id is not null))
  and(s.r->>'import_status' is distinct from 'discarded' or s.r->>'id' in(select id from connected where id is not null))
  and not exists(select 1 from eligible e where e.id=s.r->>'id')) into blocked;
 return blocked;
end;$$;

do $$declare definition text;changed text;begin
 select pg_get_functiondef('public.freeze_tax_calculation_inputs()'::regprocedure) into definition;
 changed:=replace(definition,'public.classification_decisions,','public.classification_decisions,public.foreign_classification_requests,');
 if changed=definition then raise exception 'Inspect tax freeze predecessor.';end if;execute changed;
 select pg_get_functiondef('public.capture_tax_calculation(uuid,integer,text,text,text,text,uuid)'::regprocedure) into definition;
 if position('tax-calculation-input/3' in definition)=0 then raise exception 'Inspect tax capture predecessor.';end if;
 execute replace(definition,'tax-calculation-input/3','tax-calculation-input/4');
 select pg_get_functiondef('public.capture_filing_pack(uuid,uuid,text,text,text,uuid)'::regprocedure) into definition;
 if position('filing-pack-input/4' in definition)=0 or position('draft-filing-pack/5' in definition)=0 then raise exception 'Inspect filing capture predecessor.';end if;
 execute replace(replace(definition,'filing-pack-input/4','filing-pack-input/5'),'draft-filing-pack/5','draft-filing-pack/6');
end;$$;

-- Versioned invoice coverage around the unchanged manual GBP scenario engine.
-- Retained input/result/rules bytes and completed request recovery stay unchanged.
do $$declare name text;begin
 select c.conname into strict name from pg_constraint c where c.conrelid='public.finance_plan_revisions'::regclass and c.contype='c' and pg_get_constraintdef(c.oid) like '%finance-plan-input/1%';
 execute format('alter table public.finance_plan_revisions drop constraint %I',name);
end;$$;
alter table public.finance_plan_revisions add constraint finance_plan_input_version check(input->>'schema_version' in ('finance-plan-input/1','finance-plan-input/2'));

alter function public.finance_plan_context_for_owner(uuid) rename to finance_plan_context_v1_for_owner;
create function public.finance_plan_context_for_owner(p_owner uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with base as materialized(select public.finance_plan_context_v1_for_owner(p_owner) value),
 coverage as materialized(select public.invoice_currency_coverage_for_owner(p_owner) value)
 select jsonb_build_object('schema_version','finance-plan-context/2','owner_id',p_owner,'ordinal',base.value->'ordinal','invoice_coverage',coverage.value,
 'stamp',md5(jsonb_build_object('schema_version','finance-plan-context/2','source_stamp',base.value->>'stamp','invoice_coverage',coverage.value)::text)) from base,coverage;
$$;
revoke all on function public.finance_plan_context_v1_for_owner(uuid),public.finance_plan_context_for_owner(uuid) from public,anon,authenticated,service_role;

create or replace function public.capture_finance_plan(p_owner uuid,p_expected integer,p_stamp text,p_input text,p_result text,p_rules text,p_reason text,p_request uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare prior public.finance_plan_revisions;ctx jsonb;i jsonb;r jsonb;rules jsonb;a jsonb;account public.financial_accounts;doc public.evidence_documents;
 scenario jsonb;coverage_blocked boolean;eligible boolean;
 account_sources jsonb:='[]'::jsonb;doc_sources jsonb:='[]'::jsonb;actual_sources jsonb;rules_hash text;captured uuid;
begin
 if p_owner is null or p_request is null or p_expected is null or p_expected<0 or p_stamp is null or p_stamp!~'^[a-f0-9]{32}$'
 or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 or p_input is null or p_result is null or p_rules is null
 or octet_length(p_input)>1000000 or octet_length(p_result)>1000000 or octet_length(p_rules)>100000 then raise exception 'Review finance plan capture.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||p_owner::text,0));
 select * into prior from public.finance_plan_revisions where user_id=p_owner and request_id=p_request;
 if found then
  if prior.expected_ordinal<>p_expected or prior.context_stamp<>p_stamp or prior.input_canonical_json<>p_input or prior.result_canonical_json<>p_result or prior.rules_canonical_json<>p_rules or prior.rationale<>btrim(p_reason) then raise exception 'Finance request used with different inputs.';end if;
  return prior.id;
 end if;
 lock table public.financial_accounts,public.evidence_documents,public.invoices in share mode nowait;
 ctx:=public.finance_plan_context_for_owner(p_owner);
 if (ctx->>'ordinal')::integer<>p_expected or ctx->>'stamp'<>p_stamp then raise exception 'Cash plan or sources changed. Review again.';end if;
 i:=p_input::jsonb;r:=p_result::jsonb;rules:=p_rules::jsonb;
 if jsonb_typeof(i) is distinct from 'object' or (select count(*) from jsonb_object_keys(i))<>6 or not(i ?& array['schema_version','owner_id','evaluated_on','plan','sources','invoice_coverage'])
 or i->>'schema_version' is distinct from 'finance-plan-input/2' or i->>'owner_id' is distinct from p_owner::text
 or i->>'evaluated_on' is distinct from ((now() at time zone 'Europe/London')::date)::text
 then raise exception 'Review current owner/date and complete plan envelope.';end if;
 if ctx->>'schema_version' is distinct from 'finance-plan-context/2' or i->'invoice_coverage' is distinct from ctx->'invoice_coverage' then raise exception 'Current invoice coverage changed or is missing.';end if;
 perform public.validate_finance_plan_json(i->'plan');
 if jsonb_typeof(r) is distinct from 'object' or (select count(*) from jsonb_object_keys(r))<>11
 or not(r ?& array['schema_version','engine_version','scope','caveat','evaluated_on','status','invoice_coverage_stamp','issues','current_free_cash_pence','additional_drawings_ceiling_pence','scenario'])
 or r->>'schema_version' is distinct from 'finance-plan-result/2' or r->>'engine_version' is distinct from 'vibecount-finance-review/2'
 or r->>'scope' is distinct from 'manual_gbp_scenario_not_ledger_or_fx_valuation'
 or r->>'invoice_coverage_stamp' is distinct from ctx#>>'{invoice_coverage,stamp}'
 or jsonb_typeof(r->'issues') is distinct from 'array' or jsonb_typeof(r->'scenario') is distinct from 'object'
 then raise exception 'Review current versioned finance result and coverage.';end if;
 scenario:=r->'scenario';
 coverage_blocked:=(ctx#>>'{invoice_coverage,unsupported_external_invoice_count}')::bigint>0 or (ctx#>>'{invoice_coverage,invalid_invoice_count}')::bigint>0;
 eligible:=not coverage_blocked and scenario->>'status'='estimate';
 if r->>'status' is distinct from (case when eligible then 'estimate' else 'incomplete' end)
 or r->'current_free_cash_pence' is distinct from (case when eligible then scenario->'current_free_cash_pence' else 'null'::jsonb end)
 or r->'additional_drawings_ceiling_pence' is distinct from (case when eligible then scenario->'additional_drawings_ceiling_pence' else 'null'::jsonb end)
 then raise exception 'Unresolved finance coverage or scenario cannot authorize conditional drawings.';end if;

 if rules->>'id' is distinct from 'uk-cash-planning-2026-27/1' or rules->>'engine_version' is distinct from 'vibecount-planning/1'
 or scenario->>'engine_version' is distinct from rules->>'engine_version' or scenario#>>'{forecast,ruleset_id}' is distinct from rules->>'id'
 or coalesce(scenario->>'status' not in ('estimate','incomplete'),true) or scenario->>'evaluated_on' is distinct from i->>'evaluated_on' or r->>'evaluated_on' is distinct from i->>'evaluated_on'
 then raise exception 'Unsupported draft finance result or rules.';end if;
 for a in select value from jsonb_array_elements(i#>'{plan,assets}') loop
  if a->>'account_id' is not null then
   select * into account from public.financial_accounts where id=(a->>'account_id')::uuid and user_id=p_owner;
   if not found or account.currency<>'GBP' or not ((a->>'kind'='cash' and account.account_type='bank') or (a->>'kind'='liability' and account.account_type='credit_card')) then raise exception 'Planning account not owned or incompatible.';end if;
   account_sources:=account_sources||jsonb_build_array(jsonb_build_object('id',account.id,'user_id',account.user_id,'provider',account.provider,'account_type',account.account_type,'currency',account.currency,'label',public.tax_pack_safe_text(account.label),'masked_identifier',account.masked_identifier));
  end if;
  if a->>'document_id' is not null then
   select * into doc from public.evidence_documents where id=(a->>'document_id')::uuid and user_id=p_owner and media_type in ('application/pdf','image/png','image/jpeg');
   if not found then raise exception 'Planning evidence not owned.';end if;
   doc_sources:=doc_sources||jsonb_build_array(jsonb_build_object('id',doc.id,'user_id',doc.user_id,'file_sha256',doc.file_hash,'media_type',doc.media_type,'size_bytes',doc.size_bytes));
  end if;
 end loop;
 actual_sources:=jsonb_build_object('accounts',coalesce((select jsonb_agg(v order by v->>'id') from (select distinct value v from jsonb_array_elements(account_sources)) s),'[]'::jsonb),
 'documents',coalesce((select jsonb_agg(v order by v->>'id') from (select distinct value v from jsonb_array_elements(doc_sources)) s),'[]'::jsonb));
 if i->'sources' is distinct from actual_sources then raise exception 'Planning sources changed or contain unsafe fields.';end if;
 rules_hash:=encode(sha256(convert_to(p_rules,'UTF8')),'hex');
 insert into public.finance_plan_rulesets(id,canonical_json,sha256) values(rules->>'id',p_rules,rules_hash) on conflict(id) do nothing;
 if not exists(select 1 from public.finance_plan_rulesets s where s.id=rules->>'id' and s.canonical_json=p_rules and s.sha256=rules_hash) then raise exception 'Planning rules version changed.';end if;
 insert into public.finance_plan_revisions(user_id,ordinal,expected_ordinal,context_stamp,request_id,ruleset_id,input,result,input_canonical_json,result_canonical_json,rules_canonical_json,input_sha256,result_sha256,rules_sha256,rationale,author)
 values(p_owner,p_expected+1,p_expected,p_stamp,p_request,rules->>'id',i,r,p_input,p_result,p_rules,encode(sha256(convert_to(p_input,'UTF8')),'hex'),encode(sha256(convert_to(p_result,'UTF8')),'hex'),rules_hash,btrim(p_reason),p_owner) returning id into captured;
 return captured;
end;$$;
revoke all on function public.capture_finance_plan(uuid,integer,text,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.capture_finance_plan(uuid,integer,text,text,text,text,text,uuid) to service_role;

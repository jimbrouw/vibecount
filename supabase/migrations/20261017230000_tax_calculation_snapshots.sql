-- Draft calculations preserve inputs and rules; never approve/post financial effects.
create table public.tax_calculation_scopes (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 tax_year_start integer not null check(tax_year_start between 2000 and 2100), ordinal integer not null check(ordinal>0),
 state text not null check(state in ('provisional','reviewed')), schema_version text not null default 'tax-scope/1' check(schema_version='tax-scope/1'),
 input_stamp text not null, data jsonb not null, evidence_document_id uuid, document_snapshot jsonb, rationale text not null,
 author uuid not null references auth.users(id), request_id uuid not null, created_at timestamptz not null default now(),
 unique(user_id,tax_year_start,ordinal), foreign key(evidence_document_id,user_id) references public.evidence_documents(id,user_id),
 foreign key(user_id,request_id) references public.tax_review_requests(user_id,request_id) deferrable initially deferred
);
create table public.tax_rulesets (
 id text primary key, engine_version text not null, tax_year_start integer not null check(tax_year_start between 2000 and 2100),
 rules jsonb not null, canonical_json text not null, sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default now(),
 check(canonical_json::jsonb=rules),check(encode(sha256(convert_to(canonical_json,'UTF8')),'hex')=sha256)
);
create table public.tax_calculations (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), tax_year_start integer not null check(tax_year_start between 2000 and 2100),
 ruleset_id text not null references public.tax_rulesets(id), engine_version text not null,
 input jsonb not null, result jsonb not null, input_canonical_json text not null, result_canonical_json text not null,
 input_sha256 text not null check(input_sha256 ~ '^[a-f0-9]{64}$'),result_sha256 text not null check(result_sha256 ~ '^[a-f0-9]{64}$'),
 rationale text not null check(length(btrim(rationale)) between 1 and 1000),author uuid not null references auth.users(id),
 request_id uuid not null, created_at timestamptz not null default now(),unique(user_id,request_id),unique(id,user_id),
 check(input_canonical_json::jsonb=input), check(result_canonical_json::jsonb=result),
 check(encode(sha256(convert_to(input_canonical_json,'UTF8')),'hex')=input_sha256),
 check(encode(sha256(convert_to(result_canonical_json,'UTF8')),'hex')=result_sha256),
 check(result->>'document_status'='Draft — not submitted to HMRC'),check(result->>'status' in ('incomplete','estimate'))
);
create index tax_calculation_history on public.tax_calculations(user_id,tax_year_start,created_at desc,id);
alter table public.record_exports add column tax_calculation_id uuid,
 add foreign key(tax_calculation_id,user_id) references public.tax_calculations(id,user_id);
do $$ declare relation text;begin
 foreach relation in array array['tax_calculation_scopes','tax_calculations'] loop
  execute format('alter table public.%I enable row level security',relation);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',relation);
  execute format('grant select on public.%I to authenticated,service_role',relation);
  execute format('create policy tax_calculation_owner_read on public.%I for select to authenticated using(user_id=(select auth.uid()))',relation);
  execute format('create trigger immutable_tax_calculation before update or delete on public.%I for each row execute function public.reject_source_mutation()',relation);
 end loop;
end;$$;
alter table public.tax_rulesets enable row level security;
revoke all on public.tax_rulesets from public,anon,authenticated,service_role;
grant select on public.tax_rulesets to authenticated,service_role;
create policy reviewed_rules_read on public.tax_rulesets for select to authenticated using(true);
create trigger immutable_tax_rules before update or delete on public.tax_rulesets for each row execute function public.reject_source_mutation();

create function public.validate_tax_calculation_scope(p_data jsonb,p_state text) returns void language plpgsql set search_path='' as $$
declare schema jsonb:='{"class4_status":["unknown","not_exempt","exempt"],"class2_election":["unknown","no_voluntary_charge","verified_amount"],"pension_scope":["unknown","none","eligible_registered_under75_no_unmodelled_charge","requires_review"],"net_pay_scope":["unknown","not_applicable","already_reflected_in_taxable_pay"],"employment_scope":["unknown","none","distinct_employments_cumulative_totals_checked"],"termination_scope":["unknown","none","separate_taxable_pay_and_withholding_checked"],"payments_scope":["unknown","none","distinct_identified_allocations_checked"],"vehicle_scope":["unknown","none","all_costs_method_history_and_capital_checked"],"trade_treatment":["unknown","reviewed_no_unmodelled_adjustments","requires_review"],"ni_adjustments":["unknown","none","requires_review"],"gift_aid_scope":["unknown","none","eligibility_and_tax_cover_checked"],"assessment_adjustments":["unknown","none","requires_review"],"cash_dates":["unknown","bank_posting_dates_reviewed","requires_review"]}';k text;v jsonb;n jsonb;
begin
 if p_state is null or p_state not in ('provisional','reviewed') or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Review calculation scope.';end if;
 if (select count(*) from jsonb_object_keys(p_data))<>14 then raise exception 'Review every scope answer.';end if;
 for k,v in select * from jsonb_each(schema) loop
  if jsonb_typeof(p_data->k) is distinct from 'string' or not v?(p_data->>k) or (p_state='reviewed' and p_data->>k='unknown') then raise exception 'Review scope answer: %',k;end if;
 end loop;
 n:=p_data->'class2_amount_pence';
 if n is null or (n<>'null'::jsonb and (jsonb_typeof(n)<>'number' or n::text !~ '^[0-9]+$' or n::numeric>999999999999)) then raise exception 'Review exact voluntary Class 2 amount.';end if;
 if (p_state='reviewed' and p_data->>'class2_election'='verified_amount' and n='null'::jsonb) or (p_data->>'class2_election'='no_voluntary_charge' and n is distinct from '0'::jsonb) then raise exception 'Review explicit Class 2 amount.';end if;
end;$$;
revoke all on function public.validate_tax_calculation_scope(jsonb,text) from public,anon,authenticated,service_role;

create function public.review_tax_calculation_scope(p_year integer,p_expected integer,p_data jsonb,p_state text,p_document uuid,p_stamp text,p_reason text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();prior public.tax_review_requests;payload text;ordinal integer;revision uuid;doc jsonb;result jsonb;
begin
 if owner_id is null then raise exception 'Sign in to review calculation scope.';end if;
 if p_year is null or p_year not between 2000 and 2100 or p_expected is null or p_expected<0 or p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Review year, version and reason.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 payload:=md5(jsonb_build_object('action','calculation_scope','year',p_year,'expected',p_expected,'data',p_data,'state',p_state,'document',p_document,'stamp',p_stamp,'reason',btrim(p_reason))::text);
 select * into prior from public.tax_review_requests where user_id=owner_id and request_id=p_request;
 if found then if prior.payload_hash<>payload then raise exception 'Review request was used with different inputs.';end if;return prior.result;end if;
 perform public.validate_tax_calculation_scope(p_data,p_state);
 select coalesce(max(s.ordinal),0)+1 into ordinal from public.tax_calculation_scopes s where s.user_id=owner_id and s.tax_year_start=p_year;
 if ordinal<>p_expected+1 or public.tax_review_stamp(p_year) is distinct from p_stamp then raise exception 'Tax inputs changed. Review scope again.';end if;
 if p_document is not null then
  select jsonb_build_object('id',d.id,'file_sha256',d.file_hash,'media_type',d.media_type,'size_bytes',d.size_bytes) into doc from public.evidence_documents d where d.user_id=owner_id and d.id=p_document;
  if doc is null then raise exception 'Choose owned evidence.';end if;
 end if;
 if p_state='reviewed' and p_data->>'class2_election'='verified_amount' and (p_data->>'class2_amount_pence')::bigint>0 and doc is null then raise exception 'Voluntary Class 2 needs owned evidence.';end if;
 insert into public.tax_calculation_scopes(user_id,tax_year_start,ordinal,state,input_stamp,data,evidence_document_id,document_snapshot,rationale,author,request_id) values(owner_id,p_year,ordinal,p_state,p_stamp,p_data,p_document,doc,btrim(p_reason),owner_id,p_request) returning id into revision;
 result:=jsonb_build_object('revision_id',revision,'ordinal',ordinal,'new_postings',0);
 insert into public.tax_review_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);return result;
end;$$;
revoke all on function public.review_tax_calculation_scope(integer,integer,jsonb,text,uuid,text,text,uuid) from public,anon,service_role;
grant execute on function public.review_tax_calculation_scope(integer,integer,jsonb,text,uuid,text,text,uuid) to authenticated;

-- Freeze the existing three nested stamp semantics, replacing only owner lookup.
-- A future financial-stamp migration must update these clones and parity tests.
do $$ declare original text;target text;body text;begin
 foreach original in array array['reconciliation_export_stamp_v19_base','reconciliation_export_stamp_v21_base','reconciliation_export_stamp'] loop
  target:=case original when 'reconciliation_export_stamp_v19_base' then 'tax_stamp_v19_for_owner' when 'reconciliation_export_stamp_v21_base' then 'tax_stamp_v21_for_owner' else 'tax_financial_stamp_for_owner' end;
  select p.prosrc into strict body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=original and p.pronargs=0;
  body:=replace(body,'auth.uid()','p_owner');
  body:=replace(body,'public.reconciliation_export_stamp_v19_base()','public.tax_stamp_v19_for_owner(p_owner)');
  body:=replace(body,'public.reconciliation_export_stamp_v21_base()','public.tax_stamp_v21_for_owner(p_owner)');
  execute format('create function public.%I(p_owner uuid) returns text language sql stable security definer set search_path='''' as %L',target,body);
  execute format('revoke all on function public.%I(uuid) from public,anon,authenticated,service_role',target);
 end loop;
end;$$;

-- Mirror reviewed fact/profile/section identity without relying on the service JWT.
do $$ declare body text;begin
 select p.prosrc into strict body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='tax_review_stamp' and p.pronargs=1;
 body:=replace(replace(body,'auth.uid()','p_owner'),'public.reconciliation_export_stamp()','public.tax_financial_stamp_for_owner(p_owner)');
 execute format('create function public.tax_review_stamp_for_owner(p_owner uuid,p_year integer) returns text language sql stable security definer set search_path='''' as %L',body);
end;$$;
revoke all on function public.tax_review_stamp_for_owner(uuid,integer) from public,anon,authenticated,service_role;

create function public.tax_calculation_input_for_owner(p_owner uuid,p_year integer) returns jsonb language sql stable security definer set search_path='' as $$
with financial as materialized(select public.tax_financial_stamp_for_owner(p_owner) stamp),
facts as materialized (
 select v.id,v.family_id,v.ordinal,f.kind,f.label,f.tax_year_start,v.state,v.data,v.rationale,v.created_at
 from public.tax_fact_families f join public.tax_fact_revisions v on v.family_id=f.id and v.user_id=f.user_id
 where f.user_id=p_owner and f.tax_year_start=p_year and not exists(select 1 from public.tax_fact_revisions n where n.user_id=v.user_id and n.family_id=v.family_id and n.ordinal>v.ordinal)
),profile as (
 select v.id,v.profile_id,v.ordinal,v.state,v.data,v.financial_stamp,v.rationale,v.created_at,v.financial_stamp=(select stamp from financial) ledger_is_current
 from public.tax_profiles p join public.tax_profile_revisions v on v.profile_id=p.id and v.user_id=p.user_id
 where p.user_id=p_owner and p.tax_year_start=p_year order by v.ordinal desc limit 1
),sections as (
 select a.id,a.kind,a.verdict,a.fact_digest,a.fact_digest=(select md5(coalesce(string_agg(f.id::text||':'||f.state,',' order by f.id),'')) from facts f where f.kind=a.kind) is_current
 from public.tax_section_attestations a where a.user_id=p_owner and a.tax_year_start=p_year
 and not exists(select 1 from public.tax_section_attestations n where n.user_id=a.user_id and n.tax_year_start=a.tax_year_start and n.kind=a.kind and n.ordinal>a.ordinal)
),scope as (
 select s.id,s.ordinal,s.state,s.input_stamp,s.input_stamp=public.tax_review_stamp_for_owner(p_owner,p_year) is_current,s.data,s.evidence_document_id,s.document_snapshot,s.rationale,s.author,s.created_at
 from public.tax_calculation_scopes s where s.user_id=p_owner and s.tax_year_start=p_year order by s.ordinal desc limit 1
),records as (
 select f.id,f.record_type,f.record_date,(f.amount*100)::bigint amount_pence,f.effect_sign,f.status,f.bank_transaction_id,r.original_transaction_id original_bank_transaction_id,f.source_type,
 case when c.id is null then null else jsonb_build_object('id',c.id,'name',c.name,'record_type',c.record_type,'sa103_box',c.sa103_box,'valid',c.record_type=f.record_type and (c.user_id=p_owner or (c.user_id is null and c.is_default))) end category
 from public.financial_records f left join public.refund_links r on r.id=f.refund_link_id and r.user_id=f.user_id left join public.record_categories c on c.id=f.category_id and (c.user_id=p_owner or (c.user_id is null and c.is_default))
 where f.user_id=p_owner and f.tax_year_start=p_year
),observations as (
 select t.id,t.account_id,jsonb_build_object('id',a.id,'provider',a.provider,'account_type',a.account_type,'masked_identifier',a.masked_identifier) account,t.import_id,t.source_row_id,t.file_hash,t.row_hash,t.row_number,t.transaction_date,t.signed_amount_pence,t.currency,t.classification,t.decision_version,t.business_use_bps,t.dedupe_status,t.import_status,t.recognized_pence,t.has_financial_dependencies
 from public.duplicate_review_transactions t join public.bank_transactions b on b.id=t.id and b.user_id=t.user_id join public.financial_accounts a on a.id=t.account_id and a.user_id=t.user_id where t.user_id=p_owner and b.tax_year_start=p_year
),sources as (
 select s.id,s.revision_id,s.document_id,s.transaction_id,s.record_id,
 (select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(s.snapshot) where key=any(case when s.document_id is not null then array['id','file_sha256','media_type','size_bytes'] when s.transaction_id is not null then array['id','import_id','source_row_id','file_sha256','row_sha256','row_number','transaction_date','signed_amount_pence','currency','classification','decision_version','recognized_pence'] else array['id','record_type','effect_sign','record_date','tax_year_start','status','bank_transaction_id'] end)) || case when s.record_id is not null then jsonb_build_object('amount_pence',((s.snapshot->>'amount')::numeric*100)::bigint) else '{}'::jsonb end snapshot,
 case when s.transaction_id is not null then coalesce(t.recognized_pence,0) when f.status='approved' then (f.amount*100*f.effect_sign)::bigint else 0 end current_recognized_pence,
 case when s.transaction_id is not null then coalesce(t.import_status='discarded' or t.dedupe_status<>'clear' or t.decision_version<>(s.snapshot->>'decision_version')::integer,true)
 when s.record_id is not null then coalesce(f.status<>'approved' or f.amount<>(s.snapshot->>'amount')::numeric or f.record_type<>s.snapshot->>'record_type' or f.record_date<>(s.snapshot->>'record_date')::date or f.effect_sign<>(s.snapshot->>'effect_sign')::integer,true) else false end source_unresolved
 from public.tax_fact_sources s join facts v on v.id=s.revision_id left join public.duplicate_review_transactions t on t.id=s.transaction_id and t.user_id=s.user_id left join public.financial_records f on f.id=s.record_id and f.user_id=s.user_id where s.user_id=p_owner
)
select jsonb_build_object('schema_version','tax-calculation-input/1','owner_id',p_owner,'tax_year_start',p_year,'financial_stamp',(select stamp from financial),
 'profile',(select to_jsonb(p) from profile p),'scope',(select to_jsonb(s) from scope s),
 'facts',coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from facts f),'[]'::jsonb),
 'sections',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from sections s),'[]'::jsonb),
 'records',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from records r),'[]'::jsonb),
 'observations',coalesce((select jsonb_agg(to_jsonb(o) order by o.id) from observations o),'[]'::jsonb),
 'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from sources s),'[]'::jsonb));
$$;
revoke all on function public.tax_calculation_input_for_owner(uuid,integer) from public,anon,authenticated,service_role;
create function public.read_tax_calculation_input(p_year integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to read calculation inputs.';end if;
 if p_year is null or p_year not between 2000 and 2100 then raise exception 'Choose tax year.';end if;
 return public.tax_calculation_input_for_owner(auth.uid(),p_year);
end;$$;
revoke all on function public.read_tax_calculation_input(integer) from public,anon,service_role;grant execute on function public.read_tax_calculation_input(integer) to authenticated;

-- Trusted server computes output. Authenticated clients cannot submit their own totals.
create function public.capture_tax_calculation(p_owner uuid,p_year integer,p_input text,p_result text,p_rules text,p_reason text,p_request uuid)
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

-- Owner-wide draft cash plans. No financial record, tax credit, payment or filing is created.
create table public.finance_plan_rulesets (
 id text primary key,canonical_json text not null,sha256 text not null,
 check(sha256=encode(sha256(convert_to(canonical_json,'UTF8')),'hex'))
);
alter table public.finance_plan_rulesets enable row level security;
revoke all on public.finance_plan_rulesets from public,anon,authenticated,service_role;
grant select on public.finance_plan_rulesets to authenticated,service_role;
create policy finance_rules_read on public.finance_plan_rulesets for select to authenticated using(true);
create trigger immutable_finance_rules before update or delete on public.finance_plan_rulesets for each row execute function public.reject_source_mutation();
create table public.finance_plan_revisions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),ordinal integer not null check(ordinal>0),
 request_id uuid not null,expected_ordinal integer not null check(expected_ordinal>=0),context_stamp text not null check(context_stamp~'^[a-f0-9]{32}$'),
 ruleset_id text not null references public.finance_plan_rulesets(id),
 input jsonb not null,result jsonb not null,input_canonical_json text not null,result_canonical_json text not null,rules_canonical_json text not null,
 input_sha256 text not null,result_sha256 text not null,rules_sha256 text not null,
 rationale text not null check(length(btrim(rationale)) between 1 and 1000),author uuid not null references auth.users(id),created_at timestamptz not null default now(),
 unique(user_id,ordinal),unique(user_id,request_id),unique(id,user_id),check(author=user_id),check(ordinal=expected_ordinal+1),
 check(input_canonical_json::jsonb=input),check(result_canonical_json::jsonb=result),
 check(input_sha256=encode(sha256(convert_to(input_canonical_json,'UTF8')),'hex')),
 check(result_sha256=encode(sha256(convert_to(result_canonical_json,'UTF8')),'hex')),
 check(rules_sha256=encode(sha256(convert_to(rules_canonical_json,'UTF8')),'hex')),
 check(input->>'owner_id'=user_id::text),check(input->>'schema_version'='finance-plan-input/1'),
 check(result->>'status' in ('incomplete','estimate'))
);
create index finance_plan_owner_history on public.finance_plan_revisions(user_id,ordinal desc);
alter table public.finance_plan_revisions enable row level security;
revoke all on public.finance_plan_revisions from public,anon,authenticated,service_role;
grant select on public.finance_plan_revisions to authenticated,service_role;
create policy finance_plan_owner_read on public.finance_plan_revisions for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_finance_plan before update or delete on public.finance_plan_revisions for each row execute function public.reject_source_mutation();
alter table public.record_exports add column finance_plan_id uuid,
 add foreign key(finance_plan_id,user_id) references public.finance_plan_revisions(id,user_id);

create function public.finance_plan_context_for_owner(p_owner uuid) returns jsonb language sql stable security definer set search_path='' as $$
with accounts as (
 select a.id,a.user_id,a.provider,a.account_type,a.currency,public.tax_pack_safe_text(a.label) label,a.masked_identifier
 from public.financial_accounts a where a.user_id=p_owner
),documents as (
 select d.id,d.user_id,d.file_hash file_sha256,d.media_type,d.size_bytes from public.evidence_documents d
 where d.user_id=p_owner and d.media_type in ('application/pdf','image/png','image/jpeg')
),current_revision as (select coalesce(max(ordinal),0) ordinal from public.finance_plan_revisions where user_id=p_owner)
select jsonb_build_object('owner_id',p_owner,'ordinal',(select ordinal from current_revision),'stamp',md5(jsonb_build_object(
 'ordinal',(select ordinal from current_revision),'accounts',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from accounts a),'[]'::jsonb),
 'documents',coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from documents d),'[]'::jsonb))::text));
$$;
revoke all on function public.finance_plan_context_for_owner(uuid) from public,anon,authenticated,service_role;
create function public.read_finance_plan_context() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to review cash plans.';end if;
 return public.finance_plan_context_for_owner(auth.uid());
end;$$;
revoke all on function public.read_finance_plan_context() from public,anon,service_role;
grant execute on function public.read_finance_plan_context() to authenticated;

-- Validate accounting capacity again at the write boundary, independently of the server's preview.
create function public.validate_finance_plan_json(p_plan jsonb) returns void language plpgsql set search_path='' as $$
declare a jsonb;e jsonb;o jsonb;amount numeric;capacity numeric;
begin
 if jsonb_typeof(p_plan) is distinct from 'object' or p_plan->>'schema_version' is distinct from 'finance-plan/1'
 or (select count(*) from jsonb_object_keys(p_plan))<>10
 or not (p_plan ?& array['schema_version','as_of','assets','earmarks','obligations','cash_complete','unique_assets_checked','commitments_complete','cashflow_assumptions_checked','forecast'])
 then raise exception 'Review complete plan fields.';end if;
 if jsonb_typeof(p_plan->'assets') is distinct from 'array' or jsonb_typeof(p_plan->'earmarks') is distinct from 'array' or jsonb_typeof(p_plan->'obligations') is distinct from 'array'
 then raise exception 'Review cash plan rows.';end if;
 if jsonb_array_length(p_plan->'assets')>100 or jsonb_array_length(p_plan->'earmarks')>100 or jsonb_array_length(p_plan->'obligations')>100 then raise exception 'Too many planning rows.';end if;
 if (select count(*) from jsonb_array_elements(p_plan->'assets'))<>(select count(distinct v->>'id') from jsonb_array_elements(p_plan->'assets') v)
 or (select count(*) from jsonb_array_elements(p_plan->'earmarks'))<>(select count(distinct v->>'id') from jsonb_array_elements(p_plan->'earmarks') v)
 or (select count(*) from jsonb_array_elements(p_plan->'obligations'))<>(select count(distinct v->>'id') from jsonb_array_elements(p_plan->'obligations') v)
 then raise exception 'Planning row identities must be unique.';end if;
 if (select count(v->>'account_id') from jsonb_array_elements(p_plan->'assets') v)<>(select count(distinct v->>'account_id') from jsonb_array_elements(p_plan->'assets') v)
 then raise exception 'A physical linked account can appear only once.';end if;
 for a in select value from jsonb_array_elements(p_plan->'assets') loop
  if jsonb_typeof(a) is distinct from 'object' or (select count(*) from jsonb_object_keys(a))<>6 or not(a ?& array['id','label','kind','balance_pence','account_id','document_id']) then raise exception 'Review asset fields.';end if;
  if coalesce(a->>'kind' not in ('cash','liability','pension','restricted'),true) then raise exception 'Review asset kind.';end if;
  if a->'balance_pence'<>'null'::jsonb then
   if jsonb_typeof(a->'balance_pence') is distinct from 'number' or a->>'balance_pence'!~'^-?[0-9]+$' then raise exception 'Use exact integer balances.';end if;
   amount:=(a->>'balance_pence')::numeric;
   if abs(amount)>999999999999 or (a->>'kind'<>'cash' and amount<0) then raise exception 'Invalid balance.';end if;
  end if;
 end loop;
 for e in select value from jsonb_array_elements(p_plan->'earmarks') loop
  if jsonb_typeof(e) is distinct from 'object' or (select count(*) from jsonb_object_keys(e))<>5 or not(e ?& array['id','asset_id','purpose','tax_year_start','amount_pence']) then raise exception 'Review earmark fields.';end if;
  if jsonb_typeof(e->'amount_pence') is distinct from 'number' or e->>'amount_pence'!~'^[0-9]+$' or (e->>'amount_pence')::numeric>999999999999 then raise exception 'Use exact nonnegative earmarks.';end if;
  if coalesce(e->>'purpose' not in ('tax_reserve','business_buffer','emergency_buffer'),true) or (e->>'purpose'<>'tax_reserve' and e->'tax_year_start'<>'null'::jsonb) then raise exception 'Review earmark purpose/year.';end if;
  if not exists(select 1 from jsonb_array_elements(p_plan->'assets') v where v->>'id'=e->>'asset_id' and v->>'kind'='cash' and v->'balance_pence'<>'null'::jsonb) then raise exception 'Only known cash funds earmarks.';end if;
 end loop;
 for a in select value from jsonb_array_elements(p_plan->'assets') loop
  select coalesce(sum((v->>'amount_pence')::numeric),0) into amount from jsonb_array_elements(p_plan->'earmarks') v where v->>'asset_id'=a->>'id';
  capacity:=greatest(coalesce((a->>'balance_pence')::numeric,0),0);
  if amount>capacity then raise exception 'Earmarks across all years exceed cash capacity.';end if;
 end loop;
 for o in select value from jsonb_array_elements(p_plan->'obligations') loop
  if jsonb_typeof(o) is distinct from 'object' or (select count(*) from jsonb_object_keys(o))<>6 or not(o ?& array['id','label','kind','tax_year_start','due_date','amount_pence']) then raise exception 'Review obligation fields.';end if;
  if o->'amount_pence'<>'null'::jsonb and (jsonb_typeof(o->'amount_pence') is distinct from 'number' or o->>'amount_pence'!~'^[0-9]+$' or (o->>'amount_pence')::numeric>999999999999) then raise exception 'Review unpaid obligation amount.';end if;
 end loop;
end;$$;
revoke all on function public.validate_finance_plan_json(jsonb) from public,anon,authenticated,service_role;

create function public.capture_finance_plan(p_owner uuid,p_expected integer,p_stamp text,p_input text,p_result text,p_rules text,p_reason text,p_request uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare prior public.finance_plan_revisions;ctx jsonb;i jsonb;r jsonb;rules jsonb;a jsonb;account public.financial_accounts;doc public.evidence_documents;
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
 lock table public.financial_accounts,public.evidence_documents in share mode nowait;
 ctx:=public.finance_plan_context_for_owner(p_owner);
 if (ctx->>'ordinal')::integer<>p_expected or ctx->>'stamp'<>p_stamp then raise exception 'Cash plan or sources changed. Review again.';end if;
 i:=p_input::jsonb;r:=p_result::jsonb;rules:=p_rules::jsonb;
 if jsonb_typeof(i) is distinct from 'object' or (select count(*) from jsonb_object_keys(i))<>5 or not(i ?& array['schema_version','owner_id','evaluated_on','plan','sources'])
 or i->>'schema_version' is distinct from 'finance-plan-input/1' or i->>'owner_id' is distinct from p_owner::text
 or i->>'evaluated_on' is distinct from ((now() at time zone 'Europe/London')::date)::text
 then raise exception 'Review current owner/date and complete plan envelope.';end if;
 perform public.validate_finance_plan_json(i->'plan');
 if rules->>'id' is distinct from 'uk-cash-planning-2026-27/1' or rules->>'engine_version' is distinct from 'vibecount-planning/1'
 or r->>'engine_version' is distinct from rules->>'engine_version' or r#>>'{forecast,ruleset_id}' is distinct from rules->>'id'
 or coalesce(r->>'status' not in ('estimate','incomplete'),true) or r->>'evaluated_on' is distinct from i->>'evaluated_on'
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

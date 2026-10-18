-- Reviewed in-app reminder history only: no financial posting, payment, filing or send.
create table public.tax_deadline_rulesets (
 id text primary key,canonical_json text not null,sha256 text not null,
 check(sha256=encode(sha256(convert_to(canonical_json,'UTF8')),'hex'))
);
alter table public.tax_deadline_rulesets enable row level security;
revoke all on public.tax_deadline_rulesets from public,anon,authenticated,service_role;
grant select on public.tax_deadline_rulesets to authenticated,service_role;
create policy deadline_rules_read on public.tax_deadline_rulesets for select to authenticated using(true);
create trigger immutable_deadline_rules before update or delete on public.tax_deadline_rulesets for each row execute function public.reject_source_mutation();
create table public.tax_deadline_revisions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),tax_year_start integer not null check(tax_year_start in (2025,2026)),
 ordinal integer not null check(ordinal>0),expected_ordinal integer not null check(expected_ordinal>=0),request_id uuid not null,
 context_stamp text not null check(context_stamp~'^[a-f0-9]{32}$'),source_plan_id uuid,ruleset_id text not null references public.tax_deadline_rulesets(id),
 input jsonb not null,result jsonb not null,input_canonical_json text not null,result_canonical_json text not null,rules_canonical_json text not null,
 input_sha256 text not null,result_sha256 text not null,rules_sha256 text not null,
 rationale text not null check(length(btrim(rationale)) between 1 and 1000),author uuid not null references auth.users(id),created_at timestamptz not null default now(),
 unique(user_id,tax_year_start,ordinal),unique(user_id,request_id),unique(id,user_id),check(author=user_id),check(ordinal=expected_ordinal+1),
 foreign key(source_plan_id,user_id) references public.finance_plan_revisions(id,user_id),
 check(input_canonical_json::jsonb=input),check(result_canonical_json::jsonb=result),
 check(input_sha256=encode(sha256(convert_to(input_canonical_json,'UTF8')),'hex')),
 check(result_sha256=encode(sha256(convert_to(result_canonical_json,'UTF8')),'hex')),
 check(rules_sha256=encode(sha256(convert_to(rules_canonical_json,'UTF8')),'hex')),
 check(input->>'owner_id'=user_id::text),check(input->>'schema_version'='tax-deadline-input/1'),
 check((input#>>'{plan,tax_year_start}')::integer=tax_year_start),check(result->>'tax_year_start'=tax_year_start::text),
 check((input#>>'{sources,finance_plan,id}') is not distinct from source_plan_id::text)
);
create index tax_deadline_owner_history on public.tax_deadline_revisions(user_id,tax_year_start,ordinal desc);
alter table public.tax_deadline_revisions enable row level security;
revoke all on public.tax_deadline_revisions from public,anon,authenticated,service_role;
grant select on public.tax_deadline_revisions to authenticated,service_role;
create policy deadline_owner_read on public.tax_deadline_revisions for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_tax_deadline before update or delete on public.tax_deadline_revisions for each row execute function public.reject_source_mutation();
alter table public.record_exports add column tax_deadline_id uuid,
 add foreign key(tax_deadline_id,user_id) references public.tax_deadline_revisions(id,user_id);

create function public.tax_deadline_context_for_owner(p_owner uuid,p_year integer) returns jsonb language sql stable security definer set search_path='' as $$
with current_review as (select coalesce(max(ordinal),0) ordinal from public.tax_deadline_revisions where user_id=p_owner and tax_year_start=p_year),
plan as (select id,input_sha256,result_sha256 from public.finance_plan_revisions where user_id=p_owner order by ordinal desc limit 1),
documents as (select id,user_id,file_hash from public.evidence_documents where user_id=p_owner)
select jsonb_build_object('owner_id',p_owner,'tax_year_start',p_year,'ordinal',(select ordinal from current_review),'source_plan_id',(select id from plan),'stamp',
 md5(jsonb_build_object('year',p_year,'ordinal',(select ordinal from current_review),'plan',(select to_jsonb(p) from plan p),
 'documents',coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from documents d),'[]'::jsonb))::text));
$$;
revoke all on function public.tax_deadline_context_for_owner(uuid,integer) from public,anon,authenticated,service_role;
create function public.read_tax_deadline_context(p_year integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or p_year is null or p_year not in (2025,2026) then raise exception 'Sign in and choose a supported deadline year.';end if;
 return public.tax_deadline_context_for_owner(auth.uid(),p_year);
end;$$;
revoke all on function public.read_tax_deadline_context(integer) from public,anon,service_role;
grant execute on function public.read_tax_deadline_context(integer) to authenticated;

create function public.capture_tax_deadline_review(p_owner uuid,p_year integer,p_expected integer,p_stamp text,p_input text,p_result text,p_rules text,p_reason text,p_request uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare prior public.tax_deadline_revisions;ctx jsonb;i jsonb;r jsonb;rules jsonb;plan public.finance_plan_revisions;s jsonb;e jsonb;item jsonb;
 source_ref jsonb:='null'::jsonb;actual_obligations jsonb:='{}'::jsonb;provided_obligations jsonb;actual_documents jsonb;provided_documents jsonb;
 unassigned integer:=0;rule_hash text;captured uuid;expected_ids text[];entry_ids text[];notice_ids uuid[];
begin
 if p_owner is null or p_year is null or p_year not in (2025,2026) or p_expected is null or p_expected<0 or p_request is null
 or p_stamp is null or p_stamp!~'^[a-f0-9]{32}$' or p_reason is null or length(btrim(p_reason)) not between 1 and 1000
 or p_input is null or p_result is null or p_rules is null or octet_length(p_input)>1000000 or octet_length(p_result)>1000000 or octet_length(p_rules)>100000
 then raise exception 'Review deadline capture fields.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||p_owner::text,0));
 select * into prior from public.tax_deadline_revisions where user_id=p_owner and request_id=p_request;
 if found then
  if prior.tax_year_start<>p_year or prior.expected_ordinal<>p_expected or prior.context_stamp<>p_stamp or prior.input_canonical_json<>p_input or prior.result_canonical_json<>p_result or prior.rules_canonical_json<>p_rules or prior.rationale<>btrim(p_reason) then raise exception 'Deadline request used with different inputs.';end if;
  return prior.id;
 end if;
 lock table public.evidence_documents in share mode nowait;
 ctx:=public.tax_deadline_context_for_owner(p_owner,p_year);
 if (ctx->>'ordinal')::integer<>p_expected or ctx->>'stamp'<>p_stamp then raise exception 'Deadline review or sources changed.';end if;
 i:=p_input::jsonb;r:=p_result::jsonb;rules:=p_rules::jsonb;s:=i->'sources';
 if jsonb_typeof(i) is distinct from 'object' or (select count(*) from jsonb_object_keys(i))<>5 or not(i ?& array['schema_version','owner_id','evaluated_on','plan','sources'])
 or i->>'schema_version' is distinct from 'tax-deadline-input/1' or i->>'owner_id' is distinct from p_owner::text
 or i->>'evaluated_on' is distinct from ((now() at time zone 'Europe/London')::date)::text
 or jsonb_typeof(i->'plan') is distinct from 'object' or (select count(*) from jsonb_object_keys(i->'plan'))<>3
 or not(i->'plan' ?& array['schema_version','tax_year_start','entries']) or i#>>'{plan,schema_version}' is distinct from 'tax-deadline-plan/1'
 or i#>>'{plan,tax_year_start}' is distinct from p_year::text or jsonb_typeof(i#>'{plan,entries}') is distinct from 'array'
 or jsonb_typeof(s) is distinct from 'object' or (select count(*) from jsonb_object_keys(s))<>5
 or not(s ?& array['owner_id','finance_plan','obligations','unassigned_tax_obligations','documents']) or s->>'owner_id' is distinct from p_owner::text
 or jsonb_typeof(s->'obligations') is distinct from 'array' or jsonb_typeof(s->'documents') is distinct from 'array'
 then raise exception 'Review exact owner/date/year and safe deadline envelope.';end if;
 select * into plan from public.finance_plan_revisions where user_id=p_owner order by ordinal desc limit 1;
 if found then
  source_ref:=jsonb_build_object('id',plan.id,'user_id',p_owner,'ordinal',plan.ordinal,'as_of',plan.input#>>'{plan,as_of}','input_sha256',plan.input_sha256,'result_sha256',plan.result_sha256);
  select coalesce(jsonb_object_agg(v->>'id',v-'kind'),'{}'::jsonb) into actual_obligations from jsonb_array_elements(plan.input#>'{plan,obligations}') v where v->>'kind'='tax' and v->>'tax_year_start'=p_year::text;
  select count(*) into unassigned from jsonb_array_elements(plan.input#>'{plan,obligations}') v where v->>'kind'='tax' and v->'tax_year_start'='null'::jsonb;
 end if;
 select coalesce(jsonb_object_agg(v->>'id',v),'{}'::jsonb) into provided_obligations from jsonb_array_elements(s->'obligations') v;
 if s->'finance_plan' is distinct from source_ref or provided_obligations is distinct from actual_obligations
 or jsonb_array_length(s->'obligations')<>(select count(*) from jsonb_object_keys(actual_obligations))
 or s->'unassigned_tax_obligations' is distinct from to_jsonb(unassigned) then raise exception 'Deadline commitment sources changed or are not owned.';end if;
 select array_agg(x order by x) into expected_ids from (select 'calendar:'||v x from unnest(array['register','paper','online','tax_code','balancing','first_poa','second_poa']) v
 union all select 'commitment:'||key from jsonb_object_keys(actual_obligations) key) ids;
 select array_agg(v->>'id' order by v->>'id') into entry_ids from jsonb_array_elements(i#>'{plan,entries}') v;
 if entry_ids is distinct from expected_ids then raise exception 'Review every deadline exactly once.';end if;
 for e in select value from jsonb_array_elements(i#>'{plan,entries}') loop
  if jsonb_typeof(e) is distinct from 'object' or (select count(*) from jsonb_object_keys(e))<>7 or not(e ?& array['id','applicability','disposition','date_basis','notice_due_date','notice_document_id','lead_days'])
  or coalesce(e->>'applicability' not in ('unknown','applies','not_applicable'),true) or coalesce(e->>'disposition' not in ('open','acknowledged'),true)
  or coalesce(e->>'date_basis' not in ('unreviewed','standard','notice','saved_obligation'),true) or not(e->'lead_days' in ('0'::jsonb,'7'::jsonb,'14'::jsonb,'30'::jsonb))
  then raise exception 'Review exact deadline choices.';end if;
  if (e->>'id' like 'commitment:%' and e->>'date_basis' not in ('unreviewed','saved_obligation')) or (e->>'id' like 'calendar:%' and e->>'date_basis'='saved_obligation') then raise exception 'Review dates at their source.';end if;
  if e->>'date_basis'='notice' then
   if coalesce(e->>'notice_due_date'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$',true) or (e->>'notice_due_date')::date not between date '2000-01-01' and date '2101-12-31' or e->>'notice_document_id' is null then raise exception 'Review personal notice date and evidence.';end if;
  elsif e->'notice_due_date'<>'null'::jsonb or e->'notice_document_id'<>'null'::jsonb then raise exception 'Remove unused notice fields.';end if;
  if e->>'disposition'='acknowledged' and (e->>'applicability'<>'applies' or e->>'date_basis'='unreviewed') then raise exception 'Review the reminder before acknowledging it.';end if;
 end loop;
 select coalesce(array_agg(distinct (v->>'notice_document_id')::uuid) filter(where v->>'notice_document_id' is not null),'{}'::uuid[]) into notice_ids from jsonb_array_elements(i#>'{plan,entries}') v;
 select coalesce(jsonb_object_agg(d.id::text,jsonb_build_object('id',d.id,'user_id',d.user_id,'file_sha256',d.file_hash)),'{}'::jsonb) into actual_documents from public.evidence_documents d where d.user_id=p_owner and d.id=any(notice_ids);
 select coalesce(jsonb_object_agg(v->>'id',v),'{}'::jsonb) into provided_documents from jsonb_array_elements(s->'documents') v;
 if cardinality(notice_ids)<>(select count(*) from jsonb_object_keys(actual_documents)) or provided_documents is distinct from actual_documents or jsonb_array_length(s->'documents')<>cardinality(notice_ids) then raise exception 'Notice evidence not owned, changed or unsafe.';end if;
 if rules->>'id' is distinct from 'uk-sa-deadlines-2025-27/1' or rules->>'engine_version' is distinct from 'vibecount-tax-deadlines/1'
 or jsonb_typeof(r) is distinct from 'object' or (select count(*) from jsonb_object_keys(r))<>9 or not(r ?& array['engine_version','ruleset_id','evaluated_on','tax_year_start','status','warnings','items','active_count','needs_review_count'])
 or r->>'engine_version' is distinct from rules->>'engine_version' or r->>'ruleset_id' is distinct from rules->>'id' or r->>'evaluated_on' is distinct from i->>'evaluated_on' or r->>'tax_year_start' is distinct from p_year::text
 or coalesce(r->>'status' not in ('review_required','reviewed_reminders'),true) or jsonb_typeof(r->'warnings') is distinct from 'array' or jsonb_typeof(r->'items') is distinct from 'array'
 then raise exception 'Unsupported deadline rules or result.';end if;
 select array_agg(v->>'id' order by v->>'id') into entry_ids from jsonb_array_elements(r->'items') v;
 if entry_ids is distinct from expected_ids then raise exception 'Deadline result identity changed.';end if;
 for item in select value from jsonb_array_elements(r->'items') loop
  if jsonb_typeof(item) is distinct from 'object' or (select count(*) from jsonb_object_keys(item))<>18 or not(item ?& array['id','title','tax_year_start','source_kind','source_id','proposed_due_date','amount_pence','commitment_as_of','source_refs','applicability','disposition','date_basis','notice_due_date','notice_document_id','lead_days','due_date','remind_from','phase']) then raise exception 'Unsafe deadline result fields.';end if;
 end loop;
 rule_hash:=encode(sha256(convert_to(p_rules,'UTF8')),'hex');
 insert into public.tax_deadline_rulesets(id,canonical_json,sha256) values(rules->>'id',p_rules,rule_hash) on conflict(id) do nothing;
 if not exists(select 1 from public.tax_deadline_rulesets where id=rules->>'id' and canonical_json=p_rules and sha256=rule_hash) then raise exception 'Deadline rules version changed.';end if;
 insert into public.tax_deadline_revisions(user_id,tax_year_start,ordinal,expected_ordinal,request_id,context_stamp,source_plan_id,ruleset_id,input,result,input_canonical_json,result_canonical_json,rules_canonical_json,input_sha256,result_sha256,rules_sha256,rationale,author)
 values(p_owner,p_year,p_expected+1,p_expected,p_request,p_stamp,plan.id,rules->>'id',i,r,p_input,p_result,p_rules,encode(sha256(convert_to(p_input,'UTF8')),'hex'),encode(sha256(convert_to(p_result,'UTF8')),'hex'),rule_hash,btrim(p_reason),p_owner) returning id into captured;
 return captured;
end;$$;
revoke all on function public.capture_tax_deadline_review(uuid,integer,integer,text,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.capture_tax_deadline_review(uuid,integer,integer,text,text,text,text,text,uuid) to service_role;

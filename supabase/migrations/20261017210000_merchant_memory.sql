-- Merchant memory proposes treatment. Only an explicit reviewed batch changes postings.
create function public.merchant_match_key(p_description text) returns text language sql immutable set search_path='' as $$
 select lower(regexp_replace(btrim(p_description),'[[:space:]]+',' ','g'));
$$;
revoke all on function public.merchant_match_key(text) from public,anon;
grant execute on function public.merchant_match_key(text) to authenticated,service_role;
create table public.merchant_requests (
 user_id uuid not null references auth.users(id),request_id uuid not null,payload_hash text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(user_id,request_id)
);
create table public.merchant_rules (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),match_key text not null check(length(match_key) between 1 and 1000),record_type text not null check(record_type in ('income','expense')),
 normalization_version text not null default 'description-exact/1' check(normalization_version='description-exact/1'),created_at timestamptz not null default now(),unique(id,user_id)
);
create index merchant_rule_match on public.merchant_rules(user_id,match_key,record_type);
create table public.merchant_rule_versions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),rule_id uuid not null,ordinal integer not null check(ordinal>0),status text not null check(status in ('active','disabled')),
 account_id uuid,tax_year_start integer check(tax_year_start between 2000 and 2100),effective_from date not null,expires_on date,priority integer not null check(priority between 0 and 100),
 classification text not null check(classification in ('Business','Personal','Mixed','Transfer','Refund','Unknown')),business_use_bps integer not null check(business_use_bps between 0 and 10000),category_id uuid references public.record_categories(id),category_snapshot jsonb,
 evidence_status text not null check(evidence_status in ('provisional','missing')),seed_transaction_id uuid not null,seed_snapshot jsonb not null,rationale text not null check(length(btrim(rationale)) between 1 and 1000),author uuid not null references auth.users(id),request_id uuid not null,created_at timestamptz not null default now(),
 check(expires_on is null or expires_on>=effective_from),unique(rule_id,ordinal),unique(id,user_id),unique(user_id,request_id),
 foreign key(rule_id,user_id) references public.merchant_rules(id,user_id),foreign key(account_id,user_id) references public.financial_accounts(id,user_id),foreign key(seed_transaction_id,user_id) references public.bank_transactions(id,user_id),
 foreign key(user_id,request_id) references public.merchant_requests(user_id,request_id) deferrable initially deferred
);
create index merchant_version_owner on public.merchant_rule_versions(user_id,rule_id,ordinal desc);
create table public.merchant_review_batches (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),reviewed_stamp text not null,rationale text not null,author uuid not null references auth.users(id),request_id uuid not null,created_at timestamptz not null default now(),unique(id,user_id),unique(user_id,request_id),foreign key(user_id,request_id) references public.merchant_requests(user_id,request_id) deferrable initially deferred
);
alter table public.classification_decisions add constraint classification_version_owner unique(transaction_id,version,user_id);
create table public.merchant_review_items (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),batch_id uuid not null,transaction_id uuid not null,rule_version_id uuid,
 origin text not null check(origin in ('rule','manual','override')),before_snapshot jsonb not null,after_version integer not null,
 classification text not null check(classification in ('Business','Personal','Mixed')),business_use_bps integer not null,category_id uuid references public.record_categories(id),category_snapshot jsonb,
 evidence_status text not null check(evidence_status in ('provisional','missing','linked')),recognized_pence bigint not null,rationale text not null,created_at timestamptz not null default now(),
 unique(id,user_id),unique(batch_id,transaction_id),unique(transaction_id,after_version),
 foreign key(batch_id,user_id) references public.merchant_review_batches(id,user_id),foreign key(transaction_id,after_version,user_id) references public.classification_decisions(transaction_id,version,user_id),foreign key(rule_version_id,user_id) references public.merchant_rule_versions(id,user_id)
);
create index merchant_item_owner_tx on public.merchant_review_items(user_id,transaction_id,id);
create table public.merchant_review_evidence (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),item_id uuid not null,document_id uuid not null,document_snapshot jsonb not null,
 unique(item_id,document_id),foreign key(item_id,user_id) references public.merchant_review_items(id,user_id),foreign key(document_id,user_id) references public.evidence_documents(id,user_id)
);
create table public.merchant_review_reversals (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),batch_id uuid not null unique,reviewed_stamp text not null,rationale text not null,author uuid not null references auth.users(id),request_id uuid not null,created_at timestamptz not null default now(),unique(id,user_id),unique(user_id,request_id),
 foreign key(batch_id,user_id) references public.merchant_review_batches(id,user_id),foreign key(user_id,request_id) references public.merchant_requests(user_id,request_id) deferrable initially deferred
);
create table public.merchant_review_undo_items (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),reversal_id uuid not null,item_id uuid not null unique,transaction_id uuid not null,after_version integer not null,before_snapshot jsonb not null,
 foreign key(reversal_id,user_id) references public.merchant_review_reversals(id,user_id),foreign key(item_id,user_id) references public.merchant_review_items(id,user_id),foreign key(transaction_id,after_version,user_id) references public.classification_decisions(transaction_id,version,user_id)
);
do $$ declare relation text; begin
 foreach relation in array array['merchant_requests','merchant_rules','merchant_rule_versions','merchant_review_batches','merchant_review_items','merchant_review_evidence','merchant_review_reversals','merchant_review_undo_items'] loop
 execute format('alter table public.%I enable row level security',relation);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',relation);
 execute format('grant select on public.%I to authenticated,service_role',relation);
 execute format('create policy merchant_owner_read on public.%I for select to authenticated using(user_id=(select auth.uid()))',relation);
 execute format('create trigger immutable_merchant_history before update or delete on public.%I for each row execute function public.reject_source_mutation()',relation);
 end loop;
end; $$;

create view public.current_merchant_rules with(security_invoker=true) as
select v.*,r.match_key,r.record_type,r.normalization_version,
 (v.category_id is null or (c.id is not null and (c.user_id=v.user_id or (c.user_id is null and c.is_default)) and c.record_type=r.record_type and c.name=v.category_snapshot->>'name')) category_valid
from public.merchant_rule_versions v join public.merchant_rules r on r.id=v.rule_id and r.user_id=v.user_id
left join public.record_categories c on c.id=v.category_id
where not exists(select 1 from public.merchant_rule_versions later where later.rule_id=v.rule_id and later.user_id=v.user_id and later.ordinal>v.ordinal);
revoke all on public.current_merchant_rules from public,anon,authenticated,service_role;
grant select on public.current_merchant_rules to authenticated,service_role;

create view public.merchant_transaction_choices with(security_invoker=true) as
select c.*,t.tax_year_start,public.merchant_match_key(t.description) merchant_key,
 coalesce(p.rule_candidates,'[]'::jsonb) rule_candidates,coalesce(p.top_count,0)::integer top_rule_count,
 case when p.top_count=1 then p.first_id else null end suggested_rule_version_id
from public.duplicate_review_transactions c join public.bank_transactions t on t.id=c.id and t.user_id=c.user_id
left join lateral (
 with matched as (
  select r.*,dense_rank() over(order by r.priority desc,((r.account_id is not null)::integer+(r.tax_year_start is not null)::integer) desc) precedence_rank
  from public.current_merchant_rules r
  where r.user_id=t.user_id and r.status='active' and r.match_key=public.merchant_match_key(t.description)
   and r.record_type=case when t.signed_amount_pence>0 then 'income' else 'expense' end
   and (r.account_id is null or r.account_id=t.account_id) and (r.tax_year_start is null or r.tax_year_start=t.tax_year_start)
   and t.transaction_date>=r.effective_from and (r.expires_on is null or t.transaction_date<=r.expires_on)
 )
 select jsonb_agg(jsonb_build_object('id',id,'rule_id',rule_id,'ordinal',ordinal,'classification',classification,'business_use_bps',business_use_bps,'category_id',category_id,'category_snapshot',category_snapshot,'category_valid',category_valid,'priority',priority,'precedence_rank',precedence_rank,'account_id',account_id,'tax_year_start',tax_year_start,'effective_from',effective_from,'expires_on',expires_on,'evidence_status',evidence_status) order by precedence_rank,id) rule_candidates,
 count(*) filter(where precedence_rank=1) top_count,(array_agg(id order by id) filter(where precedence_rank=1))[1] first_id from matched
) p on true;
revoke all on public.merchant_transaction_choices from public,anon,authenticated,service_role;
grant select on public.merchant_transaction_choices to authenticated,service_role;

alter function public.reconciliation_export_stamp() rename to reconciliation_export_stamp_v21_base;
revoke all on function public.reconciliation_export_stamp_v21_base() from public,anon,service_role;
grant execute on function public.reconciliation_export_stamp_v21_base() to authenticated;
create function public.reconciliation_export_stamp() returns text language sql stable security invoker set search_path='' as $$
 select md5(public.reconciliation_export_stamp_v21_base()||'|'||
 coalesce((select string_agg(id::text,',' order by id) from public.merchant_rule_versions where user_id=(select auth.uid())),'')||'|'||
 coalesce((select string_agg(id::text,',' order by id) from public.merchant_review_batches where user_id=(select auth.uid())),'')||'|'||
 coalesce((select string_agg(id::text,',' order by id) from public.merchant_review_reversals where user_id=(select auth.uid())),'')||'|'||
 coalesce((select string_agg(id::text||':'||name||':'||record_type||':'||coalesce(user_id::text,'')||':'||is_default::text,',' order by id) from public.record_categories where user_id=(select auth.uid()) or (user_id is null and is_default)),''));
$$;
revoke all on function public.reconciliation_export_stamp() from public,anon,service_role;
grant execute on function public.reconciliation_export_stamp() to authenticated;

create function public.validate_merchant_treatment(p_kind text,p_class text,p_category uuid,p_bps integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.record_categories;
begin
 if p_class is null or p_class not in ('Business','Personal','Mixed','Transfer','Refund','Unknown') then raise exception 'Choose a treatment.'; end if;
 if p_class in ('Business','Mixed') then
  if (p_class='Business' and p_bps is distinct from 10000) or (p_class='Mixed' and (p_kind<>'expense' or p_bps is null or p_bps not between 1 and 9999)) then raise exception 'Review the exact business-use percentage.'; end if;
  select * into c from public.record_categories where id=p_category and record_type=p_kind and (user_id=auth.uid() or (user_id is null and is_default)) for share;
  if not found then raise exception 'Choose an owned or shared default category of the correct type.'; end if;
  return jsonb_build_object('id',c.id,'name',c.name,'record_type',c.record_type,'user_id',c.user_id,'is_default',c.is_default);
 end if;
 if p_bps is distinct from 0 or p_category is not null then raise exception 'Excluded or unresolved treatment needs zero business use and no category.'; end if;
 return null;
end; $$;
revoke all on function public.validate_merchant_treatment(text,text,uuid,integer) from public,anon,authenticated,service_role;

create function public.save_merchant_rule(p_rule uuid,p_expected_version integer,p_definition jsonb,p_stamp text,p_reason text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); prior public.merchant_requests; payload text; seed public.duplicate_review_transactions; family public.merchant_rules; rule public.merchant_rule_versions; category jsonb; result jsonb; new_id uuid; kind text; account uuid; year integer; first_date date; last_date date; target text; bps integer; cat uuid; priority integer; status text; evidence text;
begin
 if owner_id is null then raise exception 'Sign in to remember merchant treatment.'; end if;
 if p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 or jsonb_typeof(p_definition) is distinct from 'object' then raise exception 'Review the rule and its scope with a reason.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 payload:=md5(jsonb_build_array('rule',p_rule,p_expected_version,p_definition,p_stamp,btrim(p_reason))::text);
 select * into prior from public.merchant_requests where user_id=owner_id and request_id=p_request;
 if found then if prior.payload_hash<>payload then raise exception 'Request ID was used for another review.'; end if;return prior.result;end if;
 perform 1 from public.record_categories where user_id=owner_id or (user_id is null and is_default) order by id for share;
 if public.reconciliation_export_stamp() is distinct from p_stamp then raise exception 'Review state changed. Reload the rule.'; end if;
 select * into seed from public.duplicate_review_transactions where id=(p_definition->>'seed_id')::uuid and user_id=owner_id;
 if not found then raise exception 'Owned merchant source not found.'; end if;
 kind:=case when seed.signed_amount_pence>0 then 'income' else 'expense' end;
 if p_rule is null then
  if p_expected_version is distinct from 0 then raise exception 'New rule version must start at zero.'; end if;
  insert into public.merchant_rules(user_id,match_key,record_type) values(owner_id,public.merchant_match_key(seed.description),kind) returning * into family;
 else
  select * into family from public.merchant_rules where id=p_rule and user_id=owner_id;
  select * into rule from public.merchant_rule_versions where rule_id=p_rule and user_id=owner_id order by ordinal desc limit 1;
  if family.id is null or rule.ordinal is distinct from p_expected_version or family.match_key<>public.merchant_match_key(seed.description) or family.record_type<>kind then raise exception 'Rule changed or merchant identity differs.'; end if;
 end if;
 account:=nullif(p_definition->>'account_id','')::uuid;year:=nullif(p_definition->>'tax_year_start','')::integer;
 if account is not null and not exists(select 1 from public.financial_accounts where id=account and user_id=owner_id) then raise exception 'Choose an owned account scope.'; end if;
 if year is not null and year not between 2000 and 2100 then raise exception 'Choose a supported tax year.'; end if;
 if coalesce(p_definition->>'effective_from','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (nullif(p_definition->>'expires_on','') is not null and p_definition->>'expires_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then raise exception 'Choose explicit ISO effective dates.'; end if;
 first_date:=(p_definition->>'effective_from')::date;last_date:=nullif(p_definition->>'expires_on','')::date;
 if last_date<first_date or (year is not null and (first_date>make_date(year+1,4,5) or last_date<make_date(year,4,6))) then raise exception 'Rule dates do not overlap its scope.'; end if;
 target:=p_definition->>'classification';bps:=(p_definition->>'business_use_bps')::integer;cat:=nullif(p_definition->>'category_id','')::uuid;priority:=(p_definition->>'priority')::integer;status:=p_definition->>'status';evidence:=p_definition->>'evidence_status';
 if priority is null or priority not between 0 and 100 or status is null or status not in ('active','disabled') or evidence is null or evidence not in ('provisional','missing') then raise exception 'Review rule priority, status and evidence state.'; end if;
 category:=public.validate_merchant_treatment(kind,target,cat,bps);
 insert into public.merchant_rule_versions(user_id,rule_id,ordinal,status,account_id,tax_year_start,effective_from,expires_on,priority,classification,business_use_bps,category_id,category_snapshot,evidence_status,seed_transaction_id,seed_snapshot,rationale,author,request_id)
 values(owner_id,family.id,coalesce(rule.ordinal,0)+1,status,account,year,first_date,last_date,priority,target,bps,cat,category,evidence,seed.id,to_jsonb(seed),btrim(p_reason),owner_id,p_request) returning id into new_id;
 result:=jsonb_build_object('rule_id',family.id,'version_id',new_id,'ordinal',coalesce(rule.ordinal,0)+1,'new_postings',0);
 insert into public.merchant_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);return result;
end; $$;
revoke all on function public.save_merchant_rule(uuid,integer,jsonb,text,text,uuid) from public,anon,service_role;
grant execute on function public.save_merchant_rule(uuid,integer,jsonb,text,text,uuid) to authenticated;

create function public.approve_merchant_batch(p_entries jsonb,p_stamp text,p_reason text,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); prior public.merchant_requests; payload text; batch uuid; entry jsonb; tx public.merchant_transaction_choices; r public.current_merchant_rules; target text; bps integer; cat uuid; category jsonb; origin text; selected_rule_version uuid; evidence text; docs jsonb; doc uuid; item uuid; decision jsonb; result jsonb; new_income bigint:=0; new_expense bigint:=0; old_income bigint:=0; old_expense bigint:=0;
begin
 if owner_id is null then raise exception 'Sign in to review this batch.'; end if;
 if p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Review the complete batch and add a reason.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 payload:=md5(jsonb_build_array('apply',p_entries,p_stamp,btrim(p_reason))::text);
 select * into prior from public.merchant_requests where user_id=owner_id and request_id=p_request;
 if found then if prior.payload_hash<>payload then raise exception 'Request ID was used for another review.'; end if;return prior.result;end if;
 if jsonb_typeof(p_entries) is distinct from 'array' then raise exception 'Choose explicit review rows.'; end if;
 if jsonb_array_length(p_entries) not between 1 and 50 or (select count(distinct value->>'transaction_id') from jsonb_array_elements(p_entries))<>jsonb_array_length(p_entries) then raise exception 'Choose 1 to 50 distinct reviewed rows.'; end if;
 perform 1 from public.bank_transactions where user_id=owner_id and id in(select (value->>'transaction_id')::uuid from jsonb_array_elements(p_entries)) order by id for update;
 perform 1 from public.record_categories where user_id=owner_id or (user_id is null and is_default) order by id for share;
 if public.reconciliation_export_stamp() is distinct from p_stamp then raise exception 'Review state changed. Reload the batch.'; end if;
 insert into public.merchant_review_batches(user_id,reviewed_stamp,rationale,author,request_id) values(owner_id,p_stamp,btrim(p_reason),owner_id,p_request) returning id into batch;
 for entry in select value from jsonb_array_elements(p_entries) loop
  select * into tx from public.merchant_transaction_choices where id=(entry->>'transaction_id')::uuid and user_id=owner_id;
  if not found or tx.decision_version is distinct from (entry->>'version')::integer or tx.import_status='discarded' or tx.dedupe_status<>'clear' then raise exception 'Source scope changed or requires identity review.'; end if;
  origin:=entry->>'origin';selected_rule_version:=nullif(entry->>'rule_version_id','')::uuid;
  if origin is null or origin not in ('rule','manual','override') or (tx.classification<>'Unknown' and origin<>'override') then raise exception 'Known treatment requires an explicit override review.'; end if;
  if selected_rule_version is not null and not exists(select 1 from jsonb_array_elements(tx.rule_candidates) c where c->>'id'=selected_rule_version::text) then raise exception 'Rule is no longer applicable.'; end if;
  if origin='rule' then
   if tx.classification<>'Unknown' or tx.top_rule_count<>1 or tx.suggested_rule_version_id is distinct from selected_rule_version then raise exception 'Resolve competing rules or review manually.'; end if;
   select * into r from public.current_merchant_rules where id=selected_rule_version and user_id=owner_id;
   if not found or not r.category_valid then raise exception 'Saved rule category changed. Revise it before applying.'; end if;
   target:=r.classification;bps:=r.business_use_bps;cat:=r.category_id;
  else target:=entry->>'classification';bps:=(entry->>'business_use_bps')::integer;cat:=nullif(entry->>'category_id','')::uuid;
  end if;
  if target is null or target not in ('Business','Personal','Mixed') then raise exception 'Leave Unknown unresolved; use dedicated transfer/refund review for relationships.'; end if;
  category:=public.validate_merchant_treatment(case when tx.signed_amount_pence>0 then 'income' else 'expense' end,target,cat,bps);
  docs:=coalesce(entry->'document_ids','[]'::jsonb);evidence:=entry->>'evidence_status';
  if jsonb_typeof(docs) is distinct from 'array' then raise exception 'Choose explicit owned document evidence.'; end if;
  if jsonb_array_length(docs)>10 or (select count(distinct value #>> '{}') from jsonb_array_elements(docs))<>jsonb_array_length(docs) or evidence is null or evidence not in ('provisional','missing','linked') or (evidence='linked' and jsonb_array_length(docs)=0) then raise exception 'Review document evidence status and links.'; end if;
  for doc in select (value #>> '{}')::uuid from jsonb_array_elements(docs) loop
   if not exists(select 1 from public.evidence_documents where id=doc and user_id=owner_id) then raise exception 'Owned evidence document not found.'; end if;
  end loop;
  decision:=public.review_bank_transaction(tx.id,tx.decision_version,target,cat,bps,btrim(p_reason));
  insert into public.merchant_review_items(user_id,batch_id,transaction_id,rule_version_id,origin,before_snapshot,after_version,classification,business_use_bps,category_id,category_snapshot,evidence_status,recognized_pence,rationale)
  values(owner_id,batch,tx.id,selected_rule_version,origin,to_jsonb(tx)-'rule_candidates',(decision->>'version')::integer,target,bps,cat,category,evidence,(decision->>'recognized_pence')::bigint,btrim(p_reason)) returning id into item;
  insert into public.merchant_review_evidence(user_id,item_id,document_id,document_snapshot)
   select owner_id,item,d.id,jsonb_build_object('id',d.id,'file_sha256',d.file_hash,'media_type',d.media_type,'size_bytes',d.size_bytes) from public.evidence_documents d where d.user_id=owner_id and d.id in(select (value #>> '{}')::uuid from jsonb_array_elements(docs));
  if tx.signed_amount_pence>0 then new_income:=new_income+(decision->>'recognized_pence')::bigint;else new_expense:=new_expense+(decision->>'recognized_pence')::bigint;end if;
  if tx.record_type='income' then old_income:=old_income+tx.recognized_pence;elsif tx.record_type='expense' then old_expense:=old_expense+tx.recognized_pence;end if;
 end loop;
 result:=jsonb_build_object('batch_id',batch,'reviewed',jsonb_array_length(p_entries),'income_before_pence',old_income,'expense_before_pence',old_expense,'income_after_pence',new_income,'expense_after_pence',new_expense);
 insert into public.merchant_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);return result;
end; $$;
revoke all on function public.approve_merchant_batch(jsonb,text,text,uuid) from public,anon,service_role;
grant execute on function public.approve_merchant_batch(jsonb,text,text,uuid) to authenticated;

create function public.reverse_merchant_batch(p_batch uuid,p_stamp text,p_reason text,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); prior public.merchant_requests; payload text; reversal uuid; item public.merchant_review_items; tx public.merchant_transaction_choices; decision jsonb; income bigint:=0;expense bigint:=0;result jsonb;
begin
 if owner_id is null then raise exception 'Sign in to undo reviewed treatment.'; end if;
 if p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Review exact current effects before undo.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 payload:=md5(jsonb_build_array('undo',p_batch,p_stamp,btrim(p_reason))::text);
 select * into prior from public.merchant_requests where user_id=owner_id and request_id=p_request;
 if found then if prior.payload_hash<>payload then raise exception 'Request ID was used for another review.'; end if;return prior.result;end if;
 if not exists(select 1 from public.merchant_review_batches where id=p_batch and user_id=owner_id) or exists(select 1 from public.merchant_review_reversals where batch_id=p_batch and user_id=owner_id) then raise exception 'Active reviewed batch not found.'; end if;
 perform 1 from public.bank_transactions where user_id=owner_id and id in(select transaction_id from public.merchant_review_items where batch_id=p_batch and user_id=owner_id) order by id for update;
 if public.reconciliation_export_stamp() is distinct from p_stamp then raise exception 'Review state changed. Reload current undo effects.'; end if;
 insert into public.merchant_review_reversals(user_id,batch_id,reviewed_stamp,rationale,author,request_id) values(owner_id,p_batch,p_stamp,btrim(p_reason),owner_id,p_request) returning id into reversal;
 for item in select * from public.merchant_review_items where batch_id=p_batch and user_id=owner_id order by transaction_id loop
  select * into tx from public.merchant_transaction_choices where id=item.transaction_id and user_id=owner_id;
  if tx.decision_version is distinct from item.after_version then raise exception 'A decision changed after this batch. Review corrections individually.'; end if;
  decision:=public.review_bank_transaction(tx.id,tx.decision_version,'Unknown',null,0,btrim(p_reason));
  insert into public.merchant_review_undo_items(user_id,reversal_id,item_id,transaction_id,after_version,before_snapshot) values(owner_id,reversal,item.id,tx.id,(decision->>'version')::integer,to_jsonb(tx)-'rule_candidates');
  if tx.record_type='income' then income:=income+tx.recognized_pence;elsif tx.record_type='expense' then expense:=expense+tx.recognized_pence;end if;
 end loop;
 result:=jsonb_build_object('reversal_id',reversal,'removed_income_pence',income,'removed_expense_pence',expense);
 insert into public.merchant_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);return result;
end; $$;
revoke all on function public.reverse_merchant_batch(uuid,text,text,uuid) from public,anon,service_role;
grant execute on function public.reverse_merchant_batch(uuid,text,text,uuid) to authenticated;

-- Classification history remains immutable. Additional provenance is joined by exact decision version.
create view public.merchant_decision_provenance with(security_invoker=true) as
select d.*,coalesce(i.batch_id,original.batch_id) merchant_batch_id,
 coalesce(i.rule_version_id,original.rule_version_id) merchant_rule_version_id,
 case when u.id is not null then 'undo' else i.origin end merchant_origin,
 i.evidence_status review_evidence_status,
 coalesce((select jsonb_agg(e.document_snapshot order by e.document_id) from public.merchant_review_evidence e where e.item_id=coalesce(i.id,original.id) and e.user_id=d.user_id),'[]'::jsonb) linked_documents,
 u.reversal_id merchant_reversal_id
from public.classification_decisions d
left join public.merchant_review_items i on i.transaction_id=d.transaction_id and i.after_version=d.version and i.user_id=d.user_id
left join public.merchant_review_undo_items u on u.transaction_id=d.transaction_id and u.after_version=d.version and u.user_id=d.user_id
left join public.merchant_review_items original on original.id=u.item_id and original.user_id=d.user_id;
revoke all on public.merchant_decision_provenance from public,anon,authenticated,service_role;
grant select on public.merchant_decision_provenance to authenticated,service_role;

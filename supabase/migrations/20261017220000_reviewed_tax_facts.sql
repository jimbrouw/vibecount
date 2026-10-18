-- Tax facts are reviewed inputs, never trading-ledger postings or filing approval.
create table public.tax_review_requests(user_id uuid not null references auth.users(id),request_id uuid not null,payload_hash text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(user_id,request_id));
create table public.tax_profiles(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),tax_year_start integer not null check(tax_year_start between 2000 and 2100),unique(user_id,tax_year_start),unique(id,user_id));
create table public.tax_profile_revisions(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),profile_id uuid not null,ordinal integer not null check(ordinal>0),state text not null check(state in ('provisional','reviewed')),schema_version text not null default 'tax-profile/1' check(schema_version='tax-profile/1'),financial_stamp text not null,data jsonb not null,rationale text not null,author uuid not null references auth.users(id),request_id uuid not null,created_at timestamptz not null default now(),unique(profile_id,ordinal),unique(id,user_id),foreign key(profile_id,user_id) references public.tax_profiles(id,user_id),foreign key(user_id,request_id) references public.tax_review_requests(user_id,request_id) deferrable initially deferred);
create table public.tax_fact_families(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),tax_year_start integer not null check(tax_year_start between 2000 and 2100),kind text not null check(kind in ('employment','termination','pension','other_income','tax_payment','vehicle','gift_aid','trade_adjustment')),label text not null check(length(btrim(label)) between 1 and 120),entity_key text not null,unique(user_id,tax_year_start,kind,entity_key),unique(id,user_id));
create table public.tax_fact_revisions(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),family_id uuid not null,ordinal integer not null check(ordinal>0),state text not null check(state in ('provisional','verified','excluded','withdrawn')),schema_version text not null default 'tax-facts/1' check(schema_version='tax-facts/1'),data jsonb not null,rationale text not null,author uuid not null references auth.users(id),request_id uuid not null,created_at timestamptz not null default now(),unique(family_id,ordinal),unique(id,user_id),foreign key(family_id,user_id) references public.tax_fact_families(id,user_id),foreign key(user_id,request_id) references public.tax_review_requests(user_id,request_id) deferrable initially deferred);
create table public.tax_fact_sources(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),revision_id uuid not null,document_id uuid,transaction_id uuid,record_id uuid,snapshot jsonb not null,check(num_nonnulls(document_id,transaction_id,record_id)=1),unique(revision_id,document_id),unique(revision_id,transaction_id),unique(revision_id,record_id),foreign key(revision_id,user_id) references public.tax_fact_revisions(id,user_id),foreign key(document_id,user_id) references public.evidence_documents(id,user_id),foreign key(transaction_id,user_id) references public.bank_transactions(id,user_id),foreign key(record_id,user_id) references public.financial_records(id,user_id));
create table public.tax_section_attestations(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),tax_year_start integer not null check(tax_year_start between 2000 and 2100),kind text not null check(kind in ('employment','termination','pension','other_income','tax_payment','vehicle','gift_aid','trade_adjustment')),ordinal integer not null check(ordinal>0),verdict text not null check(verdict in ('none','complete')),fact_digest text not null,rationale text not null,author uuid not null references auth.users(id),request_id uuid not null,created_at timestamptz not null default now(),unique(user_id,tax_year_start,kind,ordinal),foreign key(user_id,request_id) references public.tax_review_requests(user_id,request_id) deferrable initially deferred);
create index tax_profile_revision_current on public.tax_profile_revisions(user_id,profile_id,ordinal desc);
create index tax_fact_revision_current on public.tax_fact_revisions(user_id,family_id,ordinal desc);
create index tax_fact_sources_owner on public.tax_fact_sources(user_id,revision_id);
create index tax_sections_current on public.tax_section_attestations(user_id,tax_year_start,kind,ordinal desc);
do $$ declare relation text;begin foreach relation in array array['tax_review_requests','tax_profiles','tax_profile_revisions','tax_fact_families','tax_fact_revisions','tax_fact_sources','tax_section_attestations'] loop
 execute format('alter table public.%I enable row level security',relation);execute format('revoke all on public.%I from public,anon,authenticated,service_role',relation);execute format('grant select on public.%I to authenticated,service_role',relation);execute format('create policy tax_owner_read on public.%I for select to authenticated using(user_id=(select auth.uid()))',relation);execute format('create trigger immutable_tax_input before update or delete on public.%I for each row execute function public.reject_source_mutation()',relation);end loop;end;$$;
create view public.current_tax_profiles with(security_invoker=true) as select v.*,p.tax_year_start,v.financial_stamp=public.reconciliation_export_stamp() ledger_is_current from public.tax_profile_revisions v join public.tax_profiles p on p.id=v.profile_id and p.user_id=v.user_id where not exists(select 1 from public.tax_profile_revisions later where later.profile_id=v.profile_id and later.user_id=v.user_id and later.ordinal>v.ordinal);
create view public.current_tax_facts with(security_invoker=true) as select v.*,f.tax_year_start,f.kind,f.label,f.entity_key from public.tax_fact_revisions v join public.tax_fact_families f on f.id=v.family_id and f.user_id=v.user_id where not exists(select 1 from public.tax_fact_revisions later where later.family_id=v.family_id and later.user_id=v.user_id and later.ordinal>v.ordinal);
revoke all on public.current_tax_profiles,public.current_tax_facts from public,anon,authenticated,service_role;grant select on public.current_tax_profiles,public.current_tax_facts to authenticated,service_role;
create function public.tax_section_digest(p_year integer,p_kind text) returns text language sql stable security invoker set search_path='' as $$ select md5(coalesce(string_agg(id::text||':'||state,',' order by id),'')) from public.current_tax_facts where user_id=(select auth.uid()) and tax_year_start=p_year and kind=p_kind;$$;
revoke all on function public.tax_section_digest(integer,text) from public,anon,service_role;grant execute on function public.tax_section_digest(integer,text) to authenticated;
create view public.current_tax_sections with(security_invoker=true) as select a.*,a.fact_digest=public.tax_section_digest(a.tax_year_start,a.kind) is_current from public.tax_section_attestations a where not exists(select 1 from public.tax_section_attestations later where later.user_id=a.user_id and later.tax_year_start=a.tax_year_start and later.kind=a.kind and later.ordinal>a.ordinal);
revoke all on public.current_tax_sections from public,anon,authenticated,service_role;grant select on public.current_tax_sections to authenticated;
create function public.tax_review_stamp(p_year integer) returns text language sql stable security invoker set search_path='' as $$select md5(public.reconciliation_export_stamp()||'|'||coalesce((select string_agg(v.id::text,',' order by v.id) from public.tax_profile_revisions v join public.tax_profiles p on p.id=v.profile_id and p.user_id=v.user_id where v.user_id=(select auth.uid()) and p.tax_year_start=p_year),'')||'|'||coalesce((select string_agg(v.id::text,',' order by v.id) from public.tax_fact_revisions v join public.tax_fact_families f on f.id=v.family_id and f.user_id=v.user_id where v.user_id=(select auth.uid()) and f.tax_year_start=p_year),'')||'|'||coalesce((select string_agg(id::text,',' order by id) from public.tax_section_attestations where user_id=(select auth.uid()) and tax_year_start=p_year),''));$$;
revoke all on function public.tax_review_stamp(integer) from public,anon,service_role;grant execute on function public.tax_review_stamp(integer) to authenticated;

create function public.tax_fact_schema(p_kind text) returns jsonb language sql immutable set search_path='' as $$ select ('{"employment":[{"key":"taxable_pay_pence","label":"Taxable pay from this employment (not take-home pay)","type":"money"},{"key":"income_tax_withheld_pence","label":"PAYE Income Tax withheld (negative if refunded; exclude NI)","type":"signed_money"},{"key":"class1_band_earnings_pence","label":"Class 1 NICable earnings between the primary threshold and upper earnings limit (blank if unknown)","type":"money","optional":true},{"key":"statement_basis","label":"Statement basis (one employment per fact; do not add cumulative P45 and P60 totals twice)","type":"select","options":["p45_current_employment","p60_year_total","reviewed_corrected_total"]},{"key":"period_start","label":"Period start","type":"date"},{"key":"period_end","label":"Period end","type":"date"}],"termination":[{"key":"gross_pence","label":"Total termination payment","type":"money"},{"key":"taxable_pence","label":"Reviewed taxable component (do not assume all redundancy is exempt)","type":"money"},{"key":"income_tax_withheld_pence","label":"Tax withheld specifically on this component; do not repeat PAYE already recorded","type":"signed_money"},{"key":"payment_date","label":"Payment date","type":"date"},{"key":"treatment","label":"Breakdown review","type":"select","options":["unresolved","evidence_reviewed"]}],"pension":[{"key":"net_paid_pence","label":"Personal amount paid","type":"money"},{"key":"gross_contribution_pence","label":"Gross contribution including provider relief, if applicable","type":"money"},{"key":"method","label":"Contribution/relief method","type":"select","options":["unknown","relief_at_source","net_pay","salary_sacrifice","employer"]},{"key":"period_start","label":"Contribution period start","type":"date"},{"key":"period_end","label":"Contribution period end","type":"date"}],"other_income":[{"key":"income_type","label":"Income type","type":"select","options":["other_non_savings","savings_interest","dividends","property","foreign","pension_income","unknown"]},{"key":"gross_pence","label":"Gross other income","type":"money"},{"key":"income_tax_withheld_pence","label":"Income Tax already withheld","type":"signed_money"},{"key":"payment_date","label":"Receipt date","type":"date"}],"tax_payment":[{"key":"payment_reference","label":"Safe payment identity, such as HMRC statement item 3 (never your UTR or account number)","type":"text"},{"key":"paid_total_pence","label":"Total physical payment shown on evidence","type":"money"},{"key":"allocated_pence","label":"Amount allocated to this tax year and liability","type":"money"},{"key":"allocation_type","label":"Liability allocation","type":"select","options":["first_payment_on_account","second_payment_on_account","balancing_payment","other_reviewed_credit"]},{"key":"payment_date","label":"Actual payment date (may be outside this tax year)","type":"date"}],"vehicle":[{"key":"vehicle_type","label":"Vehicle type","type":"select","options":["car","van","motorcycle","bicycle","ebike"]},{"key":"method","label":"Expense method election","type":"select","options":["unknown","actual_costs","simplified_mileage"]},{"key":"business_use_bps","label":"Reviewed business-use percentage","type":"percent"},{"key":"business_miles_hundredths","label":"Evidenced business miles (blank if unknown)","type":"miles","optional":true},{"key":"period_start","label":"Election period start","type":"date"},{"key":"period_end","label":"Election period end","type":"date"}],"gift_aid":[{"key":"net_donation_pence","label":"Personal Gift Aid donation paid (never a trading expense)","type":"money"},{"key":"payment_date","label":"Donation date","type":"date"}],"trade_adjustment":[{"key":"adjustment_type","label":"Adjustment type requiring tax review","type":"select","options":["add_back","capital_allowance","loss_brought_forward","other_deduction","trading_allowance"]},{"key":"amount_pence","label":"Adjustment magnitude","type":"money"},{"key":"treatment","label":"Eligibility review","type":"select","options":["unresolved","evidence_reviewed"]}]}'::jsonb)->p_kind;$$;
revoke all on function public.tax_fact_schema(text) from public,anon,authenticated,service_role;

create function public.tax_profile_schema() returns jsonb language sql immutable set search_path='' as $$ select '{"jurisdiction":["unknown","england_wales_ni","scotland"],"accounting_basis":["unknown","cash","traditional"],"business_structure":["unknown","sole_trader","partnership","company"],"vat_registered":["unknown","yes","no"],"student_loan":["unknown","none","plan1","plan2","plan4","plan5","postgraduate","multiple"],"residency":["unknown","uk_full_year","other"],"special_reliefs":["unknown","none","present"],"ledger_completeness":["unreviewed","complete"]}'::jsonb;$$;
revoke all on function public.tax_profile_schema() from public,anon,authenticated,service_role;
create function public.validate_tax_input(p_kind text,p_data jsonb,p_year integer,p_state text) returns void language plpgsql set search_path='' as $$
declare fields jsonb;f jsonb;k text;v jsonb;t text;d date;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Review typed tax inputs.';end if;
 if p_kind='profile' then
  fields:=public.tax_profile_schema();
  if (select count(*) from jsonb_object_keys(p_data))<>(select count(*) from jsonb_object_keys(fields)) then raise exception 'Review every profile answer.';end if;
  for k,v in select * from jsonb_each(p_data) loop
   if not fields?k or jsonb_typeof(v)<>'string' or not (fields->k)?(v#>>'{}') then raise exception 'Unsupported profile answer.';end if;
   if p_state='reviewed' and (v#>>'{}') in ('unknown','unreviewed') then raise exception 'Unknown profile answers remain provisional.';end if;
  end loop;return;
 end if;
 fields:=public.tax_fact_schema(p_kind);if fields is null then raise exception 'Choose a supported tax fact.';end if;
 if exists(select 1 from jsonb_object_keys(p_data) key where not exists(select 1 from jsonb_array_elements(fields) field where field->>'key'=key)) then raise exception 'Unexpected tax fact fields.';end if;
 for f in select * from jsonb_array_elements(fields) loop
  k:=f->>'key';v:=p_data->k;t:=f->>'type';
  if v is null or v='null'::jsonb then if coalesce((f->>'optional')::boolean,false) then continue;end if;raise exception 'Missing required fact: %',k;end if;
  if t in ('money','signed_money','percent','miles') then
   if jsonb_typeof(v)<>'number' or (v#>>'{}') !~ '^-?[0-9]+$' or abs((v#>>'{}')::numeric)>999999999999 or (t<>'signed_money' and (v#>>'{}')::numeric<0) or (t='percent' and (v#>>'{}')::numeric>10000) then raise exception 'Invalid exact value: %',k;end if;
  else
   if jsonb_typeof(v)<>'string' then raise exception 'Invalid text value: %',k;end if;
   if t='select' and not (f->'options')?(v#>>'{}') then raise exception 'Unsupported choice: %',k;end if;
   if t='text' and length(btrim(v#>>'{}')) not between 1 and 120 then raise exception 'Review safe identity label.';end if;
   if t='date' then
    if (v#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Choose ISO dates.';end if;d:=(v#>>'{}')::date;
    if p_kind<>'tax_payment' and (d<make_date(p_year,4,6) or d>make_date(p_year+1,4,5)) then raise exception 'Fact dates must belong to selected tax year.';end if;
   end if;
  end if;
 end loop;
 if p_data->>'period_end'<p_data->>'period_start' then raise exception 'Review period order.';end if;
 if p_kind='termination' and (p_data->>'taxable_pence')::bigint>(p_data->>'gross_pence')::bigint then raise exception 'Taxable component exceeds gross payment.';end if;
 if p_kind='pension' and (p_data->>'gross_contribution_pence')::bigint<(p_data->>'net_paid_pence')::bigint then raise exception 'Gross contribution is below personal payment.';end if;
 if p_kind='tax_payment' and ((p_data->>'allocated_pence')::bigint>(p_data->>'paid_total_pence')::bigint or (p_data->>'allocated_pence')::bigint<=0) then raise exception 'Review physical payment and allocation.';end if;
 if p_kind='vehicle' and p_data->>'method'='simplified_mileage' and p_data->>'vehicle_type' in ('bicycle','ebike') then raise exception 'Employee bicycle mileage is not a sole-trader simplified expense method.';end if;
 if p_state='verified' and ((p_kind='pension' and p_data->>'method'='unknown') or (p_kind='vehicle' and (p_data->>'method'='unknown' or (p_data->>'business_use_bps')::int<=0 or (p_data->>'method'='simplified_mileage' and coalesce(p_data->>'business_miles_hundredths','')=''))) or (p_kind in ('termination','trade_adjustment') and p_data->>'treatment'<>'evidence_reviewed') or (p_kind='other_income' and p_data->>'income_type'='unknown')) then raise exception 'Resolve tax treatment before verifying this fact.';end if;
end;$$;
revoke all on function public.validate_tax_input(text,jsonb,integer,text) from public,anon,authenticated,service_role;

create function public.review_tax_inputs(p_year integer,p_review jsonb,p_stamp text,p_reason text,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
<<tax_review>>
declare owner_id uuid:=auth.uid();prior public.tax_review_requests;payload text;action text;allowed text[];kind text;state text;label text;revision uuid;family public.tax_fact_families;previous public.tax_fact_revisions;profile public.tax_profiles;prev_profile public.tax_profile_revisions;expected integer;doc_ids jsonb;tx_ids jsonb;record_ids jsonb;ids jsonb;source_kind text;source_id uuid;source_snapshot jsonb;result jsonb;verdict text;ordinal integer;total bigint;other_total bigint;
begin
 if owner_id is null then raise exception 'Sign in to review tax facts.';end if;
 if p_year is null or p_year not between 2000 and 2100 or p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 or jsonb_typeof(p_review) is distinct from 'object' then raise exception 'Review tax year, typed facts and rationale.';end if;
 if p_review->>'action'='fact' and p_review->>'kind'='tax_payment' and jsonb_typeof(p_review->'data'->'payment_reference')='string' then p_review:=jsonb_set(p_review,'{data,payment_reference}',to_jsonb(public.merchant_match_key(p_review->'data'->>'payment_reference')));end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 payload:=md5(jsonb_build_array(p_year,p_review,p_stamp,btrim(p_reason))::text);select * into prior from public.tax_review_requests where user_id=owner_id and request_id=p_request;
 if found then if prior.payload_hash<>payload then raise exception 'Request ID was used for a different tax review.';end if;return prior.result;end if;
 if public.tax_review_stamp(p_year) is distinct from p_stamp then raise exception 'Tax or financial inputs changed. Reload review.';end if;
 action:=p_review->>'action';
 allowed:=case action when 'profile' then array['action','expected_ordinal','data','state'] when 'fact' then array['action','family_id','expected_ordinal','kind','label','data','state','document_ids','transaction_ids','record_ids'] when 'section' then array['action','kind','verdict'] else null end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p_review) key where not key=any(allowed)) then raise exception 'Choose one supported review action.';end if;
 if action='profile' then
  state:=p_review->>'state';expected:=(p_review->>'expected_ordinal')::int;
  if state is null or state not in ('provisional','reviewed') then raise exception 'Choose profile review state.';end if;
  perform public.validate_tax_input('profile',p_review->'data',p_year,state);
  select * into profile from public.tax_profiles where user_id=owner_id and tax_year_start=p_year;
  if profile.id is null then insert into public.tax_profiles(user_id,tax_year_start) values(owner_id,p_year) returning * into profile;end if;
  select * into prev_profile from public.tax_profile_revisions where profile_id=profile.id and user_id=owner_id order by ordinal desc limit 1;
  if coalesce(prev_profile.ordinal,0) is distinct from expected then raise exception 'Profile revision changed.';end if;
  ordinal:=coalesce(prev_profile.ordinal,0)+1;
  insert into public.tax_profile_revisions(user_id,profile_id,ordinal,state,financial_stamp,data,rationale,author,request_id) values(owner_id,profile.id,ordinal,state,public.reconciliation_export_stamp(),p_review->'data',btrim(p_reason),owner_id,p_request) returning id into revision;
  result:=jsonb_build_object('profile_id',profile.id,'revision_id',revision,'ordinal',ordinal,'new_postings',0);
 elsif action='fact' then
  kind:=p_review->>'kind';state:=p_review->>'state';label:=btrim(p_review->>'label');expected:=(p_review->>'expected_ordinal')::int;
  if state is null or state not in ('provisional','verified','excluded','withdrawn') or label is null or length(label) not between 1 and 120 then raise exception 'Review fact identity and state.';end if;
  perform public.validate_tax_input(kind,p_review->'data',p_year,state);
  if nullif(p_review->>'family_id','') is null then
   if expected is distinct from 0 or state='withdrawn' then raise exception 'New facts start at revision zero and cannot be withdrawn.';end if;
   insert into public.tax_fact_families(user_id,tax_year_start,kind,label,entity_key) values(owner_id,p_year,kind,label,public.merchant_match_key(label)) returning * into family;
  else
   select * into family from public.tax_fact_families where id=(p_review->>'family_id')::uuid and user_id=owner_id and tax_year_start=p_year and tax_fact_families.kind=tax_review.kind;
   if family.id is null or family.label<>label then raise exception 'Owned fact identity not found.';end if;
   select * into previous from public.tax_fact_revisions where family_id=family.id and user_id=owner_id order by ordinal desc limit 1;
   if previous.ordinal is distinct from expected then raise exception 'Fact revision changed.';end if;
   if state='withdrawn' and p_review->'data' is distinct from previous.data then raise exception 'Withdrawal must retain exact prior values for audit.';end if;
   if kind='tax_payment' and (p_review->'data'->>'payment_reference' is distinct from previous.data->>'payment_reference' or p_review->'data'->>'payment_date' is distinct from previous.data->>'payment_date' or p_review->'data'->>'paid_total_pence' is distinct from previous.data->>'paid_total_pence') then raise exception 'Physical payment identity is immutable. Withdraw and review a new identity to correct it.';end if;

  end if;
  doc_ids:=coalesce(p_review->'document_ids','[]'::jsonb);tx_ids:=coalesce(p_review->'transaction_ids','[]'::jsonb);record_ids:=coalesce(p_review->'record_ids','[]'::jsonb);
  foreach source_kind in array array['document','transaction','record'] loop
   ids:=case source_kind when 'document' then doc_ids when 'transaction' then tx_ids else record_ids end;
   if jsonb_typeof(ids) is distinct from 'array' then raise exception 'Choose explicit owned source IDs.';end if;
   if jsonb_array_length(ids)>50 or (select count(distinct value#>>'{}') from jsonb_array_elements(ids))<>jsonb_array_length(ids) then raise exception 'Choose distinct bounded sources.';end if;
  end loop;
  if state='verified' and (jsonb_array_length(doc_ids)+jsonb_array_length(tx_ids)+jsonb_array_length(record_ids)=0 or ((kind in ('employment','termination','pension') or (kind='vehicle' and p_review->'data'->>'method'='simplified_mileage')) and jsonb_array_length(doc_ids)=0)) then raise exception 'Verified facts require source evidence; employment, termination and pension need documents.';end if;
  if kind='tax_payment' and jsonb_array_length(tx_ids)>1 then raise exception 'Allocate one physical bank payment per fact.';end if;
  perform 1 from public.bank_transactions t where t.user_id=owner_id and t.id in(select (value#>>'{}')::uuid from jsonb_array_elements(tx_ids)) order by t.id for share;
  perform 1 from public.financial_records f where f.user_id=owner_id and (f.id in(select (value#>>'{}')::uuid from jsonb_array_elements(record_ids)) or f.bank_transaction_id in(select (value#>>'{}')::uuid from jsonb_array_elements(tx_ids))) order by f.id for share;
  if public.tax_review_stamp(p_year) is distinct from p_stamp then raise exception 'Tax or financial inputs changed. Reload review.';end if;
  if state='withdrawn' and exists(select 1 from (select coalesce(jsonb_agg(document_id::text order by document_id),'[]'::jsonb) docs from public.tax_fact_sources where revision_id=previous.id and user_id=owner_id and document_id is not null) d,(select coalesce(jsonb_agg(transaction_id::text order by transaction_id),'[]'::jsonb) txs from public.tax_fact_sources where revision_id=previous.id and user_id=owner_id and transaction_id is not null) t,(select coalesce(jsonb_agg(record_id::text order by record_id),'[]'::jsonb) records from public.tax_fact_sources where revision_id=previous.id and user_id=owner_id and record_id is not null) r where d.docs<>(select coalesce(jsonb_agg(value order by value),'[]'::jsonb) from jsonb_array_elements(doc_ids)) or t.txs<>(select coalesce(jsonb_agg(value order by value),'[]'::jsonb) from jsonb_array_elements(tx_ids)) or r.records<>(select coalesce(jsonb_agg(value order by value),'[]'::jsonb) from jsonb_array_elements(record_ids))) then raise exception 'Withdrawal must retain the exact prior source set.';end if;
  ordinal:=coalesce(previous.ordinal,0)+1;
  insert into public.tax_fact_revisions(user_id,family_id,ordinal,state,data,rationale,author,request_id) values(owner_id,family.id,ordinal,state,p_review->'data',btrim(p_reason),owner_id,p_request) returning id into revision;
  if state='withdrawn' then
   insert into public.tax_fact_sources(user_id,revision_id,document_id,transaction_id,record_id,snapshot) select owner_id,revision,document_id,transaction_id,record_id,snapshot from public.tax_fact_sources where revision_id=previous.id and user_id=owner_id;
  else
  foreach source_kind in array array['document','transaction','record'] loop
   ids:=case source_kind when 'document' then doc_ids when 'transaction' then tx_ids else record_ids end;
   for source_id in select (value#>>'{}')::uuid from jsonb_array_elements(ids) loop
    source_snapshot:=null;
    if source_kind='document' then
     select jsonb_build_object('id',d.id,'file_sha256',d.file_hash,'media_type',d.media_type,'size_bytes',d.size_bytes) into source_snapshot from public.evidence_documents d where d.id=source_id and d.user_id=owner_id;
    elsif source_kind='transaction' then
     select jsonb_build_object('id',t.id,'import_id',t.import_id,'source_row_id',t.source_row_id,'file_sha256',t.file_hash,'row_sha256',t.row_hash,'row_number',t.row_number,'transaction_date',t.transaction_date,'signed_amount_pence',t.signed_amount_pence,'currency',t.currency,'classification',t.classification,'decision_version',t.decision_version,'recognized_pence',t.recognized_pence,'account_label',t.account_label,'account_mask',t.account_mask) into source_snapshot from public.duplicate_review_transactions t where t.id=source_id and t.user_id=owner_id and t.import_status<>'discarded' and t.dedupe_status='clear';
    else
     select jsonb_build_object('id',f.id,'record_type',f.record_type,'amount',f.amount,'effect_sign',f.effect_sign,'record_date',f.record_date,'tax_year_start',f.tax_year_start,'status',f.status,'bank_transaction_id',f.bank_transaction_id) into source_snapshot from public.financial_records f where f.id=source_id and f.user_id=owner_id and f.status='approved';
    end if;
    if source_snapshot is null then raise exception 'Owned active source not found.';end if;
    if source_kind='record' and kind='vehicle' and (source_snapshot->>'record_type'<>'expense' or (source_snapshot->>'tax_year_start')::integer<>p_year) then raise exception 'Vehicle costs require approved expense records in this tax year.';end if;
    insert into public.tax_fact_sources(user_id,revision_id,document_id,transaction_id,record_id,snapshot) values(owner_id,revision,case when source_kind='document' then source_id end,case when source_kind='transaction' then source_id end,case when source_kind='record' then source_id end,source_snapshot);
   end loop;
  end loop;
  end if;
  if kind='vehicle' and state='verified' and exists(select 1 from public.current_tax_facts v join public.tax_fact_sources s on s.revision_id=v.id and s.user_id=v.user_id where v.user_id=owner_id and v.kind='vehicle' and v.state='verified' and v.family_id<>family.id and s.record_id in(select (value#>>'{}')::uuid from jsonb_array_elements(record_ids))) then raise exception 'Actual-cost record already belongs to another reviewed vehicle.';end if;
  if kind='tax_payment' and state='verified' then
   total:=(p_review->'data'->>'paid_total_pence')::bigint;
   if jsonb_array_length(doc_ids)+jsonb_array_length(tx_ids)=0 then raise exception 'Actual tax payment needs document or bank evidence, not a reserve or ledger assertion.';end if;
   if jsonb_array_length(tx_ids)=1 and not exists(select 1 from public.bank_transactions t where t.user_id=owner_id and t.id=(tx_ids->>0)::uuid and t.signed_amount_pence=-total and t.transaction_date=(p_review->'data'->>'payment_date')::date) then raise exception 'Physical payment amount/date differs from bank evidence.';end if;
   if exists(select 1 from public.current_tax_facts v where v.user_id=owner_id and v.kind='tax_payment' and v.state='verified' and v.family_id<>family.id and ((v.data->>'payment_date'=p_review->'data'->>'payment_date' and public.merchant_match_key(v.data->>'payment_reference')=public.merchant_match_key(p_review->'data'->>'payment_reference')) or exists(select 1 from public.tax_fact_sources s where s.user_id=owner_id and s.revision_id=v.id and s.transaction_id=(tx_ids->>0)::uuid)) and (v.data->>'paid_total_pence')::bigint<>total) then raise exception 'Physical payment total must agree across allocations.';end if;
   select coalesce(sum((v.data->>'allocated_pence')::bigint),0) into other_total from public.current_tax_facts v where v.user_id=owner_id and v.kind='tax_payment' and v.state='verified' and v.family_id<>family.id and ((v.data->>'payment_date'=p_review->'data'->>'payment_date' and public.merchant_match_key(v.data->>'payment_reference')=public.merchant_match_key(p_review->'data'->>'payment_reference')) or exists(select 1 from public.tax_fact_sources s where s.user_id=owner_id and s.revision_id=v.id and s.transaction_id=(tx_ids->>0)::uuid));
   if other_total+(p_review->'data'->>'allocated_pence')::bigint>total then raise exception 'Physical tax payment is already allocated; do not count reserve cash or spend it twice.';end if;
  end if;
  result:=jsonb_build_object('family_id',family.id,'revision_id',revision,'ordinal',ordinal,'new_postings',0);
 else
  kind:=p_review->>'kind';verdict:=p_review->>'verdict';
  if public.tax_fact_schema(kind) is null or verdict is null or verdict not in ('none','complete') then raise exception 'Choose a supported completeness answer.';end if;
  if verdict='none' and exists(select 1 from public.current_tax_facts v where v.user_id=owner_id and v.tax_year_start=p_year and v.kind=tax_review.kind and v.state<>'withdrawn') then raise exception 'None conflicts with active facts. Review or withdraw them explicitly.';end if;
  if verdict='complete' and (not exists(select 1 from public.current_tax_facts v where v.user_id=owner_id and v.tax_year_start=p_year and v.kind=tax_review.kind and v.state<>'withdrawn') or exists(select 1 from public.current_tax_facts v where v.user_id=owner_id and v.tax_year_start=p_year and v.kind=tax_review.kind and v.state='provisional')) then raise exception 'Review all provisional facts before confirming the collection complete.';end if;
  select coalesce(max(a.ordinal),0)+1 into ordinal from public.tax_section_attestations a where a.user_id=owner_id and a.tax_year_start=p_year and a.kind=tax_review.kind;
  insert into public.tax_section_attestations(user_id,tax_year_start,kind,ordinal,verdict,fact_digest,rationale,author,request_id) values(owner_id,p_year,kind,ordinal,verdict,public.tax_section_digest(p_year,kind),btrim(p_reason),owner_id,p_request) returning id into revision;
  result:=jsonb_build_object('attestation_id',revision,'ordinal',ordinal,'new_postings',0);
 end if;
 insert into public.tax_review_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);return result;
end;$$;
revoke all on function public.review_tax_inputs(integer,jsonb,text,text,uuid) from public,anon,service_role;grant execute on function public.review_tax_inputs(integer,jsonb,text,text,uuid) to authenticated;

-- Current source effect is separate from the immutable snapshot reviewed with the fact.
create view public.tax_fact_source_status with(security_invoker=true) as
select s.*,v.tax_year_start,v.kind,v.state fact_state,
 case when s.transaction_id is not null then coalesce(t.recognized_pence,0) when f.status='approved' then (f.amount*100*f.effect_sign)::bigint else 0 end current_recognized_pence,
 case when s.transaction_id is not null then t.import_status='discarded' or t.dedupe_status<>'clear' or t.decision_version<>(s.snapshot->>'decision_version')::integer when s.record_id is not null then f.status<>'approved' or f.amount<>(s.snapshot->>'amount')::numeric or f.record_type<>s.snapshot->>'record_type' or f.record_date<>(s.snapshot->>'record_date')::date or f.effect_sign<>(s.snapshot->>'effect_sign')::integer else false end source_unresolved
from public.tax_fact_sources s join public.current_tax_facts v on v.id=s.revision_id and v.user_id=s.user_id
left join public.duplicate_review_transactions t on t.id=s.transaction_id and t.user_id=s.user_id
left join public.financial_records f on f.id=s.record_id and f.user_id=s.user_id;
revoke all on public.tax_fact_source_status from public,anon,authenticated,service_role;grant select on public.tax_fact_source_status to authenticated;
create view public.tax_fact_history with(security_invoker=true) as select v.*,f.tax_year_start,f.kind,f.label from public.tax_fact_revisions v join public.tax_fact_families f on f.id=v.family_id and f.user_id=v.user_id;
create view public.tax_fact_source_history with(security_invoker=true) as select s.*,v.tax_year_start,v.kind,v.family_id,v.ordinal from public.tax_fact_sources s join public.tax_fact_history v on v.id=s.revision_id and v.user_id=s.user_id;
revoke all on public.tax_fact_history,public.tax_fact_source_history from public,anon,authenticated,service_role;grant select on public.tax_fact_history,public.tax_fact_source_history to authenticated;
create view public.tax_profile_history with(security_invoker=true) as select v.*,p.tax_year_start from public.tax_profile_revisions v join public.tax_profiles p on p.id=v.profile_id and p.user_id=v.user_id;
revoke all on public.tax_profile_history from public,anon,authenticated,service_role;grant select on public.tax_profile_history to authenticated;

-- Annual rollover saves reviewed suggestions only. Prior-year rules and transaction decisions remain intact.
alter table public.merchant_rule_versions add constraint merchant_version_family_owner unique(id,rule_id,user_id);
create table public.merchant_rule_rollovers (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),source_rule_id uuid not null,source_version_id uuid not null,
 target_rule_id uuid not null,target_version_id uuid not null,target_tax_year_start integer not null check(target_tax_year_start between 2001 and 2100),
 reviewed_stamp text not null,rationale text not null check(length(btrim(rationale)) between 1 and 1000),author uuid not null references auth.users(id),
 request_id uuid not null,created_at timestamptz not null default now(),unique(id,user_id),unique(user_id,request_id),unique(user_id,source_rule_id,target_tax_year_start),unique(target_version_id),
 check(source_rule_id<>target_rule_id),check(author=user_id),
 foreign key(source_version_id,source_rule_id,user_id) references public.merchant_rule_versions(id,rule_id,user_id),
 foreign key(target_version_id,target_rule_id,user_id) references public.merchant_rule_versions(id,rule_id,user_id),
 foreign key(user_id,request_id) references public.merchant_requests(user_id,request_id) deferrable initially deferred
);
alter table public.merchant_rule_rollovers enable row level security;
revoke all on public.merchant_rule_rollovers from public,anon,authenticated,service_role;
grant select on public.merchant_rule_rollovers to authenticated,service_role;
create policy merchant_rollover_owner_read on public.merchant_rule_rollovers for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_merchant_rollover before update or delete on public.merchant_rule_rollovers for each row execute function public.reject_source_mutation();

create function public.rollover_merchant_rule(p_source_version uuid,p_target_year integer,p_definition jsonb,p_stamp text,p_reason text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();prior public.merchant_requests;payload text;source public.current_merchant_rules;seed public.duplicate_review_transactions;
 result jsonb;created jsonb;new_request uuid:=gen_random_uuid();first_date date;last_date date;account uuid;
begin
 if owner_id is null then raise exception 'Sign in to review annual rollover.';end if;
 if p_source_version is null or p_target_year is null or p_target_year not between 2001 and 2100 or p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000
 or jsonb_typeof(p_definition) is distinct from 'object' or p_stamp is null or p_stamp!~'^[a-f0-9]{32}$' then raise exception 'Review the complete rollover and reason.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 payload:=encode(sha256(convert_to(jsonb_build_array('annual-rollover/1',p_source_version,p_target_year,p_definition,p_stamp,btrim(p_reason))::text,'UTF8')),'hex');
 select * into prior from public.merchant_requests where user_id=owner_id and request_id=p_request;
 if found then if prior.payload_hash<>payload then raise exception 'Request ID used for different rollover.';end if;return prior.result;end if;
 perform 1 from public.record_categories where user_id=owner_id or (user_id is null and is_default) order by id for share;
 if public.reconciliation_export_stamp() is distinct from p_stamp then raise exception 'Rollover review changed. Reload source and target rules.';end if;
 select * into source from public.current_merchant_rules where id=p_source_version and user_id=owner_id;
 if not found or source.status<>'active' or source.tax_year_start is null or source.tax_year_start+1<>p_target_year or not source.category_valid then raise exception 'Review latest active, year-scoped source rule and category.';end if;
 select * into seed from public.duplicate_review_transactions where id=source.seed_transaction_id and user_id=owner_id;
 if not found or seed.import_status='discarded' or seed.dedupe_status<>'clear' then raise exception 'Source evidence needs identity/recovery review before rollover.';end if;
 if (select count(*) from jsonb_object_keys(p_definition))<>11 or not(p_definition ?& array['seed_id','status','account_id','tax_year_start','effective_from','expires_on','priority','classification','business_use_bps','category_id','evidence_status'])
 then raise exception 'Review exact rollover definition fields.';end if;
 account:=nullif(p_definition->>'account_id','')::uuid;
 if (p_definition->>'tax_year_start')::integer is distinct from p_target_year or account is distinct from source.account_id
 or (p_definition->>'seed_id')::uuid is distinct from source.seed_transaction_id then raise exception 'Rollover retains source identity/account and uses the explicit target year.';end if;
 if coalesce(p_definition->>'effective_from','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or coalesce(p_definition->>'expires_on','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Use explicit target-year start and expiry dates.';end if;
 first_date:=(p_definition->>'effective_from')::date;last_date:=(p_definition->>'expires_on')::date;
 if first_date<make_date(p_target_year,4,6) or first_date>make_date(p_target_year+1,4,5) or last_date<first_date or last_date>make_date(p_target_year+1,4,5) then raise exception 'Rollover dates must stay inside the target tax year.';end if;
 if exists(select 1 from public.merchant_rule_rollovers where user_id=owner_id and source_rule_id=source.rule_id and target_tax_year_start=p_target_year) then raise exception 'This source already rolled over. Review the target rule instead.';end if;
 if exists(select 1 from public.current_merchant_rules r where r.user_id=owner_id and r.status='active' and r.match_key=source.match_key and r.record_type=source.record_type
 and (r.tax_year_start is null or r.tax_year_start=p_target_year) and (r.account_id is null or account is null or r.account_id=account)
 and r.effective_from<=last_date and (r.expires_on is null or r.expires_on>=first_date)) then raise exception 'An existing target-year rule overlaps. Review it instead.';end if;
 created:=public.save_merchant_rule(null,0,p_definition,p_stamp,btrim(p_reason),new_request);
 insert into public.merchant_rule_rollovers(user_id,source_rule_id,source_version_id,target_rule_id,target_version_id,target_tax_year_start,reviewed_stamp,rationale,author,request_id)
 values(owner_id,source.rule_id,source.id,(created->>'rule_id')::uuid,(created->>'version_id')::uuid,p_target_year,p_stamp,btrim(p_reason),owner_id,p_request);
 result:=created||jsonb_build_object('source_version_id',source.id,'target_tax_year_start',p_target_year,'new_postings',0);
 insert into public.merchant_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);
 return result;
end;$$;
revoke all on function public.rollover_merchant_rule(uuid,integer,jsonb,text,text,uuid) from public,anon,service_role;
grant execute on function public.rollover_merchant_rule(uuid,integer,jsonb,text,text,uuid) to authenticated;
-- Every rollover inserts a merchant_rule_version atomically. The existing financial stamp already covers that insertion.

-- Complete raw-source coverage and native decision fences. Foreign admission remains closed.
create function public.bank_observation_is_native(p_owner uuid,p_id uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.bank_transactions t join public.financial_accounts a on a.id=t.account_id and a.user_id=t.user_id
 where t.user_id=p_owner and t.id=p_id and a.currency='GBP' and t.currency='GBP' and t.signed_amount_pence is not null
 and t.signed_amount_pence<>0 and t.signed_amount_pence between -999999999999 and 999999999999
 and t.original_signed_minor is null and t.source_units_ruleset is null);
$$;
revoke all on function public.bank_observation_is_native(uuid,uuid) from public,anon,authenticated,service_role;
create function public.assert_native_bank_scope(p_owner uuid,p_ids uuid[]) returns void language plpgsql set search_path='' as $$
begin
 if p_owner is null or p_ids is null or cardinality(p_ids)>20000 or array_position(p_ids,null) is not null
 or cardinality(p_ids)<>(select count(distinct id) from unnest(p_ids) id) then raise exception 'Choose complete owned native bank sources.';end if;
 perform 1 from public.bank_transactions t join public.financial_accounts a on a.id=t.account_id and a.user_id=t.user_id
 where t.user_id=p_owner and t.id=any(p_ids) order by t.id for share of t,a;
 if(select count(*) from public.bank_transactions t where t.user_id=p_owner and t.id=any(p_ids) and public.bank_observation_is_native(p_owner,t.id))<>cardinality(p_ids)
 then raise exception 'Native review requires actual GBP bank cash. Foreign or invalid sources need the complete valuation workflow.';end if;
end;$$;
revoke all on function public.assert_native_bank_scope(uuid,uuid[]) from public,anon,authenticated,service_role;

create function public.bank_source_coverage_for_owner(p_owner uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb;payload jsonb;
begin
 if p_owner is null then raise exception 'Choose owned bank source coverage.';end if;
 if(select count(*) from public.bank_transactions where user_id=p_owner)>20000 or(select count(*) from public.financial_accounts where user_id=p_owner)>2000
 then raise exception 'Complete bank source coverage exceeds the safe row limit.';end if;
 with accounts as materialized(
  select a.id,a.currency,case when a.currency='GBP' then 'native_gbp' when a.currency in('USD','EUR','JPY','KWD') then 'foreign' else 'invalid' end representation
  from public.financial_accounts a where a.user_id=p_owner
 ),sources as materialized(
  select t.*,i.status import_status,i.file_hash source_file_sha256,r.row_hash source_row_sha256,i.parser_version source_parser_version,
   (a.id is not null and i.id is not null and r.id is not null and f.id is not null and i.account_id=t.account_id and r.import_id=t.import_id
    and f.account_id=t.account_id and f.file_hash=i.file_hash and a.currency=t.currency) source_complete,
   exists(select 1 from storage.objects o where o.bucket_id='source-evidence' and o.name=f.object_path) source_available,
   case when public.bank_observation_is_native(p_owner,t.id) then 'native_gbp'
    when t.currency in('USD','EUR','JPY','KWD') and t.signed_amount_pence is null and t.original_signed_minor is not null and t.original_signed_minor<>0
     and t.original_signed_minor between -999999999999 and 999999999999 and t.source_units_ruleset='vibecount-currencies/1' and a.currency=t.currency and i.parser_version='mapped-csv/2' then 'foreign' else 'invalid' end units,
   v.id valuation_id,v.family_id,v.ordinal,v.state valuation_state,v.signed_gbp_pence,
   case when v.id is not null then public.bank_valuation_source_current(p_owner,v.id) else false end valuation_current
  from public.bank_transactions t
  left join public.financial_accounts a on a.id=t.account_id and a.user_id=t.user_id
  left join public.record_imports i on i.id=t.import_id and i.user_id=t.user_id
  left join public.source_rows r on r.id=t.source_row_id and r.user_id=t.user_id
  left join public.record_source_files f on f.id=i.source_file_id and f.user_id=t.user_id
  left join lateral(select r.* from public.bank_valuation_families vf join public.bank_valuation_revisions r on r.family_id=vf.id and r.user_id=vf.user_id
   where vf.user_id=t.user_id and vf.transaction_id=t.id order by r.ordinal desc limit 1)v on true
  where t.user_id=p_owner
 ),rows as materialized(
  select s.id,s.account_id,s.import_id,s.source_row_id,s.transaction_date cash_date,s.tax_year_start,s.currency,
   s.signed_amount_pence::text signed_amount_pence,s.original_signed_minor::text original_signed_minor,s.source_units_ruleset ruleset_id,
   s.import_status,s.classification,s.dedupe_status,s.decision_version,s.source_complete,s.source_available,
   s.source_file_sha256 file_sha256,s.source_row_sha256 row_sha256,s.source_parser_version parser_version,
   case when s.source_complete then s.units else 'invalid' end representation,
   case when s.units='invalid' or not s.source_complete then 'invalid' when s.units='native_gbp' then 'not_applicable'
    when s.valuation_id is null then 'unvalued' when s.valuation_state='provisional' then 'provisional' when s.valuation_state='withdrawn' then 'withdrawn'
    when not s.valuation_current then 'stale' when s.signed_gbp_pence=0 then 'reviewed_zero' else 'reviewed' end valuation_status,
   case when s.valuation_id is not null then jsonb_build_object('id',s.valuation_id,'family_id',s.family_id,'ordinal',s.ordinal,'state',s.valuation_state,'signed_gbp_pence',s.signed_gbp_pence::text,'source_current',s.valuation_current) end valuation,
   (select count(*) from public.financial_records f where f.user_id=p_owner and f.bank_transaction_id=s.id and f.status='approved') approved_record_count
  from sources s
 )
 select jsonb_build_object('schema_version','vibecount.bank-source-coverage/1','scope','all_owned_accounts_and_observations; original_units_are_not_gbp_valuation_or_tax_acceptance','owner_id',p_owner,
 'counts',jsonb_build_object('accounts',(select count(*) from accounts),'native_accounts',(select count(*) from accounts where representation='native_gbp'),'foreign_accounts',(select count(*) from accounts where representation='foreign'),'invalid_accounts',(select count(*) from accounts where representation='invalid'),
 'observations',(select count(*) from rows),'native_observations',(select count(*) from rows where representation='native_gbp'),'foreign_observations',(select count(*) from rows where representation='foreign'),'invalid_observations',(select count(*) from rows where representation='invalid'),
 'active_blocked_observations',(select count(*) from rows where import_status is distinct from 'discarded' and representation<>'native_gbp'),'reviewed_zero_observations',(select count(*) from rows where valuation_status='reviewed_zero')),
 'accounts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from accounts a),'observations',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from rows r)) into payload;
 result:=payload||jsonb_build_object('stamp',encode(sha256(convert_to(payload::text,'UTF8')),'hex'));
 if octet_length(result::text)>2000000 then raise exception 'Complete bank source coverage exceeds the safe payload limit.';end if;return result;
end;$$;
revoke all on function public.bank_source_coverage_for_owner(uuid) from public,anon,authenticated,service_role;
create function public.read_bank_source_coverage() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin if auth.uid() is null then raise exception 'Sign in to read bank source coverage.';end if;return public.bank_source_coverage_for_owner(auth.uid());end;$$;
revoke all on function public.read_bank_source_coverage() from public,anon,authenticated,service_role;
grant execute on function public.read_bank_source_coverage() to authenticated;

-- Append metadata to existing view shapes without renaming dependencies or changing preceding columns.
do $$declare v text;definition text;begin
 foreach v in array array['refund_source_transactions','merchant_transaction_choices','duplicate_review_transactions'] loop
  select pg_get_viewdef(('public.'||v)::regclass,true) into definition;
  execute 'create or replace view public.'||quote_ident(v)||' with(security_invoker=true) as select base.*,t.original_signed_minor,t.source_units_ruleset from ('||rtrim(definition,E';\n ')||') base join public.bank_transactions t on t.id=base.id and t.user_id=base.user_id';
 end loop;
end;$$;

create function public.guard_native_bank_decision() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true) in('anon','authenticated') and new.user_id is distinct from auth.uid() then raise exception 'Owned native bank decision required.';end if;
 if(new.classification,new.business_use_bps,new.category_id,new.recognized_record_id,new.active_transfer_id,new.active_refund_id,new.dedupe_status,new.active_duplicate_decision_id)
  is distinct from(old.classification,old.business_use_bps,old.category_id,old.recognized_record_id,old.active_transfer_id,old.active_refund_id,old.dedupe_status,old.active_duplicate_decision_id)
 then perform public.assert_native_bank_scope(new.user_id,array[new.id]);end if;return new;
end;$$;
revoke all on function public.guard_native_bank_decision() from public,anon,authenticated,service_role;
create trigger native_bank_decision_fence before update on public.bank_transactions for each row execute function public.guard_native_bank_decision();
create function public.guard_native_bank_posting() returns trigger language plpgsql security definer set search_path='' as $$
begin if current_setting('role',true) in('anon','authenticated') and new.user_id is distinct from auth.uid() then raise exception 'Owned native bank posting required.';end if; if new.bank_transaction_id is not null and new.status='approved' then perform public.assert_native_bank_scope(new.user_id,array[new.bank_transaction_id]);end if;return new;end;$$;
revoke all on function public.guard_native_bank_posting() from public,anon,authenticated,service_role;
create trigger native_bank_posting_fence before insert or update on public.financial_records for each row execute function public.guard_native_bank_posting();
create function public.guard_sourced_account_currency() returns trigger language plpgsql set search_path='' as $$
begin
 if new.currency is distinct from old.currency and(exists(select 1 from public.bank_transactions t where t.account_id=old.id and t.user_id=old.user_id)
  or exists(select 1 from public.record_source_files f where f.account_id=old.id and f.user_id=old.user_id)) then raise exception 'Retain the original currency of sourced accounts.';end if;return new;
end;$$;
revoke all on function public.guard_sourced_account_currency() from public,anon,authenticated,service_role;
create trigger sourced_account_currency before update on public.financial_accounts for each row execute function public.guard_sourced_account_currency();

-- Checked in-place edits preserve public identities/grants and all completed-request branches.
do $$declare definition text;changed text;begin
 select pg_get_functiondef('public.review_bank_transaction_v1(uuid,integer,text,uuid,integer,text)'::regprocedure) into definition;
 changed:=replace(definition,'if not found then raise exception ''Transaction not found.''; end if;',
 'if not found then raise exception ''Transaction not found.''; end if; perform public.assert_native_bank_scope(owner_id,array[p_id]);');
 if changed=definition then raise exception 'Inspect the current classification source guard.';end if;execute changed;
 select pg_get_functiondef('public.save_merchant_rule(uuid,integer,jsonb,text,text,uuid)'::regprocedure) into definition;
 changed:=replace(definition,'kind:=case when seed.signed_amount_pence>0', 'perform public.assert_native_bank_scope(owner_id,array[seed.id]); kind:=case when seed.signed_amount_pence>0');
 if changed=definition then raise exception 'Inspect the current merchant seed guard.';end if;execute changed;
 select pg_get_functiondef('public.review_tax_inputs(integer,jsonb,text,text,uuid)'::regprocedure) into definition;
 changed:=replace(definition,'elsif source_kind=''transaction'' then','elsif source_kind=''transaction'' then perform public.assert_native_bank_scope(owner_id,array[source_id]);');
 if changed=definition then raise exception 'Inspect the current tax fact source guard.';end if;execute changed;
end;$$;

do $$declare definition text;changed text;needle text;begin
 select pg_get_functiondef('public.ingest_source_csv_v20_base(uuid,uuid,text,text,jsonb,jsonb)'::regprocedure) into definition;
 needle:='if not exists(select 1 from storage.objects where bucket_id=''source-evidence'' and name=attempt.object_path) then';
 changed:=replace(definition,needle,'perform 1 from public.financial_accounts a where a.id=attempt.account_id and a.user_id=p_owner and a.currency=''GBP'' for share; if not found then raise exception ''Native CSV registration requires a GBP account.'';end if; '||needle);
 if changed=definition then raise exception 'Inspect retry-first native ingestion.';end if;execute changed;
 select pg_get_functiondef('public.approve_merchant_batch(jsonb,text,text,uuid)'::regprocedure) into definition;
 needle:='perform 1 from public.bank_transactions where user_id=owner_id and id in(select (value->>''transaction_id'')::uuid from jsonb_array_elements(p_entries)) order by id for update;';
 changed:=replace(definition,needle,'perform public.assert_native_bank_scope(owner_id,array(select (value->>''transaction_id'')::uuid from jsonb_array_elements(p_entries))); '||needle);
 if changed=definition then raise exception 'Inspect retry-first merchant batch scope.';end if;execute changed;
 select pg_get_functiondef('public.review_tax_inputs(integer,jsonb,text,text,uuid)'::regprocedure) into definition;
 needle:='if source_snapshot is null then raise exception ''Owned active source not found.'';end if;';
 changed:=replace(definition,needle,needle||' if source_kind=''record'' and source_snapshot->>''bank_transaction_id'' is not null then perform public.assert_native_bank_scope(owner_id,array[(source_snapshot->>''bank_transaction_id'')::uuid]);end if;');
 if changed=definition then raise exception 'Inspect linked tax record source scope.';end if;execute changed;
end;$$;

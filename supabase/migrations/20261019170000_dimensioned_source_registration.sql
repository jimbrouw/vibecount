-- Versioned foreign registration. GBP admission constraints deliberately remain closed
-- until valuation/classification/reversal and their UI are integrated.
create function public.ingest_dimensioned_source_csv(p_owner uuid,p_attempt uuid,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.source_upload_attempts; account public.financial_accounts; plan jsonb; r jsonb;
 destination uuid; file_id uuid; row_id uuid; n integer; code text; exponent integer; amount bigint; dupe text; field text; selected_columns integer[];
begin
 select * into a from public.source_upload_attempts where id=p_attempt and user_id=p_owner for update;
 if not found or a.state<>'uploaded' then raise exception 'Uploaded source attempt required.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text||a.account_id::text,0));
 select id into destination from public.record_imports where user_id=p_owner and account_id=a.account_id and file_hash=a.file_hash;
 if destination is not null then
  update public.source_upload_attempts set state='duplicate' where id=a.id;
  insert into public.source_import_events(user_id,import_id,event,author) values(p_owner,destination,'reimported',p_owner);
  return jsonb_build_object('import_id',destination,'created',false,'transactions',0);
 end if;
 select * into account from public.financial_accounts where id=a.account_id and user_id=p_owner for share;
 if not found or account.currency not in('USD','EUR','JPY','KWD') or account.account_type not in('bank','credit_card') then raise exception 'Owned supported foreign account required.';end if;
 plan:=a.recovery_plan;code:=account.currency;exponent:=case code when 'JPY' then 0 when 'KWD' then 3 else 2 end;
 if jsonb_typeof(plan) is distinct from 'object' or (select count(*) from jsonb_object_keys(plan))<>12
 or not(plan ?& array['version','parser','ruleset_id','account_currency','currency_exponent','filename','mapping','row_count','incoming_original_minor','outgoing_original_minor','coverage_start','coverage_end'])
 or plan->'version' is distinct from '2'::jsonb or plan->>'parser' is distinct from 'mapped-csv/2'
 or plan->>'ruleset_id' is distinct from 'vibecount-currencies/1' or plan->>'account_currency' is distinct from code
 or plan->'currency_exponent' is distinct from to_jsonb(exponent) or jsonb_typeof(plan->'mapping') is distinct from 'object'
 or jsonb_typeof(plan->'filename') is distinct from 'string' or length(plan->>'filename')>200
 then raise exception 'Exact confirmed foreign parser and currency scope required.';end if;
 if (select count(*) from jsonb_object_keys(plan->'mapping'))<>9
 or not(plan->'mapping' ?& array['date','description','amount','debit','credit','currency','reference','dateFormat','amountMode'])
 or jsonb_typeof(plan->'mapping'->'dateFormat') is distinct from 'string'
 or jsonb_typeof(plan->'mapping'->'amountMode') is distinct from 'string'
 or plan->'mapping'->>'dateFormat' not in('iso','dmy') or plan->'mapping'->>'amountMode' not in('signed','debit_credit','card_charges')
 then raise exception 'Exact confirmed source mapping required.';end if;
 foreach field in array array['date','description','amount','debit','credit','currency','reference'] loop
  if jsonb_typeof(plan->'mapping'->field) is distinct from 'number' or plan->'mapping'->>field !~ '^-?[0-9]+$'
  or (plan->'mapping'->>field)::numeric not between -1 and 2147483647 then raise exception 'Exact mapping column required.';end if;
 end loop;
 selected_columns:=array[(plan->'mapping'->>'date')::integer,(plan->'mapping'->>'description')::integer]
 ||case when plan->'mapping'->>'amountMode'='debit_credit'
 then array[(plan->'mapping'->>'debit')::integer,(plan->'mapping'->>'credit')::integer]
 else array[(plan->'mapping'->>'amount')::integer] end
 ||array_remove(array[(plan->'mapping'->>'currency')::integer,(plan->'mapping'->>'reference')::integer],-1);
 if -1=any(selected_columns) or (select count(distinct value) from unnest(selected_columns) value)<>cardinality(selected_columns)
 then raise exception 'Distinct selected source columns required.';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or octet_length(p_rows::text)>8000000 then raise exception 'Bounded source rows required.';end if;
 n:=jsonb_array_length(p_rows);
 if n not between 1 and 5000 or plan->'row_count' is distinct from to_jsonb(n)
 or (select count(distinct value->>'row_number') from jsonb_array_elements(p_rows))<>n then raise exception 'Complete unique source row numbers required.';end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r) is distinct from 'object' or (select count(*) from jsonb_object_keys(r))<>12
  or not(r ?& array['row_number','date','description','reference','signed_pence','original_signed_minor','currency','currency_exponent','source_units_ruleset','row_hash','raw_encrypted','fingerprint'])
  or jsonb_typeof(r->'row_number') is distinct from 'number' or r->>'row_number' !~ '^[0-9]+$' or (r->>'row_number')::numeric not between 2 and 5001
  or jsonb_typeof(r->'date') is distinct from 'string' or r->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or jsonb_typeof(r->'description') is distinct from 'string' or jsonb_typeof(r->'reference') is distinct from 'string'
  or r->'signed_pence' is distinct from 'null'::jsonb or r->>'currency' is distinct from code
  or r->'currency_exponent' is distinct from to_jsonb(exponent) or r->>'source_units_ruleset' is distinct from 'vibecount-currencies/1'
  or jsonb_typeof(r->'original_signed_minor') is distinct from 'number' or r->>'original_signed_minor' !~ '^-?[1-9][0-9]*$'
  or (r->>'original_signed_minor')::numeric not between -999999999999 and 999999999999
  or jsonb_typeof(r->'row_hash') is distinct from 'string' or r->>'row_hash' !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(r->'fingerprint') is distinct from 'string' or r->>'fingerprint' !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(r->'raw_encrypted') is distinct from 'string'
  then raise exception 'Exact dimensioned source row required.';end if;
  if (r->>'date')::date not between date '1900-01-01' and date '9998-12-31'
  or octet_length(decode(r->>'raw_encrypted','base64')) not between 29 and 1000029
  or get_byte(decode(r->>'raw_encrypted','base64'),0)<>1 then raise exception 'Valid encrypted source row required.';end if;
 end loop;
 if plan->>'coverage_start' is distinct from (select min(value->>'date') from jsonb_array_elements(p_rows))
 or plan->>'coverage_end' is distinct from (select max(value->>'date') from jsonb_array_elements(p_rows))
 or plan->'incoming_original_minor' is distinct from (select to_jsonb(coalesce(sum((value->>'original_signed_minor')::numeric) filter(where (value->>'original_signed_minor')::numeric>0),0)) from jsonb_array_elements(p_rows))
 or plan->'outgoing_original_minor' is distinct from (select to_jsonb(coalesce(sum(-(value->>'original_signed_minor')::numeric) filter(where (value->>'original_signed_minor')::numeric<0),0)) from jsonb_array_elements(p_rows))
 then raise exception 'Confirmed source coverage or original totals differ.';end if;
 if a.object_path<>p_owner::text||'/'||a.account_id::text||'/'||a.id::text||'.enc'
 or not exists(select 1 from storage.objects where bucket_id='source-evidence' and name=a.object_path) then raise exception 'Encrypted original source unavailable.';end if;
 insert into public.record_source_files(user_id,account_id,file_hash,object_path,key_id,size_bytes)
 values(p_owner,a.account_id,a.file_hash,a.object_path,a.key_id,a.size_bytes) returning id into file_id;
 insert into public.record_imports(user_id,source_type,original_filename,status,account_id,source_file_id,file_hash,parser_version,metadata,coverage_start,coverage_end)
 values(p_owner,'csv',plan->>'filename','review',a.account_id,file_id,a.file_hash,'mapped-csv/2',
 jsonb_build_object('row_count',n,'mapping',plan->'mapping','currency',code,'ruleset_id','vibecount-currencies/1','currency_exponent',exponent),
 (plan->>'coverage_start')::date,(plan->>'coverage_end')::date) returning id into destination;
 for r in select value from jsonb_array_elements(p_rows) loop
  insert into public.source_rows(user_id,import_id,row_number,row_hash,raw_encrypted)
  values(p_owner,destination,(r->>'row_number')::integer,r->>'row_hash',r->>'raw_encrypted') returning id into row_id;
  dupe:=case when exists(select 1 from public.bank_transactions where user_id=p_owner and account_id=a.account_id and fingerprint=r->>'fingerprint' and import_id<>destination) then 'needs_review' else 'clear' end;
  amount:=(r->>'original_signed_minor')::bigint;
  insert into public.bank_transactions(user_id,account_id,import_id,source_row_id,transaction_date,signed_amount_pence,currency,description,reference,fingerprint,dedupe_status,original_signed_minor,source_units_ruleset)
  values(p_owner,a.account_id,destination,row_id,(r->>'date')::date,null,code,r->>'description',r->>'reference',r->>'fingerprint',dupe,amount,'vibecount-currencies/1');
 end loop;
 update public.source_upload_attempts set state='linked' where id=a.id;
 insert into public.source_import_events(user_id,import_id,event,author) values(p_owner,destination,'imported',p_owner);
 return jsonb_build_object('import_id',destination,'created',true,'transactions',n);
end;$$;
revoke all on function public.ingest_dimensioned_source_csv(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.ingest_source_csv(p_owner uuid,p_attempt uuid,p_filename text,p_parser text,p_mapping jsonb,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.source_upload_attempts; destination uuid;
begin
 select * into a from public.source_upload_attempts where id=p_attempt and user_id=p_owner for update;
 if not found then raise exception 'Upload attempt not found.'; end if;
 if a.recovery_plan is not null and (a.recovery_plan->>'filename',a.recovery_plan->>'parser',a.recovery_plan->'mapping') is distinct from (p_filename,p_parser,p_mapping) then raise exception 'Confirmed source scope changed.'; end if;
 if a.state in ('linked','duplicate') then
  select id into destination from public.record_imports where user_id=p_owner and account_id=a.account_id and file_hash=a.file_hash;
  if destination is null then raise exception 'Registered source evidence is inconsistent.'; end if;
  return jsonb_build_object('import_id',destination,'created',false,'transactions',0);
 end if;
 if p_parser='mapped-csv/2' then return public.ingest_dimensioned_source_csv(p_owner,p_attempt,p_rows);end if;
 return public.ingest_source_csv_v20_base(p_owner,p_attempt,p_filename,p_parser,p_mapping,p_rows);
end;$$;

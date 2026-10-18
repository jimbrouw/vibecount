-- Admission stays closed. Enforce foreign source identity even for privileged inserts.
create function public.guard_foreign_source_closure() returns trigger
language plpgsql security definer set search_path='' as $$
declare account public.financial_accounts;
begin
 select * into account from public.financial_accounts where id=new.account_id and user_id=new.user_id for share;
 if not found then raise exception 'Owned source account required.';end if;
 if new.currency='GBP' and account.currency='GBP' then return new;end if;
 if new.currency not in('USD','EUR','JPY','KWD') or account.currency is distinct from new.currency
 or not exists(
  select 1 from public.record_imports i
  join public.source_rows r on r.import_id=i.id and r.user_id=i.user_id
  join public.record_source_files f on f.id=i.source_file_id and f.user_id=i.user_id and f.account_id=i.account_id and f.file_hash=i.file_hash
  where i.id=new.import_id and i.user_id=new.user_id and i.account_id=new.account_id
  and r.id=new.source_row_id and i.parser_version='mapped-csv/2'
  and i.metadata->>'currency'=new.currency
  and new.transaction_date between i.coverage_start and i.coverage_end
 ) then raise exception 'Foreign observation requires matching owner, account, import, source row and currency.';end if;
 return new;
end;$$;
revoke all on function public.guard_foreign_source_closure() from public,anon,authenticated,service_role;
create trigger foreign_source_closure before insert on public.bank_transactions
for each row execute function public.guard_foreign_source_closure();

-- Append safe dimensional fields; preserve existing columns, owner policies and stamp bytes.
create or replace view public.evidence_recovery_attempts with(security_invoker=true) as
 select a.id,a.user_id,'source'::text kind,a.state,a.file_hash,a.created_at,
 md5(jsonb_build_array(a.id,a.state,a.file_hash,a.recovery_plan)::text) stamp,
 a.size_bytes byte_count,1 object_count,a.recovery_plan->>'parser' parser,
 a.recovery_plan->>'row_count' row_count,a.recovery_plan->>'incoming_pence' incoming_pence,a.recovery_plan->>'outgoing_pence' outgoing_pence,
 a.recovery_plan->>'coverage_start' coverage_start,a.recovery_plan->>'coverage_end' coverage_end,
 f.label account_label,f.masked_identifier account_mask,null::text tax_year_start,null::text purpose,
 (select i.id from public.record_imports i where i.user_id=a.user_id and i.account_id=a.account_id and i.file_hash=a.file_hash) destination_id,
 a.recovery_plan is not null has_recovery_plan,
 a.recovery_plan->>'version' plan_version,f.currency account_currency,
 a.recovery_plan->>'account_currency' original_currency,a.recovery_plan->>'currency_exponent' currency_exponent,
 a.recovery_plan->>'ruleset_id' ruleset_id,
 a.recovery_plan->>'incoming_original_minor' incoming_original_minor,a.recovery_plan->>'outgoing_original_minor' outgoing_original_minor
 from public.source_upload_attempts a join public.financial_accounts f on f.id=a.account_id and f.user_id=a.user_id
 union all
 select a.id,a.user_id,'document',a.state,a.file_hash,a.created_at,
 md5(jsonb_build_array(a.id,a.state,a.file_hash,a.recovery_plan)::text),
 null::integer,a.object_count,a.recovery_plan->>'parser',null::text,null::text,null::text,null::text,null::text,
 null::text,null::text,a.recovery_plan->>'year',a.recovery_plan->>'purpose',a.batch_id,a.recovery_plan is not null,
 a.recovery_plan->>'version',null::text,null::text,null::text,null::text,null::text,null::text
 from public.document_upload_attempts a;

-- Match scoped native eligibility to complete source coverage when legacy parser metadata is missing.
-- No writer, retained intent or historical reader is changed.
create or replace function public.bank_observation_has_native_source(p_owner uuid,p_id uuid) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.bank_transactions t
 join public.financial_accounts a on a.id=t.account_id and a.user_id=t.user_id
 join public.record_imports i on i.id=t.import_id and i.user_id=t.user_id and i.account_id=t.account_id
 join public.source_rows r on r.id=t.source_row_id and r.user_id=t.user_id and r.import_id=t.import_id
 join public.record_source_files f on f.id=i.source_file_id and f.user_id=t.user_id and f.account_id=t.account_id and f.file_hash=i.file_hash
 where t.user_id=p_owner and t.id=p_id and a.currency=t.currency and a.account_type in('bank','credit_card')
 and i.parser_version is not null and r.row_hash is not null and f.file_hash is not null
 and public.bank_observation_is_native(p_owner,t.id));
$$;

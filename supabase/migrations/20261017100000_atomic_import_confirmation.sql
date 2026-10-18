-- Preserve the existing financial_records model. Each staged row has at most one posting.
alter table public.csv_import_rows add constraint csv_import_rows_id_owner_unique unique (id, user_id);
alter table public.bank_statement_import_rows add constraint bank_import_rows_id_owner_unique unique (id, user_id);

alter table public.financial_records
  add column csv_import_row_id uuid,
  add column bank_statement_row_id uuid,
  add constraint financial_records_csv_row_owner_fk foreign key (csv_import_row_id, user_id)
    references public.csv_import_rows(id, user_id) on delete restrict,
  add constraint financial_records_bank_row_owner_fk foreign key (bank_statement_row_id, user_id)
    references public.bank_statement_import_rows(id, user_id) on delete restrict,
  add constraint financial_records_one_import_source check (
    csv_import_row_id is null or bank_statement_row_id is null
  );

-- Only existing explicit links are backfilled; do not infer missing evidence.
update public.financial_records f set csv_import_row_id = r.id
from public.csv_import_rows r where r.committed_record_id = f.id and r.user_id = f.user_id;
update public.financial_records f set bank_statement_row_id = r.id
from public.bank_statement_import_rows r where r.committed_record_id = f.id and r.user_id = f.user_id;

create unique index financial_records_csv_row_unique on public.financial_records(csv_import_row_id)
  where csv_import_row_id is not null;
create unique index financial_records_bank_row_unique on public.financial_records(bank_statement_row_id)
  where bank_statement_row_id is not null;

-- Invoker rights preserve RLS. Identifiers are selected exclusively from this fixed allowlist.
create function public.confirm_import_rows(p_source text, p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  source_table text;
  ids uuid[];
  row_data record;
  expected_version text;
  posting_id uuid;
  committed_count integer := 0;
  reused_count integer := 0;
  found_count integer := 0;
begin
  if owner_id is null then raise exception 'Sign in to confirm import rows.'; end if;
  if p_source = 'csv' then source_table := 'csv_import_rows';
  elsif p_source = 'bank_statement_pdf' then source_table := 'bank_statement_import_rows';
  else raise exception 'Invalid import source.'; end if;

  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Expected reviewed rows.'; end if;
  if jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 100 then
    raise exception 'Choose between 1 and 100 reviewed rows.';
  end if;
  select array_agg((item->>'id')::uuid) into ids from jsonb_array_elements(p_rows) item;
  if array_position(ids, null) is not null
     or cardinality(ids) <> (select count(distinct id) from unnest(ids) id) then
    raise exception 'Reviewed row IDs must be distinct and non-null.';
  end if;

  for row_data in execute format(
    'select * from public.%I where user_id = $1 and id = any($2) order by id for update', source_table
  ) using owner_id, ids loop
    found_count := found_count + 1;
    -- Retrying the same confirmation returns the existing posting, never another insert.
    if row_data.status = 'committed' and row_data.committed_record_id is not null then
      reused_count := reused_count + 1;
      continue;
    end if;
    select item->>'updated_at' into expected_version from jsonb_array_elements(p_rows) item
      where (item->>'id')::uuid = row_data.id;
    if expected_version is null or expected_version::timestamptz <> row_data.updated_at then
      raise exception 'An import row changed. Reload and review again.';
    end if;
    if row_data.status <> 'approved' or row_data.record_date is null
       or row_data.description is null or length(btrim(row_data.description)) = 0
       or row_data.amount is null or row_data.amount <= 0 or row_data.category_id is null then
      raise exception 'Every selected row must be valid and approved.';
    end if;
    -- Shared defaults are readable but deliberately not updateable under RLS;
    -- a locking SELECT would apply UPDATE policies and hide those categories.
    perform 1 from public.record_categories c where c.id = row_data.category_id
      and c.record_type = row_data.record_type and (c.user_id = owner_id or c.is_default);
    if not found then raise exception 'Category does not belong to this user or record type.'; end if;

    insert into public.financial_records (
      user_id, record_type, record_date, description, amount, category_id, import_id,
      source_type, source_reference, status, approved_at, csv_import_row_id, bank_statement_row_id
    ) values (
      owner_id, row_data.record_type, row_data.record_date, row_data.description,
      row_data.amount, row_data.category_id, row_data.import_id, p_source,
      p_source || ' row ' || row_data.id::text, 'approved', now(),
      case when p_source = 'csv' then row_data.id end,
      case when p_source = 'bank_statement_pdf' then row_data.id end
    ) returning id into posting_id;

    execute format('update public.%I set status = ''committed'', committed_record_id = $1 where id = $2 and user_id = $3', source_table)
      using posting_id, row_data.id, owner_id;
    committed_count := committed_count + 1;

    -- Only mark the import committed once no undecided or uncommitted rows remain.
    execute format(
      'update public.record_imports set status = ''committed'', committed_at = now() where id = $1 and user_id = $2 and not exists (select 1 from public.%I where import_id = $1 and status not in (''committed'', ''discarded''))', source_table
    ) using row_data.import_id, owner_id;
  end loop;
  if found_count <> cardinality(ids) then
    raise exception 'One or more selected rows are missing or belong to another user.';
  end if;
  return jsonb_build_object('committed', committed_count, 'reused', reused_count);
end;
$$;
revoke all on function public.confirm_import_rows(text, jsonb) from public, anon;
grant execute on function public.confirm_import_rows(text, jsonb) to authenticated;

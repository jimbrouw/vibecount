create table public.record_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  record_type text not null,
  sa103_box text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint record_categories_name_not_blank check (length(btrim(name)) > 0),
  constraint record_categories_type_valid check (record_type in ('income', 'expense')),
  constraint record_categories_owner_valid check (
    (is_default = true and user_id is null)
    or (is_default = false and user_id is not null)
  )
);

create unique index record_categories_default_name_unique
  on public.record_categories (record_type, lower(btrim(name)))
  where is_default = true;

create unique index record_categories_user_name_unique
  on public.record_categories (user_id, record_type, lower(btrim(name)))
  where user_id is not null;

create index record_categories_user_type_idx
  on public.record_categories (user_id, record_type, name);

create trigger record_categories_set_updated_at
before update on public.record_categories
for each row
execute function public.set_updated_at();

create table public.record_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null,
  original_filename text,
  status text not null default 'review',
  imported_at timestamptz not null default now(),
  committed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint record_imports_source_type_valid check (
    source_type in ('manual', 'invoice', 'csv', 'bank_statement_pdf')
  ),
  constraint record_imports_status_valid check (
    status in ('review', 'committed', 'discarded')
  )
);

create index record_imports_user_imported_at_idx
  on public.record_imports (user_id, imported_at desc);

create trigger record_imports_set_updated_at
before update on public.record_imports
for each row
execute function public.set_updated_at();

alter table public.record_imports
  add constraint record_imports_id_user_id_unique unique (id, user_id);

alter table public.invoices
  add constraint invoices_id_user_id_unique unique (id, user_id);

create table public.financial_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_type text not null,
  record_date date not null,
  description text not null,
  amount numeric(12, 2) not null,
  category_id uuid,
  client_id uuid,
  invoice_id uuid,
  import_id uuid,
  source_type text not null default 'manual',
  source_reference text,
  status text not null default 'approved',
  tax_year_start integer generated always as (
    case
      when record_date >= make_date(extract(year from record_date)::integer, 4, 6)
        then extract(year from record_date)::integer
      else extract(year from record_date)::integer - 1
    end
  ) stored,
  tax_quarter integer generated always as (
    case
      when record_date >= make_date(
        case
          when record_date >= make_date(extract(year from record_date)::integer, 4, 6)
            then extract(year from record_date)::integer
          else extract(year from record_date)::integer - 1
        end,
        4,
        6
      )
      and record_date < make_date(
        case
          when record_date >= make_date(extract(year from record_date)::integer, 4, 6)
            then extract(year from record_date)::integer
          else extract(year from record_date)::integer - 1
        end,
        7,
        6
      ) then 1
      when record_date >= make_date(
        case
          when record_date >= make_date(extract(year from record_date)::integer, 4, 6)
            then extract(year from record_date)::integer
          else extract(year from record_date)::integer - 1
        end,
        7,
        6
      )
      and record_date < make_date(
        case
          when record_date >= make_date(extract(year from record_date)::integer, 4, 6)
            then extract(year from record_date)::integer
          else extract(year from record_date)::integer - 1
        end,
        10,
        6
      ) then 2
      when record_date >= make_date(
        case
          when record_date >= make_date(extract(year from record_date)::integer, 4, 6)
            then extract(year from record_date)::integer
          else extract(year from record_date)::integer - 1
        end,
        10,
        6
      )
      and record_date < make_date(
        case
          when record_date >= make_date(extract(year from record_date)::integer, 4, 6)
            then extract(year from record_date)::integer
          else extract(year from record_date)::integer - 1
        end + 1,
        1,
        6
      ) then 3
      else 4
    end
  ) stored,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_records_type_valid check (record_type in ('income', 'expense')),
  constraint financial_records_description_not_blank check (length(btrim(description)) > 0),
  constraint financial_records_amount_not_negative check (amount >= 0),
  constraint financial_records_source_type_valid check (
    source_type in ('manual', 'invoice', 'csv', 'bank_statement_pdf')
  ),
  constraint financial_records_status_valid check (
    status in ('draft', 'review', 'approved', 'excluded')
  )
);

alter table public.financial_records
  add constraint financial_records_category_fk
  foreign key (category_id)
  references public.record_categories (id)
  on delete set null;

alter table public.financial_records
  add constraint financial_records_client_same_user_fk
  foreign key (client_id, user_id)
  references public.clients (id, user_id)
  on delete set null (client_id);

alter table public.financial_records
  add constraint financial_records_invoice_same_user_fk
  foreign key (invoice_id, user_id)
  references public.invoices (id, user_id)
  on delete set null (invoice_id);

alter table public.financial_records
  add constraint financial_records_import_same_user_fk
  foreign key (import_id, user_id)
  references public.record_imports (id, user_id)
  on delete set null (import_id);

create index financial_records_user_date_idx
  on public.financial_records (user_id, record_date desc);

create index financial_records_user_tax_period_idx
  on public.financial_records (user_id, tax_year_start, tax_quarter, record_type);

create index financial_records_category_id_idx
  on public.financial_records (category_id);

create trigger financial_records_set_updated_at
before update on public.financial_records
for each row
execute function public.set_updated_at();

create table public.financial_record_changes (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  changed_by uuid references auth.users(id) on delete set null,
  action text not null,
  previous_record jsonb,
  new_record jsonb,
  changed_at timestamptz not null default now(),
  constraint financial_record_changes_action_valid check (action in ('insert', 'update', 'delete'))
);

create index financial_record_changes_record_changed_at_idx
  on public.financial_record_changes (record_id, changed_at desc);

create index financial_record_changes_user_changed_at_idx
  on public.financial_record_changes (user_id, changed_at desc);

create or replace function public.log_financial_record_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.financial_record_changes (
      record_id,
      user_id,
      changed_by,
      action,
      new_record
    )
    values (
      new.id,
      new.user_id,
      auth.uid(),
      'insert',
      to_jsonb(new)
    );
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.financial_record_changes (
      record_id,
      user_id,
      changed_by,
      action,
      previous_record,
      new_record
    )
    values (
      new.id,
      new.user_id,
      auth.uid(),
      'update',
      to_jsonb(old),
      to_jsonb(new)
    );
    return new;
  else
    insert into public.financial_record_changes (
      record_id,
      user_id,
      changed_by,
      action,
      previous_record
    )
    values (
      old.id,
      old.user_id,
      auth.uid(),
      'delete',
      to_jsonb(old)
    );
    return old;
  end if;
end;
$$;

create trigger financial_records_log_change
after insert or update or delete on public.financial_records
for each row
execute function public.log_financial_record_change();

create view public.financial_record_quarter_summaries as
select
  user_id,
  tax_year_start,
  tax_quarter,
  coalesce(sum(amount) filter (where record_type = 'income' and status = 'approved'), 0) as income_total,
  coalesce(sum(amount) filter (where record_type = 'expense' and status = 'approved'), 0) as expense_total,
  count(*) filter (where record_type = 'income' and status = 'approved') as income_count,
  count(*) filter (where record_type = 'expense' and status = 'approved') as expense_count,
  coalesce(sum(amount) filter (where record_type = 'income' and status = 'approved'), 0)
    - coalesce(sum(amount) filter (where record_type = 'expense' and status = 'approved'), 0) as net_total
from public.financial_records
group by user_id, tax_year_start, tax_quarter;

alter view public.financial_record_quarter_summaries set (security_invoker = true);

alter table public.record_categories enable row level security;
alter table public.record_imports enable row level security;
alter table public.financial_records enable row level security;
alter table public.financial_record_changes enable row level security;

create policy "Users can read their own and default record categories"
on public.record_categories
for select
to authenticated
using (is_default = true or auth.uid() = user_id);

create policy "Users can create their own record categories"
on public.record_categories
for insert
to authenticated
with check (is_default = false and auth.uid() = user_id);

create policy "Users can update their own record categories"
on public.record_categories
for update
to authenticated
using (is_default = false and auth.uid() = user_id)
with check (is_default = false and auth.uid() = user_id);

create policy "Users can delete their own record categories"
on public.record_categories
for delete
to authenticated
using (is_default = false and auth.uid() = user_id);

create policy "Users can read their own record imports"
on public.record_imports
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create their own record imports"
on public.record_imports
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own record imports"
on public.record_imports
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own record imports"
on public.record_imports
for delete
to authenticated
using (auth.uid() = user_id);

create policy "Users can read their own financial records"
on public.financial_records
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create their own financial records"
on public.financial_records
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own financial records"
on public.financial_records
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own financial records"
on public.financial_records
for delete
to authenticated
using (auth.uid() = user_id);

create policy "Users can read their own financial record changes"
on public.financial_record_changes
for select
to authenticated
using (auth.uid() = user_id);

grant select, insert, update, delete on public.record_categories to authenticated;
grant select, insert, update, delete on public.record_imports to authenticated;
grant select, insert, update, delete on public.financial_records to authenticated;
grant select on public.financial_record_changes to authenticated;
grant select on public.financial_record_quarter_summaries to authenticated;

insert into public.record_categories (name, record_type, sa103_box, is_default)
values
  ('Sales and fees', 'income', 'SA103 turnover', true),
  ('Other business income', 'income', 'SA103 other business income', true),
  ('Cost of goods bought for resale', 'expense', 'SA103 cost of goods', true),
  ('Office costs', 'expense', 'SA103 office costs', true),
  ('Travel costs', 'expense', 'SA103 travel costs', true),
  ('Staff costs', 'expense', 'SA103 staff costs', true),
  ('Subcontractor costs', 'expense', 'SA103 subcontractor costs', true),
  ('Advertising and marketing', 'expense', 'SA103 advertising', true),
  ('Professional fees', 'expense', 'SA103 professional fees', true),
  ('Other allowable expenses', 'expense', 'SA103 other allowable expenses', true);

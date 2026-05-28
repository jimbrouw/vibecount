create table public.bank_statement_import_rows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  import_id uuid not null,
  row_number integer not null,
  record_type text not null,
  record_date date,
  description text,
  amount numeric(12, 2),
  category_id uuid,
  status text not null default 'review',
  error_message text,
  redacted_line text not null,
  committed_record_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bank_statement_import_rows_type_valid check (record_type in ('income', 'expense')),
  constraint bank_statement_import_rows_status_valid check (
    status in ('review', 'approved', 'discarded', 'committed', 'invalid')
  )
);

alter table public.bank_statement_import_rows
  add constraint bank_statement_import_rows_import_same_user_fk
  foreign key (import_id, user_id)
  references public.record_imports (id, user_id)
  on delete cascade;

alter table public.bank_statement_import_rows
  add constraint bank_statement_import_rows_category_fk
  foreign key (category_id)
  references public.record_categories (id)
  on delete set null;

alter table public.bank_statement_import_rows
  add constraint bank_statement_import_rows_committed_record_fk
  foreign key (committed_record_id, user_id)
  references public.financial_records (id, user_id)
  on delete set null (committed_record_id);

create index bank_statement_import_rows_user_status_idx
  on public.bank_statement_import_rows (user_id, status, created_at desc);

create trigger bank_statement_import_rows_set_updated_at
before update on public.bank_statement_import_rows
for each row
execute function public.set_updated_at();

alter table public.bank_statement_import_rows enable row level security;

create policy "Users can read their own bank statement rows"
on public.bank_statement_import_rows
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create their own bank statement rows"
on public.bank_statement_import_rows
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own bank statement rows"
on public.bank_statement_import_rows
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update on public.bank_statement_import_rows to authenticated;

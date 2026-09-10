create table if not exists public.quarterly_readiness_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tax_year_start integer not null,
  tax_quarter integer not null,
  checked_at timestamptz not null default now(),
  uncategorised_count integer not null default 0,
  review_count integer not null default 0,
  overdue_invoice_count integer not null default 0,
  net_profit_pence bigint not null default 0,
  status text not null default 'ok',
  notes text not null default '',
  created_at timestamptz not null default now(),

  constraint quarterly_readiness_checks_quarter_valid
    check (tax_quarter between 1 and 4),
  constraint quarterly_readiness_checks_status_valid
    check (status in ('ok', 'needs_attention'))
);

create unique index if not exists quarterly_readiness_checks_unique_idx
  on public.quarterly_readiness_checks (user_id, tax_year_start, tax_quarter);

create index if not exists quarterly_readiness_checks_user_checked_idx
  on public.quarterly_readiness_checks (user_id, checked_at desc);

alter table public.quarterly_readiness_checks enable row level security;

create policy "Users can read their own readiness checks"
  on public.quarterly_readiness_checks
  for select
  to authenticated
  using (auth.uid() = user_id);

grant select on public.quarterly_readiness_checks to authenticated;

create table if not exists public.user_settings (
  id uuid primary key references auth.users(id) on delete cascade,
  legal_name text not null default '',
  address text not null default '',
  contact_details text not null default '',
  default_payment_terms text not null default 'Payment due within 30 days',
  bank_details text not null default '',
  vat_registered boolean not null default false,
  vat_number text not null default '',
  vat_rate numeric(5, 2) not null default 20.00,
  invoice_number_prefix text not null default 'VC',
  late_payment_wording text not null default 'Late payments may be subject to statutory interest and compensation.',
  utr text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_settings'
      and policyname = 'Users can read their own settings'
  ) then
    create policy "Users can read their own settings"
    on public.user_settings
    for select
    to authenticated
    using ((select auth.uid()) = id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_settings'
      and policyname = 'Users can insert their own settings'
  ) then
    create policy "Users can insert their own settings"
    on public.user_settings
    for insert
    to authenticated
    with check ((select auth.uid()) = id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_settings'
      and policyname = 'Users can update their own settings'
  ) then
    create policy "Users can update their own settings"
    on public.user_settings
    for update
    to authenticated
    using ((select auth.uid()) = id)
    with check ((select auth.uid()) = id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_settings'
      and policyname = 'Users can delete their own settings'
  ) then
    create policy "Users can delete their own settings"
    on public.user_settings
    for delete
    to authenticated
    using ((select auth.uid()) = id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'user_settings_set_updated_at'
      and tgrelid = 'public.user_settings'::regclass
  ) then
    create trigger user_settings_set_updated_at
    before update on public.user_settings
    for each row
    execute function public.set_updated_at();
  end if;
end $$;

grant select, insert, update, delete on public.user_settings to authenticated;

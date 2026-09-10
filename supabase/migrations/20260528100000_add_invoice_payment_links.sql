alter table public.user_settings
  add column if not exists payment_link_provider text not null default '',
  add column if not exists payment_link_url text not null default '';

alter table public.user_settings
  add constraint user_settings_payment_link_provider_valid
  check (
    payment_link_provider = ''
    or payment_link_provider in ('sumup', 'stripe', 'paypal', 'other')
  );

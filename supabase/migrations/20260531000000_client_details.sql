-- Client address and company details
alter table public.clients
  add column if not exists address text not null default '',
  add column if not exists company_number text not null default '',
  add column if not exists vat_number text not null default '';

-- Companies House API key stored per user (optional)
alter table public.user_settings
  add column if not exists companies_house_api_key text not null default '';

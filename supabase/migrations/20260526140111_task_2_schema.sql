create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clients_name_not_blank check (length(btrim(name)) > 0)
);

create unique index clients_user_name_unique
  on public.clients (user_id, lower(btrim(name)));

alter table public.clients
  add constraint clients_id_user_id_unique unique (id, user_id);

create trigger clients_set_updated_at
before update on public.clients
for each row
execute function public.set_updated_at();

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  number text not null,
  invoice_date date not null default current_date,
  description text not null,
  amount numeric(12, 2) not null,
  payment_terms text not null default 'Payment due within 14 days',
  status text not null default 'draft',
  pdf_path text,
  finalised_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_number_not_blank check (length(btrim(number)) > 0),
  constraint invoices_description_not_blank check (length(btrim(description)) > 0),
  constraint invoices_amount_not_negative check (amount >= 0),
  constraint invoices_status_valid check (status in ('draft', 'finalised'))
);

alter table public.invoices
  add constraint invoices_client_same_user_fk
  foreign key (client_id, user_id)
  references public.clients (id, user_id)
  on delete restrict;

create unique index invoices_user_number_unique
  on public.invoices (user_id, number);

create index invoices_user_created_at_idx
  on public.invoices (user_id, created_at desc);

create index invoices_client_id_idx
  on public.invoices (client_id);

create trigger invoices_set_updated_at
before update on public.invoices
for each row
execute function public.set_updated_at();

create table public.glossary_terms (
  id uuid primary key default gen_random_uuid(),
  term text not null,
  explanation text not null,
  example text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint glossary_terms_term_not_blank check (length(btrim(term)) > 0),
  constraint glossary_terms_explanation_not_blank check (length(btrim(explanation)) > 0),
  constraint glossary_terms_example_not_blank check (length(btrim(example)) > 0)
);

create unique index glossary_terms_term_unique
  on public.glossary_terms (lower(btrim(term)));

create index glossary_terms_sort_order_idx
  on public.glossary_terms (sort_order, term);

create trigger glossary_terms_set_updated_at
before update on public.glossary_terms
for each row
execute function public.set_updated_at();

alter table public.clients enable row level security;
alter table public.invoices enable row level security;
alter table public.glossary_terms enable row level security;

create policy "Users can read their own clients"
on public.clients
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create their own clients"
on public.clients
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own clients"
on public.clients
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own clients"
on public.clients
for delete
to authenticated
using (auth.uid() = user_id);

create policy "Users can read their own invoices"
on public.invoices
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create their own invoices"
on public.invoices
for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.clients
    where clients.id = invoices.client_id
      and clients.user_id = auth.uid()
  )
);

create policy "Users can update their own invoices"
on public.invoices
for update
to authenticated
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.clients
    where clients.id = invoices.client_id
      and clients.user_id = auth.uid()
  )
);

create policy "Users can delete their own invoices"
on public.invoices
for delete
to authenticated
using (auth.uid() = user_id);

create policy "Glossary terms are readable"
on public.glossary_terms
for select
to anon, authenticated
using (true);

grant select, insert, update, delete on public.clients to authenticated;
grant select, insert, update, delete on public.invoices to authenticated;
grant select on public.glossary_terms to anon, authenticated;

insert into public.glossary_terms (term, explanation, example, sort_order)
values
  (
    'Self Assessment',
    'A placeholder plain-English explanation for founder and accountant review.',
    'Example placeholder: use this row to test the glossary layout only.',
    10
  ),
  (
    'Allowable Expenses',
    'A placeholder plain-English explanation for founder and accountant review.',
    'Example placeholder: use this row to test the glossary layout only.',
    20
  ),
  (
    'Payment on Account',
    'A placeholder plain-English explanation for founder and accountant review.',
    'Example placeholder: use this row to test the glossary layout only.',
    30
  ),
  (
    'Unique Taxpayer Reference',
    'A placeholder plain-English explanation for founder and accountant review.',
    'Example placeholder: use this row to test the glossary layout only.',
    40
  ),
  (
    'National Insurance',
    'A placeholder plain-English explanation for founder and accountant review.',
    'Example placeholder: use this row to test the glossary layout only.',
    50
  );

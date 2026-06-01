create table public.services (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null,
  unit_price numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint services_name_not_blank check (length(btrim(name)) > 0),
  constraint services_description_not_blank check (length(btrim(description)) > 0),
  constraint services_unit_price_positive check (unit_price > 0)
);

create unique index services_user_name_unique
  on public.services (user_id, lower(btrim(name)));

create index services_user_created_at_idx
  on public.services (user_id, created_at desc);

create trigger services_set_updated_at
before update on public.services
for each row
execute function public.set_updated_at();

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  number text not null,
  quote_date date not null default current_date,
  valid_until date,
  status text not null default 'draft',
  notes text,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quotes_number_not_blank check (length(btrim(number)) > 0),
  constraint quotes_status_valid check (status in ('draft', 'sent', 'accepted', 'declined'))
);

alter table public.quotes
  add constraint quotes_client_same_user_fk
  foreign key (client_id, user_id)
  references public.clients (id, user_id)
  on delete restrict;

alter table public.quotes
  add constraint quotes_id_user_id_unique unique (id, user_id);

create unique index quotes_user_number_unique
  on public.quotes (user_id, number);

create index quotes_user_created_at_idx
  on public.quotes (user_id, created_at desc);

create trigger quotes_set_updated_at
before update on public.quotes
for each row
execute function public.set_updated_at();

create table public.quote_line_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  service_id uuid,
  description text not null,
  quantity numeric(10, 2) not null default 1,
  unit_price numeric(12, 2) not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_line_items_description_not_blank check (length(btrim(description)) > 0),
  constraint quote_line_items_quantity_positive check (quantity > 0),
  constraint quote_line_items_unit_price_positive check (unit_price > 0)
);

alter table public.quote_line_items
  add constraint quote_line_items_quote_same_user_fk
  foreign key (quote_id, user_id)
  references public.quotes (id, user_id)
  on delete cascade;

alter table public.quote_line_items
  add constraint quote_line_items_service_fk
  foreign key (service_id)
  references public.services (id)
  on delete set null;

create index quote_line_items_quote_idx
  on public.quote_line_items (quote_id, sort_order);

create trigger quote_line_items_set_updated_at
before update on public.quote_line_items
for each row
execute function public.set_updated_at();

alter table public.services enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_line_items enable row level security;

create policy "Users can read their own services"
on public.services
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create their own services"
on public.services
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own services"
on public.services
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own services"
on public.services
for delete
to authenticated
using (auth.uid() = user_id);

create policy "Users can read their own quotes"
on public.quotes
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create their own quotes"
on public.quotes
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own quotes"
on public.quotes
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own quotes"
on public.quotes
for delete
to authenticated
using (auth.uid() = user_id);

create policy "Users can read their own quote line items"
on public.quote_line_items
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create their own quote line items"
on public.quote_line_items
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own quote line items"
on public.quote_line_items
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own quote line items"
on public.quote_line_items
for delete
to authenticated
using (auth.uid() = user_id);

grant select, insert, update, delete on public.services to authenticated;
grant select, insert, update, delete on public.quotes to authenticated;
grant select, insert, update, delete on public.quote_line_items to authenticated;

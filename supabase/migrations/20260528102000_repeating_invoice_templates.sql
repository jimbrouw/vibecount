create table public.repeating_invoice_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  title text not null,
  description text not null,
  amount numeric(12, 2) not null,
  payment_terms text not null default 'Payment due within 30 days',
  frequency text not null,
  next_run_date date not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint repeating_invoice_templates_title_not_blank check (length(btrim(title)) > 0),
  constraint repeating_invoice_templates_description_not_blank check (length(btrim(description)) > 0),
  constraint repeating_invoice_templates_amount_positive check (amount > 0),
  constraint repeating_invoice_templates_frequency_valid check (frequency in ('monthly', 'quarterly', 'yearly')),
  constraint repeating_invoice_templates_status_valid check (status in ('active', 'paused'))
);

alter table public.repeating_invoice_templates
  add constraint repeating_invoice_templates_client_same_user_fk
  foreign key (client_id, user_id)
  references public.clients (id, user_id)
  on delete restrict;

alter table public.repeating_invoice_templates
  add constraint repeating_invoice_templates_id_user_id_unique unique (id, user_id);

create index repeating_invoice_templates_due_idx
  on public.repeating_invoice_templates (status, next_run_date);

create trigger repeating_invoice_templates_set_updated_at
before update on public.repeating_invoice_templates
for each row
execute function public.set_updated_at();

create table public.repeating_invoice_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  template_id uuid not null,
  invoice_id uuid not null,
  due_date date not null,
  created_at timestamptz not null default now(),
  constraint repeating_invoice_runs_unique unique (template_id, due_date)
);

alter table public.repeating_invoice_runs
  add constraint repeating_invoice_runs_template_same_user_fk
  foreign key (template_id, user_id)
  references public.repeating_invoice_templates (id, user_id)
  on delete cascade;

alter table public.repeating_invoice_runs
  add constraint repeating_invoice_runs_invoice_same_user_fk
  foreign key (invoice_id, user_id)
  references public.invoices (id, user_id)
  on delete cascade;

create index repeating_invoice_runs_user_created_idx
  on public.repeating_invoice_runs (user_id, created_at desc);

alter table public.repeating_invoice_templates enable row level security;
alter table public.repeating_invoice_runs enable row level security;

create policy "Users can read their own repeating invoice templates"
on public.repeating_invoice_templates
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create their own repeating invoice templates"
on public.repeating_invoice_templates
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own repeating invoice templates"
on public.repeating_invoice_templates
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can read their own repeating invoice runs"
on public.repeating_invoice_runs
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create their own repeating invoice runs"
on public.repeating_invoice_runs
for insert
to authenticated
with check (auth.uid() = user_id);

grant select, insert, update on public.repeating_invoice_templates to authenticated;
grant select, insert on public.repeating_invoice_runs to authenticated;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid,
  name text not null,
  description text not null default '',
  budget_pence bigint not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint projects_name_not_blank check (length(btrim(name)) > 0),
  constraint projects_status_valid check (status in ('active', 'completed', 'archived'))
);

alter table public.projects
  add constraint projects_client_fk
  foreign key (client_id, user_id)
  references public.clients (id, user_id)
  on delete set null;

create index projects_user_created_at_idx
  on public.projects (user_id, created_at desc);

create trigger projects_set_updated_at
before update on public.projects
for each row
execute function public.set_updated_at();

alter table public.invoices
  add column if not exists project_id uuid references public.projects(id) on delete set null;

alter table public.financial_records
  add column if not exists project_id uuid references public.projects(id) on delete set null;

alter table public.projects enable row level security;

create policy "Users can read their own projects"
  on public.projects for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can create their own projects"
  on public.projects for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own projects"
  on public.projects for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can delete their own projects"
  on public.projects for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.projects to authenticated;

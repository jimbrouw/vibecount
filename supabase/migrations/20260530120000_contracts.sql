create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  proposal_id uuid not null,
  client_id uuid not null,
  number text not null,
  contract_date date not null default current_date,
  title text not null,
  scope text not null default '',
  deliverables text not null default '',
  timeline_start date,
  timeline_end date,
  payment_terms text not null default 'Net 30',
  total_pence bigint not null default 0,
  custom_terms text not null default '',
  status text not null default 'draft',
  sent_at timestamptz,
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint contracts_status_valid
    check (status in ('draft', 'sent', 'signed')),
  constraint contracts_number_not_blank
    check (length(btrim(number)) > 0),
  constraint contracts_title_not_blank
    check (length(btrim(title)) > 0)
);

alter table public.contracts
  add constraint contracts_proposal_same_user_fk
  foreign key (proposal_id, user_id)
  references public.proposals (id, user_id)
  on delete restrict;

alter table public.contracts
  add constraint contracts_client_same_user_fk
  foreign key (client_id, user_id)
  references public.clients (id, user_id)
  on delete restrict;

create unique index contracts_user_number_unique
  on public.contracts (user_id, number);

create index contracts_user_created_at_idx
  on public.contracts (user_id, created_at desc);

create trigger contracts_set_updated_at
before update on public.contracts
for each row
execute function public.set_updated_at();

alter table public.contracts enable row level security;

create policy "Users can read their own contracts"
  on public.contracts for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can create their own contracts"
  on public.contracts for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own contracts"
  on public.contracts for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can delete their own contracts"
  on public.contracts for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.contracts to authenticated;

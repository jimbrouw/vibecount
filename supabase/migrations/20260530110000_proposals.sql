create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  number text not null,
  proposal_date date not null default current_date,
  valid_until date,
  status text not null default 'draft',
  title text not null,
  scope text not null default '',
  deliverables text not null default '',
  timeline_start date,
  timeline_end date,
  payment_terms text not null default 'Net 30',
  notes text,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint proposals_status_valid
    check (status in ('draft', 'sent', 'accepted', 'declined')),
  constraint proposals_number_not_blank
    check (length(btrim(number)) > 0),
  constraint proposals_title_not_blank
    check (length(btrim(title)) > 0)
);

alter table public.proposals
  add constraint proposals_client_same_user_fk
  foreign key (client_id, user_id)
  references public.clients (id, user_id)
  on delete restrict;

alter table public.proposals
  add constraint proposals_id_user_id_unique unique (id, user_id);

create unique index proposals_user_number_unique
  on public.proposals (user_id, number);

create index proposals_user_created_at_idx
  on public.proposals (user_id, created_at desc);

create trigger proposals_set_updated_at
before update on public.proposals
for each row
execute function public.set_updated_at();

create table public.proposal_line_items (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  service_id uuid,
  description text not null,
  quantity numeric(10, 2) not null default 1,
  unit_price numeric(12, 2) not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint proposal_line_items_description_not_blank
    check (length(btrim(description)) > 0),
  constraint proposal_line_items_quantity_positive
    check (quantity > 0),
  constraint proposal_line_items_unit_price_positive
    check (unit_price > 0)
);

alter table public.proposal_line_items
  add constraint proposal_line_items_proposal_same_user_fk
  foreign key (proposal_id, user_id)
  references public.proposals (id, user_id)
  on delete cascade;

alter table public.proposal_line_items
  add constraint proposal_line_items_service_fk
  foreign key (service_id)
  references public.services (id)
  on delete set null;

create index proposal_line_items_proposal_idx
  on public.proposal_line_items (proposal_id, sort_order);

create trigger proposal_line_items_set_updated_at
before update on public.proposal_line_items
for each row
execute function public.set_updated_at();

alter table public.proposals enable row level security;
alter table public.proposal_line_items enable row level security;

create policy "Users can read their own proposals"
  on public.proposals for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can create their own proposals"
  on public.proposals for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own proposals"
  on public.proposals for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can delete their own proposals"
  on public.proposals for delete to authenticated
  using (auth.uid() = user_id);

create policy "Users can read their own proposal line items"
  on public.proposal_line_items for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can create their own proposal line items"
  on public.proposal_line_items for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own proposal line items"
  on public.proposal_line_items for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can delete their own proposal line items"
  on public.proposal_line_items for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.proposals to authenticated;
grant select, insert, update, delete on public.proposal_line_items to authenticated;

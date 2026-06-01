alter table public.clients
  add column if not exists email text not null default '';

alter table public.clients
  add constraint clients_email_valid
  check (
    email = ''
    or email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  );

alter table public.invoices
  add column if not exists sent_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists due_date date,
  add column if not exists delivery_status text not null default 'not_sent',
  add column if not exists reminder_enabled boolean not null default false,
  add column if not exists reminder_schedule jsonb not null default '{"firstReminderDaysAfterDue":3,"repeatEveryDays":7,"maxReminders":3}'::jsonb,
  add column if not exists next_reminder_at timestamptz;

alter table public.invoices
  add constraint invoices_delivery_status_valid
  check (delivery_status in ('not_sent', 'sent', 'paid'));

create index if not exists invoices_due_reminders_idx
  on public.invoices (next_reminder_at)
  where reminder_enabled = true and paid_at is null;

create table if not exists public.invoice_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid not null,
  client_id uuid not null,
  recipient_email text not null,
  subject text not null,
  message text not null,
  status text not null default 'pending',
  provider_message_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_reminders_recipient_email_valid check (
    recipient_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint invoice_reminders_subject_not_blank check (length(btrim(subject)) > 0),
  constraint invoice_reminders_message_not_blank check (length(btrim(message)) > 0),
  constraint invoice_reminders_status_valid check (status in ('pending', 'sent', 'failed', 'skipped'))
);

alter table public.invoice_reminders
  add constraint invoice_reminders_invoice_same_user_fk
  foreign key (invoice_id, user_id)
  references public.invoices (id, user_id)
  on delete cascade;

alter table public.invoice_reminders
  add constraint invoice_reminders_client_same_user_fk
  foreign key (client_id, user_id)
  references public.clients (id, user_id)
  on delete restrict;

create index if not exists invoice_reminders_invoice_created_idx
  on public.invoice_reminders (invoice_id, created_at desc);

create trigger invoice_reminders_set_updated_at
before update on public.invoice_reminders
for each row
execute function public.set_updated_at();

alter table public.invoice_reminders enable row level security;

create policy "Users can read their own invoice reminders"
on public.invoice_reminders
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create their own invoice reminders"
on public.invoice_reminders
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own invoice reminders"
on public.invoice_reminders
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update on public.invoice_reminders to authenticated;

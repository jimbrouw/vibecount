-- Agent sessions: short-lived scoped tokens for external browser agents.
-- Tokens are stored as SHA-256 hashes — the plaintext is shown to the user once and never stored.
create table public.agent_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null,
  label text not null default '',
  scopes text[] not null default '{}',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),

  constraint agent_sessions_token_hash_unique unique (token_hash),
  constraint agent_sessions_scopes_valid check (
    scopes <@ array[
      'read:records', 'read:invoices', 'read:pl_summary',
      'draft:record', 'draft:invoice'
    ]::text[]
  )
);

create index agent_sessions_user_idx on public.agent_sessions (user_id, created_at desc);
create index agent_sessions_token_idx on public.agent_sessions (token_hash) where revoked_at is null;

-- Audit log: every agent tool call, read or write, creates an immutable row.
create table public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.agent_sessions(id) on delete set null,
  tool text not null,
  scope_used text not null,
  params_summary text not null default '',
  result_status text not null default 'ok',
  error text,
  created_at timestamptz not null default now(),

  constraint agent_actions_result_status_valid
    check (result_status in ('ok', 'error', 'denied'))
);

create index agent_actions_user_idx on public.agent_actions (user_id, created_at desc);

alter table public.agent_sessions enable row level security;
alter table public.agent_actions enable row level security;

create policy "Users can read their own agent sessions"
  on public.agent_sessions for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can create their own agent sessions"
  on public.agent_sessions for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own agent sessions"
  on public.agent_sessions for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can read their own agent actions"
  on public.agent_actions for select to authenticated
  using (auth.uid() = user_id);

grant select, insert, update on public.agent_sessions to authenticated;
grant select, insert on public.agent_actions to authenticated;

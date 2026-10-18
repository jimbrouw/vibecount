-- Prepared delivery records an authenticated request, not proof that a browser saved/read it.
create table public.document_original_access (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 document_id uuid not null,
 file_hash text not null check(file_hash ~ '^[a-f0-9]{64}$'),
 size_bytes integer not null check(size_bytes between 1 and 3000000),
 event text not null default 'download_prepared' check(event='download_prepared'),
 created_at timestamptz not null default now(),
 foreign key(document_id,user_id) references public.evidence_documents(id,user_id)
);
alter table public.document_original_access enable row level security;
revoke all on public.document_original_access from public,anon,authenticated,service_role;
grant select,insert on public.document_original_access to service_role;
grant select on public.document_original_access to authenticated;
create policy document_original_access_owner on public.document_original_access for select to authenticated using(user_id=auth.uid());

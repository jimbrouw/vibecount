create table public.source_original_access (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 import_id uuid not null,
 source_file_id uuid not null,
 account_id uuid not null,
 file_hash text not null check(file_hash ~ '^[a-f0-9]{64}$'),
 size_bytes integer not null check(size_bytes between 1 and 1000000),
 event text not null default 'download_prepared' check(event='download_prepared'),
 created_at timestamptz not null default now(),
 foreign key(import_id,user_id) references public.record_imports(id,user_id),
 foreign key(source_file_id,user_id,account_id,file_hash) references public.record_source_files(id,user_id,account_id,file_hash)
);
alter table public.source_original_access enable row level security;
revoke all on public.source_original_access from public,anon,authenticated,service_role;
grant select,insert on public.source_original_access to service_role;
grant select on public.source_original_access to authenticated;
create policy source_original_access_owner on public.source_original_access for select to authenticated using(user_id=auth.uid());

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'record-attachments',
  'record-attachments',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/csv'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.record_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid references public.financial_records(id) on delete set null,
  bucket_id text not null default 'record-attachments',
  object_path text not null,
  original_filename text not null,
  content_type text not null,
  size_bytes bigint not null,
  status text not null default 'active',
  uploaded_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint record_attachments_bucket_valid check (bucket_id = 'record-attachments'),
  constraint record_attachments_path_not_blank check (length(btrim(object_path)) > 0),
  constraint record_attachments_filename_not_blank check (length(btrim(original_filename)) > 0),
  constraint record_attachments_content_type_valid check (
    content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/csv')
  ),
  constraint record_attachments_size_positive check (size_bytes > 0),
  constraint record_attachments_status_valid check (status in ('active', 'deleted'))
);

alter table public.financial_records
  add constraint financial_records_id_user_id_unique unique (id, user_id);

alter table public.record_attachments
  add constraint record_attachments_record_same_user_fk
  foreign key (record_id, user_id)
  references public.financial_records (id, user_id)
  on delete set null (record_id);

create unique index record_attachments_object_path_unique
  on public.record_attachments (bucket_id, object_path);

create index record_attachments_user_record_idx
  on public.record_attachments (user_id, record_id, uploaded_at desc);

create trigger record_attachments_set_updated_at
before update on public.record_attachments
for each row
execute function public.set_updated_at();

create table public.record_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  export_type text not null,
  tax_year_start integer,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  record_count integer not null default 0,
  attachment_count integer not null default 0,
  constraint record_exports_type_valid check (export_type in ('json', 'csv', 'accountant_pack'))
);

create index record_exports_user_requested_at_idx
  on public.record_exports (user_id, requested_at desc);

alter table public.record_attachments enable row level security;
alter table public.record_exports enable row level security;

create policy "Users can read their own record attachments"
on public.record_attachments
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create their own record attachments"
on public.record_attachments
for insert
to authenticated
with check (
  auth.uid() = user_id
  and bucket_id = 'record-attachments'
  and split_part(object_path, '/', 1) = auth.uid()::text
);

create policy "Users can update their own record attachments"
on public.record_attachments
for update
to authenticated
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and bucket_id = 'record-attachments'
  and split_part(object_path, '/', 1) = auth.uid()::text
);

create policy "Users can delete their own record attachments"
on public.record_attachments
for delete
to authenticated
using (auth.uid() = user_id);

create policy "Users can read their own record exports"
on public.record_exports
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create their own record exports"
on public.record_exports
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own record exports"
on public.record_exports
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can upload their own record attachment files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'record-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can read their own record attachment files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'record-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can update their own record attachment files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'record-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'record-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can delete their own record attachment files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'record-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

grant select, insert, update, delete on public.record_attachments to authenticated;
grant select, insert, update on public.record_exports to authenticated;

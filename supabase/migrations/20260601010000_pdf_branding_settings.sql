alter table public.user_settings
  add column if not exists pdf_logo_path text not null default '',
  add column if not exists pdf_primary_color text not null default '#1a3a2a',
  add column if not exists pdf_accent_color text not null default '#f5f0e8';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand-assets', 'brand-assets', false, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do update
set public = false,
    file_size_limit = 2097152,
    allowed_mime_types = array['image/png', 'image/jpeg'];

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users can upload their own brand assets'
  ) then
    create policy "Users can upload their own brand assets"
      on storage.objects for insert to authenticated
      with check (bucket_id = 'brand-assets' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users can read their own brand assets'
  ) then
    create policy "Users can read their own brand assets"
      on storage.objects for select to authenticated
      using (bucket_id = 'brand-assets' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users can replace their own brand assets'
  ) then
    create policy "Users can replace their own brand assets"
      on storage.objects for update to authenticated
      using (bucket_id = 'brand-assets' and (storage.foldername(name))[1] = auth.uid()::text)
      with check (bucket_id = 'brand-assets' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users can delete their own brand assets'
  ) then
    create policy "Users can delete their own brand assets"
      on storage.objects for delete to authenticated
      using (bucket_id = 'brand-assets' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;

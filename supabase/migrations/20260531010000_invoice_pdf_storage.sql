-- Private storage bucket for invoice PDFs
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

-- Users can upload their own invoice PDFs
create policy "Users can upload their own invoice PDFs"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'invoices' and (storage.foldername(name))[1] = auth.uid()::text);

-- Users can read their own invoice PDFs
create policy "Users can read their own invoice PDFs"
  on storage.objects for select to authenticated
  using (bucket_id = 'invoices' and (storage.foldername(name))[1] = auth.uid()::text);

-- Users can replace their own invoice PDFs
create policy "Users can update their own invoice PDFs"
  on storage.objects for update to authenticated
  using (bucket_id = 'invoices' and (storage.foldername(name))[1] = auth.uid()::text);

-- Add pdf_path to quotes and proposals tables for Supabase Storage backup
alter table public.quotes add column if not exists pdf_path text;
alter table public.proposals add column if not exists pdf_path text;

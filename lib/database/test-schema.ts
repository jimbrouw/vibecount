// Minimal Supabase schema for isolated PostgreSQL tests. No production connection.
export const TEST_SCHEMA_BOOTSTRAP = `
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets(id text primary key, name text not null, public boolean default false,
      file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets(id), name text not null);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$
      select (string_to_array($1, '/'))[1:greatest(array_length(string_to_array($1, '/'), 1)-1, 0)]
    $$;
    grant usage on schema storage to authenticated, service_role;
    grant select, insert, update, delete on storage.objects to authenticated, service_role;
`;

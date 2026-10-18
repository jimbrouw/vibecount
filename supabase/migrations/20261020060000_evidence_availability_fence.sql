-- Inactive deletion foundation: no application role can create a target yet.
-- Request confirmation, exact scope checks and object erasure are separate gates.
create table public.evidence_deletion_targets (
 user_id uuid not null references auth.users(id),request_id uuid not null,
 bucket_id text not null check(bucket_id in ('source-evidence','document-evidence')),
 object_path text not null,file_hash text not null check(file_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),primary key(bucket_id,object_path)
);
create index evidence_deletion_content on public.evidence_deletion_targets(user_id,bucket_id,file_hash);
alter table public.evidence_deletion_targets enable row level security;
revoke all on public.evidence_deletion_targets from public,anon,authenticated,service_role;
create trigger immutable_evidence_deletion_target before update or delete on public.evidence_deletion_targets for each row execute function public.reject_source_mutation();

-- Same shape as Storage metadata, but withheld originals cannot be considered present.
create view public.available_evidence_objects with(security_invoker=true) as
 select o.* from storage.objects o where not exists(
  select 1 from public.evidence_deletion_targets d where d.bucket_id=o.bucket_id and d.object_path=o.name
 );
revoke all on public.available_evidence_objects from public,anon,authenticated,service_role;

create function public.validate_evidence_deletion_target() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Existing FOR SHARE readers lock Storage rows; existing table freezes also
 -- acquire this relation through available_evidence_objects. NOWAIT fails closed.
 lock table storage.objects in exclusive mode nowait;
 if new.object_path not like new.user_id::text||'/%' then raise exception 'Owned evidence target required.'; end if;
 if new.bucket_id='source-evidence' then
  if not exists(select 1 from public.record_source_files where user_id=new.user_id and file_hash=new.file_hash and object_path=new.object_path)
   and not exists(select 1 from public.source_upload_attempts where user_id=new.user_id and file_hash=new.file_hash and object_path=new.object_path) then raise exception 'Owned evidence target required.'; end if;
 else
  if not exists(select 1 from public.evidence_documents where user_id=new.user_id and file_hash=new.file_hash and object_path=new.object_path)
   and not exists(select 1 from public.document_upload_attempts a cross join lateral jsonb_array_elements(a.planned_objects) v where a.user_id=new.user_id and v->>'hash'=new.file_hash and v->>'path'=new.object_path) then raise exception 'Owned evidence target required.'; end if;
 end if;
 return new;
end $$;
revoke all on function public.validate_evidence_deletion_target() from public,anon,authenticated,service_role;
create trigger validate_evidence_deletion_target before insert on public.evidence_deletion_targets for each row execute function public.validate_evidence_deletion_target();

-- Preserve installed function identities, grants and retained contracts. Both
-- availability SELECTs and explicit LOCK TABLE freezes use the same view.
-- PostgreSQL recursively locks the view's backing relations in the same mode.
do $$declare f record; definition text;begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.prosrc like '%storage.objects%'
   and p.proname not in ('preview_evidence_deletion','validate_evidence_deletion_target')
 loop
  definition:=pg_get_functiondef(f.oid);
  if definition ~* '(insert into|delete from|update)[[:space:]]+storage[.]objects' then raise exception 'Unexpected Storage mutation requires explicit migration review.'; end if;
  execute replace(definition,'storage.objects','public.available_evidence_objects');
 end loop;
end $$;
-- These freezes reach documents without necessarily mentioning Storage themselves.
alter function public.freeze_tax_calculation_inputs() rename to freeze_tax_calculation_inputs_v93;
revoke all on function public.freeze_tax_calculation_inputs_v93() from public,anon,authenticated,service_role;
create function public.freeze_tax_calculation_inputs() returns void language plpgsql set search_path='' as $$begin
 lock table public.available_evidence_objects in share mode nowait;
 perform public.freeze_tax_calculation_inputs_v93();
end $$;
revoke all on function public.freeze_tax_calculation_inputs() from public,anon,authenticated,service_role;

create function public.evidence_original_available(p_owner uuid,p_kind text,p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select case when p_kind='document' then exists(
  select 1 from public.evidence_documents d join public.available_evidence_objects o on o.bucket_id='document-evidence' and o.name=d.object_path where d.id=p_id and d.user_id=p_owner
 ) when p_kind='source' then exists(
  select 1 from public.record_imports i join public.record_source_files f on f.id=i.source_file_id and f.user_id=i.user_id and f.account_id=i.account_id and f.file_hash=i.file_hash
  join public.available_evidence_objects o on o.bucket_id='source-evidence' and o.name=f.object_path where i.id=p_id and i.user_id=p_owner
 ) else false end;
$$;
revoke all on function public.evidence_original_available(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.evidence_original_available(uuid,text,uuid) to service_role;

create function public.guard_original_access_availability() returns trigger language plpgsql security definer set search_path='' as $$
begin
 lock table public.available_evidence_objects in share mode;
 if tg_table_name='document_original_access' then
  if not exists(select 1 from public.evidence_documents d join public.available_evidence_objects o on o.bucket_id='document-evidence' and o.name=d.object_path
   where d.id=new.document_id and d.user_id=new.user_id and d.file_hash=new.file_hash and d.size_bytes=new.size_bytes) then raise exception 'Original evidence unavailable.'; end if;
 else
  if not exists(select 1 from public.record_imports i join public.record_source_files f on f.id=i.source_file_id and f.user_id=i.user_id and f.account_id=i.account_id and f.file_hash=i.file_hash
   join public.available_evidence_objects o on o.bucket_id='source-evidence' and o.name=f.object_path
   where i.id=new.import_id and i.user_id=new.user_id and f.id=new.source_file_id and f.account_id=new.account_id and f.file_hash=new.file_hash and f.size_bytes=new.size_bytes) then raise exception 'Original evidence unavailable.'; end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_original_access_availability() from public,anon,authenticated,service_role;
create trigger document_access_availability before insert on public.document_original_access for each row execute function public.guard_original_access_availability();
create trigger source_access_availability before insert on public.source_original_access for each row execute function public.guard_original_access_availability();

create function public.assert_upload_evidence_retained(p_owner uuid,p_bucket text,p_hashes text[]) returns void
language plpgsql security definer set search_path='' as $$begin
 lock table public.evidence_deletion_targets in share mode;
 if exists(select 1 from public.evidence_deletion_targets where user_id=p_owner and bucket_id=p_bucket and file_hash=any(p_hashes)) then raise exception 'Evidence is marked for deletion and cannot be restored or registered.'; end if;
end $$;
revoke all on function public.assert_upload_evidence_retained(uuid,text,text[]) from public,anon,authenticated,service_role;
create function public.guard_upload_evidence_retained() returns trigger language plpgsql security definer set search_path='' as $$declare hashes text[];begin
 if tg_table_name='source_upload_attempts' then
  perform public.assert_upload_evidence_retained(new.user_id,'source-evidence',array[new.file_hash]);
 else
  select array_agg(h) into hashes from(select new.file_hash h union select v->>'hash' from jsonb_array_elements(new.planned_objects) v) s;
  perform public.assert_upload_evidence_retained(new.user_id,'document-evidence',hashes);
 end if;
 return new;
end $$;
revoke all on function public.guard_upload_evidence_retained() from public,anon,authenticated,service_role;
create trigger retained_source_upload before insert or update on public.source_upload_attempts for each row execute function public.guard_upload_evidence_retained();
create trigger retained_document_upload before insert or update on public.document_upload_attempts for each row execute function public.guard_upload_evidence_retained();

alter function public.ingest_source_csv(uuid,uuid,text,text,jsonb,jsonb) rename to ingest_source_csv_v93;
revoke all on function public.ingest_source_csv_v93(uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.ingest_source_csv(p_owner uuid,p_attempt uuid,p_filename text,p_parser text,p_mapping jsonb,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$declare hash text;begin
 select file_hash into hash from public.source_upload_attempts where id=p_attempt and user_id=p_owner;
 if not found then raise exception 'Owned upload attempt unavailable.'; end if;
 perform public.assert_upload_evidence_retained(p_owner,'source-evidence',array[hash]);
 return public.ingest_source_csv_v93(p_owner,p_attempt,p_filename,p_parser,p_mapping,p_rows);
end $$;
revoke all on function public.ingest_source_csv(uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.ingest_source_csv(uuid,uuid,text,text,jsonb,jsonb) to service_role;
alter function public.register_document_intake(uuid,uuid,integer,text,text) rename to register_document_intake_v93;
revoke all on function public.register_document_intake_v93(uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
create function public.register_document_intake(p_owner uuid,p_attempt uuid,p_year integer,p_purpose text,p_parser text) returns jsonb
language plpgsql security definer set search_path='' as $$declare a public.document_upload_attempts;hashes text[];begin
 select * into a from public.document_upload_attempts where id=p_attempt and user_id=p_owner;
 if not found then raise exception 'Owned upload attempt unavailable.'; end if;
 select array_agg(h) into hashes from(select a.file_hash h union select v->>'hash' from jsonb_array_elements(a.planned_objects) v) s;
 perform public.assert_upload_evidence_retained(p_owner,'document-evidence',hashes);
 return public.register_document_intake_v93(p_owner,p_attempt,p_year,p_purpose,p_parser);
end $$;
revoke all on function public.register_document_intake(uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.register_document_intake(uuid,uuid,integer,text,text) to service_role;

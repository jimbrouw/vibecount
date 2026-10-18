-- Only confirmed original ciphertext/name copies may become NULL. Retained
-- identities, normalized financial facts and every other immutable field stay.
create table public.evidence_deletion_scrubs (
 request_id uuid primary key,user_id uuid not null,
 raw_rows bigint not null check(raw_rows>=0),batch_names bigint not null check(batch_names>=0),planned_names bigint not null check(planned_names>=0),
 created_at timestamptz not null default now(),
 foreign key(request_id,user_id) references public.evidence_deletion_requests(id,user_id)
);
alter table public.evidence_deletion_scrubs enable row level security;
revoke all on public.evidence_deletion_scrubs from public,anon,authenticated,service_role;
create trigger immutable_evidence_deletion_scrub before update or delete on public.evidence_deletion_scrubs for each row execute function public.reject_source_mutation();

create function public.confirmed_evidence_target(p_owner uuid,p_bucket text,p_path text,p_hash text) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.evidence_deletion_targets t join public.evidence_deletion_requests r on r.id=t.request_id and r.user_id=t.user_id
  where t.user_id=p_owner and t.bucket_id=p_bucket and t.object_path=p_path and t.file_hash=p_hash);
$$;
revoke all on function public.confirmed_evidence_target(uuid,text,text,text) from public,anon,authenticated,service_role;
create function public.scrubbed_document_plan(p_plan jsonb) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(case when v?'name_encrypted' then v||jsonb_build_object('name_encrypted',null) else v end order by n),'[]'::jsonb)
 from jsonb_array_elements(p_plan) with ordinality entries(v,n);
$$;
revoke all on function public.scrubbed_document_plan(jsonb) from public,anon,authenticated,service_role;
create function public.document_attempt_scrub_allowed(p_old jsonb,p_new jsonb) returns boolean language sql stable set search_path='' as $$
 select (p_new-'planned_objects'-'object_count')=(p_old-'planned_objects'-'object_count')
  and p_new->'planned_objects'=public.scrubbed_document_plan(p_old->'planned_objects')
  and p_new->'planned_objects' is distinct from p_old->'planned_objects'
  and exists(select 1 from public.evidence_deletion_requests r where r.user_id=(p_old->>'user_id')::uuid and r.kind='document'
   and jsonb_array_length(p_old->'planned_objects')>0 and not exists(
    select 1 from jsonb_array_elements(p_old->'planned_objects') v where not exists(
     select 1 from public.evidence_deletion_targets t where t.request_id=r.id and t.user_id=r.user_id
      and t.bucket_id='document-evidence' and t.object_path=v->>'path' and t.file_hash=v->>'hash'
   )));
$$;
revoke all on function public.document_attempt_scrub_allowed(jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.guard_original_ciphertext_mutation() returns trigger language plpgsql set search_path='' as $$declare allowed boolean:=false;begin
 if tg_op='INSERT' then
  if (tg_table_name='source_rows' and to_jsonb(new)->>'raw_encrypted' is null)
   or (tg_table_name='document_batch_items' and to_jsonb(new)->>'original_name_encrypted' is null) then raise exception 'New evidence requires preserved ciphertext.';end if;
  return new;
 end if;
 if tg_op='UPDATE' and current_user not in ('anon','authenticated','service_role') then
  if tg_table_name='source_rows' then
   if new.raw_encrypted is null and old.raw_encrypted is not null and (to_jsonb(new)-'raw_encrypted')=(to_jsonb(old)-'raw_encrypted') then
    select exists(select 1 from public.record_imports i join public.record_source_files f on f.id=i.source_file_id and f.user_id=i.user_id
     where i.id=old.import_id and i.user_id=old.user_id and public.confirmed_evidence_target(f.user_id,'source-evidence',f.object_path,f.file_hash)) into allowed;
   end if;
  else
   if new.original_name_encrypted is null and old.original_name_encrypted is not null and (to_jsonb(new)-'original_name_encrypted')=(to_jsonb(old)-'original_name_encrypted') then
    select exists(select 1 from public.evidence_documents d where d.id=old.document_id and d.user_id=old.user_id
     and public.confirmed_evidence_target(d.user_id,'document-evidence',d.object_path,d.file_hash)) into allowed;
   end if;
  end if;
 end if;
 if not allowed then raise exception 'Preserved evidence is immutable except confirmed ciphertext removal.';end if;
 return new;
end $$;
revoke all on function public.guard_original_ciphertext_mutation() from public,anon,authenticated,service_role;
alter table public.source_rows alter column raw_encrypted drop not null;
alter table public.document_batch_items alter column original_name_encrypted drop not null;
drop trigger immutable_source_row on public.source_rows;
create trigger immutable_source_row before insert or update or delete on public.source_rows for each row execute function public.guard_original_ciphertext_mutation();
drop trigger immutable_document_items on public.document_batch_items;
create trigger immutable_document_items before insert or update or delete on public.document_batch_items for each row execute function public.guard_original_ciphertext_mutation();

-- Keep normal upload identity/state guards intact; add only the exact scrub
-- transition. The invoker guard denies direct service-role plan mutations.
do $$declare definition text;needle text;begin
 select pg_get_functiondef('public.protect_upload_attempt_identity()'::regprocedure) into definition;
 needle:='if tg_op=''DELETE'' then';
 if position(needle in definition)=0 then raise exception 'Inspect upload identity predecessor.';end if;
 execute replace(definition,needle,$guard$
 if tg_op='UPDATE' and tg_table_name='document_upload_attempts' and current_user not in ('anon','authenticated','service_role') then
  if public.document_attempt_scrub_allowed(to_jsonb(old),to_jsonb(new)) then return new;end if;
 end if;
 $guard$||needle);
 select pg_get_functiondef('public.guard_upload_evidence_retained()'::regprocedure) into definition;
 needle:='if tg_table_name=''source_upload_attempts'' then';
 if position(needle in definition)=0 then raise exception 'Inspect upload retention predecessor.';end if;
 execute replace(definition,needle,$guard$
 if tg_op='UPDATE' and tg_table_name='document_upload_attempts' then
  if public.document_attempt_scrub_allowed(to_jsonb(old),to_jsonb(new)) then return new;end if;
 end if;
 $guard$||needle);
end $$;

create function public.scrub_evidence_deletion_request(p_owner uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare request public.evidence_deletion_requests;prior public.evidence_deletion_scrubs;raw_count bigint:=0;batch_count bigint:=0;planned_count bigint:=0;begin
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||p_owner::text,0));
 select * into request from public.evidence_deletion_requests where id=p_request and user_id=p_owner;
 if not found then raise exception 'Owned confirmed deletion request required.';end if;
 select * into prior from public.evidence_deletion_scrubs where request_id=p_request and user_id=p_owner;
 if found then return to_jsonb(prior);end if;
 lock table public.source_rows,public.document_batch_items,public.document_upload_attempts in share row exclusive mode nowait;
 if request.kind='source' then
  update public.source_rows s set raw_encrypted=null where s.user_id=p_owner and s.raw_encrypted is not null and exists(
   select 1 from public.record_imports i join public.record_source_files f on f.id=i.source_file_id and f.user_id=i.user_id
   join public.evidence_deletion_targets t on t.user_id=f.user_id and t.object_path=f.object_path and t.file_hash=f.file_hash and t.bucket_id='source-evidence'
   where i.id=s.import_id and i.user_id=s.user_id and t.request_id=p_request);
  get diagnostics raw_count=row_count;
 else
  update public.document_batch_items i set original_name_encrypted=null where i.user_id=p_owner and i.original_name_encrypted is not null and exists(
   select 1 from public.evidence_documents d join public.evidence_deletion_targets t on t.user_id=d.user_id and t.object_path=d.object_path and t.file_hash=d.file_hash and t.bucket_id='document-evidence'
   where d.id=i.document_id and d.user_id=i.user_id and t.request_id=p_request);
  get diagnostics batch_count=row_count;
  select count(*) into planned_count from public.document_upload_attempts a cross join lateral jsonb_array_elements(a.planned_objects) v
   where a.user_id=p_owner and v->>'name_encrypted' is not null and exists(select 1 from public.evidence_deletion_targets t where t.request_id=p_request and t.user_id=a.user_id and t.bucket_id='document-evidence' and t.object_path=v->>'path' and t.file_hash=v->>'hash');
  update public.document_upload_attempts a set planned_objects=public.scrubbed_document_plan(a.planned_objects) where a.user_id=p_owner
   and exists(select 1 from jsonb_array_elements(a.planned_objects) v join public.evidence_deletion_targets t on t.user_id=a.user_id and t.bucket_id='document-evidence' and t.object_path=v->>'path' and t.file_hash=v->>'hash'
    where t.request_id=p_request and v->>'name_encrypted' is not null);
 end if;
 insert into public.evidence_deletion_scrubs(request_id,user_id,raw_rows,batch_names,planned_names) values(p_request,p_owner,raw_count,batch_count,planned_count) returning * into prior;
 return to_jsonb(prior);
end $$;
revoke all on function public.scrub_evidence_deletion_request(uuid,uuid) from public,anon,authenticated,service_role;

-- Preview counts are remaining ciphertext copies, not retained row identities.
do $$declare definition text;changed text;begin
 select pg_get_functiondef('public.preview_evidence_deletion_v98(text,uuid)'::regprocedure) into definition;
 changed:=replace(definition,'count(*) into rows_snapshot,raw_rows','count(raw_encrypted) into rows_snapshot,raw_rows');
 changed:=replace(changed,'count(*) into items,encrypted_names','count(original_name_encrypted) into items,encrypted_names');
 if changed=definition then raise exception 'Inspect ciphertext inventory predecessor.';end if;execute changed;
end $$;

-- Dropping NOT NULL must not permit new missing originals or rehydration into
-- a targeted import/document through the old service insertion grants.
create function public.guard_new_original_ciphertext() returns trigger language plpgsql security definer set search_path='' as $$declare targeted boolean;begin
 lock table public.evidence_deletion_targets in share mode;
 if tg_table_name='source_rows' then
  select exists(select 1 from public.record_imports i join public.record_source_files f on f.id=i.source_file_id and f.user_id=i.user_id
   join public.evidence_deletion_targets t on t.user_id=f.user_id and t.bucket_id='source-evidence' and t.object_path=f.object_path
   where i.id=new.import_id and i.user_id=new.user_id) into targeted;
 else
  select exists(select 1 from public.evidence_documents d join public.evidence_deletion_targets t on t.user_id=d.user_id and t.bucket_id='document-evidence' and t.object_path=d.object_path
   where d.id=new.document_id and d.user_id=new.user_id) into targeted;
 end if;
 if targeted then raise exception 'Evidence is marked for deletion and cannot receive new ciphertext copies.';end if;
 return new;
end $$;
revoke all on function public.guard_new_original_ciphertext() from public,anon,authenticated,service_role;
create trigger retained_new_source_ciphertext before insert on public.source_rows for each row execute function public.guard_new_original_ciphertext();
create trigger retained_new_document_ciphertext before insert on public.document_batch_items for each row execute function public.guard_new_original_ciphertext();

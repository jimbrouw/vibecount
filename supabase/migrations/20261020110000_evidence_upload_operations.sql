-- Durable admission for each external upload. An unresolved operation never
-- expires automatically: loss of an HTTP response does not prove quiescence.
create table public.evidence_upload_operations (
 id uuid primary key,user_id uuid not null references auth.users(id),
 kind text not null check(kind in ('source','document')),attempt_id uuid not null,
 bucket_id text not null check(bucket_id in ('source-evidence','document-evidence')),
 object_path text not null,file_hash text not null check(file_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),unique(id,user_id)
);
create index evidence_upload_object on public.evidence_upload_operations(bucket_id,object_path);
create index evidence_upload_content on public.evidence_upload_operations(user_id,bucket_id,file_hash);
create table public.evidence_upload_completions (
 operation_id uuid primary key,user_id uuid not null,created_at timestamptz not null default now(),
 foreign key(operation_id,user_id) references public.evidence_upload_operations(id,user_id)
);
alter table public.evidence_upload_operations enable row level security;
alter table public.evidence_upload_completions enable row level security;
revoke all on public.evidence_upload_operations,public.evidence_upload_completions from public,anon,authenticated,service_role;
create trigger immutable_evidence_upload_operation before update or delete on public.evidence_upload_operations for each row execute function public.reject_source_mutation();
create trigger immutable_evidence_upload_completion before update or delete on public.evidence_upload_completions for each row execute function public.reject_source_mutation();

create function public.begin_evidence_upload(p_owner uuid,p_kind text,p_attempt uuid,p_path text,p_operation uuid) returns boolean
language plpgsql security definer set search_path='' as $$declare hash text;bucket text;begin
 if p_owner is null or p_attempt is null or p_operation is null or p_path is null then raise exception 'Owned upload operation required.';end if;
 -- Same lock order as registration; target insertion holds RowExclusive here.
 perform public.assert_evidence_attempt_retained(p_owner,p_kind,p_attempt);
 if p_kind='source' then
  bucket:='source-evidence';
  select file_hash into hash from public.source_upload_attempts where id=p_attempt and user_id=p_owner and object_path=p_path;
 else
  bucket:='document-evidence';
  select v->>'hash' into hash from public.document_upload_attempts a cross join lateral jsonb_array_elements(a.planned_objects) v
   where a.id=p_attempt and a.user_id=p_owner and v->>'path'=p_path;
 end if;
 if hash is null or p_path not like p_owner::text||'/%' then raise exception 'Owned planned evidence object required.';end if;
 -- Serialize competing requests for this exact destination before starting I/O.
 perform pg_advisory_xact_lock(hashtextextended('evidence-upload:'||bucket||':'||p_path,0));
 if exists(select 1 from public.evidence_upload_operations o where o.bucket_id=bucket and o.object_path=p_path
  and not exists(select 1 from public.evidence_upload_completions c where c.operation_id=o.id)) then
  raise exception 'An earlier upload has an unresolved outcome. Reconcile it before retrying.';
 end if;
 -- Never replay admission: a lost begin response must not permit another send.
 insert into public.evidence_upload_operations(id,user_id,kind,attempt_id,bucket_id,object_path,file_hash)
 values(p_operation,p_owner,p_kind,p_attempt,bucket,p_path,hash);
 return true;
end $$;
revoke all on function public.begin_evidence_upload(uuid,text,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.begin_evidence_upload(uuid,text,uuid,text,uuid) to service_role;

create function public.completed_evidence_upload(p_owner uuid,p_operation uuid) returns boolean
language plpgsql security definer set search_path='' as $$declare operation public.evidence_upload_operations;begin
 select * into operation from public.evidence_upload_operations where id=p_operation and user_id=p_owner for update;
 if not found then raise exception 'Owned upload operation unavailable.';end if;
 if exists(select 1 from public.evidence_upload_completions where operation_id=p_operation and user_id=p_owner) then return true;end if;
 -- Caller only invokes this after successful provider acknowledgement. Presence
 -- is an additional check, never a substitute for that acknowledgement.
 if not exists(select 1 from storage.objects where bucket_id=operation.bucket_id and name=operation.object_path) then raise exception 'Acknowledged evidence object unavailable.';end if;
 insert into public.evidence_upload_completions(operation_id,user_id) values(p_operation,p_owner);
 return true;
end $$;
revoke all on function public.completed_evidence_upload(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.completed_evidence_upload(uuid,uuid) to service_role;

create function public.guard_evidence_target_uploads() returns trigger language plpgsql security definer set search_path='' as $$begin
 -- A concurrent admission has RowExclusive on operations. NOWAIT makes the
 -- target fail closed rather than waiting in the inverse target/admission order.
 lock table public.evidence_upload_operations in share mode nowait;
 if exists(select 1 from public.evidence_upload_operations o
  where o.user_id=new.user_id and o.bucket_id=new.bucket_id and o.file_hash=new.file_hash
   and not exists(select 1 from public.evidence_upload_completions c where c.operation_id=o.id)) then
  raise exception 'Evidence upload outcome is unresolved. Deletion cannot begin.';
 end if;
 return new;
end $$;
revoke all on function public.guard_evidence_target_uploads() from public,anon,authenticated,service_role;
create trigger evidence_target_uploads before insert on public.evidence_deletion_targets for each row execute function public.guard_evidence_target_uploads();

alter function public.preview_evidence_deletion(text,uuid) rename to preview_evidence_deletion_v98;
revoke all on function public.preview_evidence_deletion_v98(text,uuid) from public,anon,authenticated,service_role;
create function public.preview_evidence_deletion(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare result jsonb;operations jsonb;pending bigint;total bigint;hashes text[];bucket text;begin
 result:=public.preview_evidence_deletion_v98(p_kind,p_id);
 select array_agg(h) into hashes from jsonb_array_elements_text(result->'content_hashes') h;
 bucket:=case when p_kind='source' then 'source-evidence' else 'document-evidence' end;
 select count(*),count(*) filter(where c.operation_id is null) into total,pending
 from public.evidence_upload_operations o left join public.evidence_upload_completions c on c.operation_id=o.id
 where o.user_id=auth.uid() and o.bucket_id=bucket and o.file_hash=any(hashes);
 if total>20000 then raise exception 'Complete upload history exceeds direct review capacity.';end if;
 select coalesce(jsonb_agg(jsonb_build_array(o.id,c.created_at) order by o.id),'[]'::jsonb) into operations
 from public.evidence_upload_operations o left join public.evidence_upload_completions c on c.operation_id=o.id
 where o.user_id=auth.uid() and o.bucket_id=bucket and o.file_hash=any(hashes);
 return result||jsonb_build_object('counts',result->'counts'||jsonb_build_object('unresolved_upload_operations',pending),
  'inventory_sha256',encode(sha256(convert_to(jsonb_build_array(result->>'inventory_sha256',operations)::text,'UTF8')),'hex'));
end $$;
revoke all on function public.preview_evidence_deletion(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.preview_evidence_deletion(text,uuid) to authenticated;

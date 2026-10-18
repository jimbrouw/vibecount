-- Additive opaque evidence intake. No facts extracted and no accounting postings.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('document-evidence','document-evidence',false,3100000,array['application/octet-stream']);

create table public.document_upload_attempts (
  id uuid primary key, user_id uuid not null references auth.users(id),
  file_hash text not null check(file_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'pending' check(state in ('pending','uploaded','linked','duplicate','failed')),
  planned_objects jsonb not null check(jsonb_typeof(planned_objects)='array'),
  batch_id uuid, created_at timestamptz not null default now(), unique(id,user_id)
);
create table public.evidence_documents (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  file_hash text not null check(file_hash ~ '^[0-9a-f]{64}$'),
  media_type text not null check(media_type in ('application/pdf','image/png','image/jpeg','application/zip')),
  size_bytes integer not null check(size_bytes between 1 and 3000000),
  object_path text not null unique, key_id text not null,
  created_at timestamptz not null default now(), unique(user_id,file_hash), unique(id,user_id)
);
create table public.document_batches (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  root_document_id uuid not null,
  tax_year_start integer not null check(tax_year_start between 2000 and 2100),
  purpose text not null check(purpose in ('invoice','receipt','employment','other')),
  parser_version text not null, created_at timestamptz not null default now(),
  foreign key(root_document_id,user_id) references public.evidence_documents(id,user_id),
  unique(user_id,root_document_id,tax_year_start,purpose), unique(id,user_id)
);
alter table public.document_upload_attempts add foreign key(batch_id,user_id) references public.document_batches(id,user_id);
create table public.document_batch_items (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  batch_id uuid not null, document_id uuid not null,
  ordinal integer not null check(ordinal between 0 and 100),
  original_name_encrypted text not null,
  foreign key(batch_id,user_id) references public.document_batches(id,user_id),
  foreign key(document_id,user_id) references public.evidence_documents(id,user_id),
  unique(batch_id,ordinal)
);
create table public.document_intake_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  batch_id uuid not null, attempt_id uuid not null,
  event text not null check(event in ('preserved','reimported')),
  created_at timestamptz not null default now(),
  foreign key(batch_id,user_id) references public.document_batches(id,user_id),
  foreign key(attempt_id,user_id) references public.document_upload_attempts(id,user_id)
);

alter table public.document_upload_attempts enable row level security;
alter table public.evidence_documents enable row level security;
alter table public.document_batches enable row level security;
alter table public.document_batch_items enable row level security;
alter table public.document_intake_events enable row level security;
revoke all on public.document_upload_attempts,public.evidence_documents,public.document_batches,public.document_batch_items,public.document_intake_events from public,anon,authenticated;
grant select,insert,update on public.document_upload_attempts to service_role;
grant select,insert on public.evidence_documents,public.document_batches,public.document_batch_items,public.document_intake_events to service_role;
grant select(id,user_id,file_hash,media_type,size_bytes,created_at) on public.evidence_documents to authenticated;
grant select on public.document_batches,public.document_intake_events to authenticated;
grant select(id,user_id,batch_id,document_id,ordinal) on public.document_batch_items to authenticated;
create policy document_owner_read on public.evidence_documents for select to authenticated using(user_id=(select auth.uid()));
create policy batch_owner_read on public.document_batches for select to authenticated using(user_id=(select auth.uid()));
create policy batch_items_owner_read on public.document_batch_items for select to authenticated using(user_id=(select auth.uid()));
create policy document_events_owner_read on public.document_intake_events for select to authenticated using(user_id=(select auth.uid()));
create index document_batches_owner_created on public.document_batches(user_id,created_at,id);
create index document_items_owner_batch on public.document_batch_items(user_id,batch_id,ordinal);
create index document_items_document on public.document_batch_items(document_id,user_id);
create index document_events_owner_batch on public.document_intake_events(user_id,batch_id,id);
create index document_events_attempt on public.document_intake_events(attempt_id,user_id);
create index document_attempt_owner_created on public.document_upload_attempts(user_id,created_at,id);
create index document_attempt_batch on public.document_upload_attempts(batch_id,user_id);

create trigger immutable_documents before update or delete on public.evidence_documents for each row execute function public.reject_source_mutation();
create trigger immutable_document_batches before update or delete on public.document_batches for each row execute function public.reject_source_mutation();
create trigger immutable_document_items before update or delete on public.document_batch_items for each row execute function public.reject_source_mutation();
create trigger immutable_document_events before update or delete on public.document_intake_events for each row execute function public.reject_source_mutation();

create function public.register_document_intake(p_owner uuid,p_attempt uuid,p_year integer,p_purpose text,p_parser text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare attempt public.document_upload_attempts; item jsonb; root_id uuid; doc_id uuid; batch uuid; n integer:=0;
begin
  select * into attempt from public.document_upload_attempts where id=p_attempt and user_id=p_owner for update;
  if not found or attempt.state not in ('uploaded','linked','duplicate') then raise exception 'Uploaded evidence not found.'; end if;
  if p_year is null or p_year not between 2000 and 2100 or p_purpose is null or p_purpose not in ('invoice','receipt','employment','other') or p_parser is distinct from 'opaque-evidence/1' then raise exception 'Invalid document scope.'; end if;
  if jsonb_array_length(attempt.planned_objects) not between 1 and 101
    or (attempt.planned_objects->0->>'hash') is distinct from attempt.file_hash then raise exception 'Invalid evidence manifest.'; end if;
  -- Owner-wide lock also serializes the same child content in different archives.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('documents:'||p_owner::text,0));
  select id into root_id from public.evidence_documents where user_id=p_owner and file_hash=attempt.file_hash;
  select id into batch from public.document_batches where user_id=p_owner and root_document_id=root_id and tax_year_start=p_year and purpose=p_purpose;
  if batch is not null then
    update public.document_upload_attempts set state='duplicate',batch_id=batch where id=p_attempt;
    insert into public.document_intake_events(user_id,batch_id,attempt_id,event) values(p_owner,batch,p_attempt,'reimported');
    return jsonb_build_object('batch_id',batch,'created',false,'files',0);
  end if;
  for item in select value from jsonb_array_elements(attempt.planned_objects) loop
    if not exists(select 1 from storage.objects where bucket_id='document-evidence' and name=item->>'path') then raise exception 'Encrypted evidence object missing.'; end if;
    if item->>'name_encrypted' is null or item->>'key_id' is null then raise exception 'Missing encrypted evidence metadata.'; end if;
    insert into public.evidence_documents(user_id,file_hash,media_type,size_bytes,object_path,key_id)
      values(p_owner,item->>'hash',item->>'media_type',(item->>'size')::integer,item->>'path',item->>'key_id')
      on conflict(user_id,file_hash) do nothing;
    select id into doc_id from public.evidence_documents where user_id=p_owner and file_hash=item->>'hash';
    if n=0 then
      root_id:=doc_id;
      insert into public.document_batches(user_id,root_document_id,tax_year_start,purpose,parser_version)
        values(p_owner,root_id,p_year,p_purpose,p_parser) returning id into batch;
    end if;
    insert into public.document_batch_items(user_id,batch_id,document_id,ordinal,original_name_encrypted)
      values(p_owner,batch,doc_id,n,item->>'name_encrypted');
    n:=n+1;
  end loop;
  update public.document_upload_attempts set state='linked',batch_id=batch where id=p_attempt;
  insert into public.document_intake_events(user_id,batch_id,attempt_id,event) values(p_owner,batch,p_attempt,'preserved');
  return jsonb_build_object('batch_id',batch,'created',true,'files',n);
end; $$;
revoke all on function public.register_document_intake(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.register_document_intake(uuid,uuid,integer,text,text) to service_role;

-- Recover preservation only; no financial posting or tax-fact approval.
alter table public.source_upload_attempts add column recovery_plan jsonb;
alter table public.document_upload_attempts add column recovery_plan jsonb,
 add column object_count integer generated always as (jsonb_array_length(planned_objects)) stored;

create function public.protect_upload_attempt_identity() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Retained upload attempts cannot be deleted.'; end if;
 if (to_jsonb(new)-'state'-'batch_id'-'object_count') is distinct from (to_jsonb(old)-'state'-'batch_id'-'object_count') then raise exception 'Upload identity and confirmed recovery scope are immutable.'; end if;
 if current_user in ('anon','authenticated','service_role') and
   ((new.state in ('linked','duplicate') and new.state is distinct from old.state)
    or (to_jsonb(new)->>'batch_id') is distinct from (to_jsonb(old)->>'batch_id'))
 then raise exception 'Registered evidence destinations require the registration procedure.'; end if;
 if old.state in ('linked','duplicate') and new.state not in ('linked','duplicate') then raise exception 'Registered evidence cannot be downgraded.'; end if;
 if tg_table_name='document_upload_attempts' and to_jsonb(old)->>'batch_id' is not null and (to_jsonb(new)->>'batch_id') is distinct from (to_jsonb(old)->>'batch_id') then raise exception 'Registered evidence scope cannot change.'; end if;
 return new;
end; $$;
create trigger immutable_source_upload_identity before update or delete on public.source_upload_attempts for each row execute function public.protect_upload_attempt_identity();
create trigger immutable_document_upload_identity before update or delete on public.document_upload_attempts for each row execute function public.protect_upload_attempt_identity();

-- Content dedupe can retain an old content key while a new batch name uses a new key.
-- Keep separate immutable name-key provenance instead of modifying original items.
alter table public.document_batch_items add constraint document_items_owner_unique unique(id,user_id);
create table public.document_name_keys (
 batch_item_id uuid primary key,user_id uuid not null references auth.users(id),key_id text not null check(key_id ~ '^[A-Za-z0-9_-]{1,40}$'),attempt_id uuid not null,
 created_at timestamptz not null default now(),
 foreign key(batch_item_id,user_id) references public.document_batch_items(id,user_id),
 foreign key(attempt_id,user_id) references public.document_upload_attempts(id,user_id)
);
alter table public.document_name_keys enable row level security;
revoke all on public.document_name_keys from public,anon,authenticated,service_role;
grant select on public.document_name_keys to service_role;
create trigger immutable_document_name_keys before update or delete on public.document_name_keys for each row execute function public.reject_source_mutation();
-- Backfill only when the preserved event and exact encrypted name prove one key/attempt.
insert into public.document_name_keys(batch_item_id,user_id,key_id,attempt_id)
select i.id,i.user_id,min(a.planned_objects->i.ordinal->>'key_id'),min(a.id::text)::uuid
from public.document_batch_items i
join public.document_intake_events e on e.batch_id=i.batch_id and e.user_id=i.user_id and e.event='preserved'
join public.document_upload_attempts a on a.id=e.attempt_id and a.user_id=e.user_id
where a.planned_objects->i.ordinal->>'name_encrypted'=i.original_name_encrypted
 and a.planned_objects->i.ordinal->>'key_id' ~ '^[A-Za-z0-9_-]{1,40}$'
group by i.id,i.user_id having count(distinct (a.id,a.planned_objects->i.ordinal->>'key_id'))=1;

alter function public.ingest_source_csv(uuid,uuid,text,text,jsonb,jsonb) rename to ingest_source_csv_v20_base;
revoke all on function public.ingest_source_csv_v20_base(uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.ingest_source_csv(p_owner uuid,p_attempt uuid,p_filename text,p_parser text,p_mapping jsonb,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.source_upload_attempts; destination uuid;
begin
 select * into a from public.source_upload_attempts where id=p_attempt and user_id=p_owner for update;
 if not found then raise exception 'Upload attempt not found.'; end if;
 if a.recovery_plan is not null and (a.recovery_plan->>'filename',a.recovery_plan->>'parser',a.recovery_plan->'mapping') is distinct from (p_filename,p_parser,p_mapping) then raise exception 'Confirmed source scope changed.'; end if;
 if a.state in ('linked','duplicate') then
  select id into destination from public.record_imports where user_id=p_owner and account_id=a.account_id and file_hash=a.file_hash;
  if destination is null then raise exception 'Registered source evidence is inconsistent.'; end if;
  return jsonb_build_object('import_id',destination,'created',false,'transactions',0);
 end if;
 return public.ingest_source_csv_v20_base(p_owner,p_attempt,p_filename,p_parser,p_mapping,p_rows);
end; $$;
revoke all on function public.ingest_source_csv(uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_source_csv(uuid,uuid,text,text,jsonb,jsonb) to service_role;

create or replace function public.register_document_intake(p_owner uuid,p_attempt uuid,p_year integer,p_purpose text,p_parser text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.document_upload_attempts; item jsonb; root_id uuid; doc_id uuid; batch uuid; item_id uuid; n integer:=0;
begin
 select * into a from public.document_upload_attempts where id=p_attempt and user_id=p_owner for update;
 if not found or a.state not in ('uploaded','linked','duplicate') then raise exception 'Uploaded evidence not found.'; end if;
 if p_year is null or p_year not between 2000 and 2100 or p_purpose is null or p_purpose not in ('invoice','receipt','employment','other') or p_parser is distinct from 'opaque-evidence/1' then raise exception 'Invalid document scope.'; end if;
 if a.recovery_plan is not null and (a.recovery_plan->>'year',a.recovery_plan->>'purpose',a.recovery_plan->>'parser') is distinct from (p_year::text,p_purpose,p_parser) then raise exception 'Confirmed document scope changed.'; end if;
 if a.batch_id is not null then
  if not exists(select 1 from public.document_batches where id=a.batch_id and user_id=p_owner and tax_year_start=p_year and purpose=p_purpose and parser_version=p_parser) then raise exception 'Registered document scope changed.'; end if;
  return jsonb_build_object('batch_id',a.batch_id,'created',false,'files',0);
 end if;
 if jsonb_array_length(a.planned_objects) not between 1 and 101 or (a.planned_objects->0->>'hash') is distinct from a.file_hash then raise exception 'Invalid evidence manifest.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('documents:'||p_owner::text,0));
 select id into root_id from public.evidence_documents where user_id=p_owner and file_hash=a.file_hash;
 select id into batch from public.document_batches where user_id=p_owner and root_document_id=root_id and tax_year_start=p_year and purpose=p_purpose;
 if batch is not null then
  update public.document_upload_attempts set state='duplicate',batch_id=batch where id=p_attempt;
  insert into public.document_intake_events(user_id,batch_id,attempt_id,event) values(p_owner,batch,p_attempt,'reimported');
  return jsonb_build_object('batch_id',batch,'created',false,'files',0);
 end if;
 for item in select value from jsonb_array_elements(a.planned_objects) loop
  if not exists(select 1 from storage.objects where bucket_id='document-evidence' and name=item->>'path') then raise exception 'Encrypted evidence object missing.'; end if;
  if item->>'name_encrypted' is null or (item->>'key_id') !~ '^[A-Za-z0-9_-]{1,40}$' or item->>'key_id' is null then raise exception 'Missing encrypted evidence metadata.'; end if;
  insert into public.evidence_documents(user_id,file_hash,media_type,size_bytes,object_path,key_id)
   values(p_owner,item->>'hash',item->>'media_type',(item->>'size')::integer,item->>'path',item->>'key_id') on conflict(user_id,file_hash) do nothing;
  select id into doc_id from public.evidence_documents where user_id=p_owner and file_hash=item->>'hash';
  if n=0 then
   root_id:=doc_id;
   insert into public.document_batches(user_id,root_document_id,tax_year_start,purpose,parser_version) values(p_owner,root_id,p_year,p_purpose,p_parser) returning id into batch;
  end if;
  insert into public.document_batch_items(user_id,batch_id,document_id,ordinal,original_name_encrypted) values(p_owner,batch,doc_id,n,item->>'name_encrypted') returning id into item_id;
  insert into public.document_name_keys(batch_item_id,user_id,key_id,attempt_id) values(item_id,p_owner,item->>'key_id',p_attempt);
  n:=n+1;
 end loop;
 update public.document_upload_attempts set state='linked',batch_id=batch where id=p_attempt;
 insert into public.document_intake_events(user_id,batch_id,attempt_id,event) values(p_owner,batch,p_attempt,'preserved');
 return jsonb_build_object('batch_id',batch,'created',true,'files',n);
end; $$;
revoke all on function public.register_document_intake(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.register_document_intake(uuid,uuid,integer,text,text) to service_role;

create table public.evidence_recovery_requests (
 user_id uuid not null references auth.users(id),request_id uuid not null,
 source_attempt_id uuid,document_attempt_id uuid,kind text not null check(kind in ('source','document')),
 expected_stamp text not null,reason text not null check(length(btrim(reason)) between 1 and 1000),
 verified_manifest_sha256 text not null check(verified_manifest_sha256 ~ '^[a-f0-9]{64}$'),result jsonb not null,created_at timestamptz not null default now(),
 primary key(user_id,request_id),
 check((kind='source' and source_attempt_id is not null and document_attempt_id is null) or (kind='document' and document_attempt_id is not null and source_attempt_id is null)),
 foreign key(source_attempt_id,user_id) references public.source_upload_attempts(id,user_id),foreign key(document_attempt_id,user_id) references public.document_upload_attempts(id,user_id)
);
alter table public.evidence_recovery_requests enable row level security;
revoke all on public.evidence_recovery_requests from public,anon,authenticated,service_role;
grant select on public.evidence_recovery_requests to authenticated,service_role;
create policy recovery_request_owner_read on public.evidence_recovery_requests for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_recovery_requests before update or delete on public.evidence_recovery_requests for each row execute function public.reject_source_mutation();

-- Only safe attempt fields are owner-readable. Ciphertext paths, names and key metadata stay privileged.
create policy source_attempt_owner_read on public.source_upload_attempts for select to authenticated using(user_id=(select auth.uid()));
create policy document_attempt_owner_read on public.document_upload_attempts for select to authenticated using(user_id=(select auth.uid()));
grant select(id,user_id,account_id,file_hash,size_bytes,state,created_at,recovery_plan) on public.source_upload_attempts to authenticated;
grant select(id,user_id,file_hash,state,created_at,batch_id,recovery_plan,object_count) on public.document_upload_attempts to authenticated;
create view public.evidence_recovery_attempts with(security_invoker=true) as
 select a.id,a.user_id,'source'::text kind,a.state,a.file_hash,a.created_at,
 md5(jsonb_build_array(a.id,a.state,a.file_hash,a.recovery_plan)::text) stamp,
 a.size_bytes byte_count,1 object_count,a.recovery_plan->>'parser' parser,
 a.recovery_plan->>'row_count' row_count,a.recovery_plan->>'incoming_pence' incoming_pence,a.recovery_plan->>'outgoing_pence' outgoing_pence,
 a.recovery_plan->>'coverage_start' coverage_start,a.recovery_plan->>'coverage_end' coverage_end,
 f.label account_label,f.masked_identifier account_mask,null::text tax_year_start,null::text purpose,
 (select i.id from public.record_imports i where i.user_id=a.user_id and i.account_id=a.account_id and i.file_hash=a.file_hash) destination_id,
 a.recovery_plan is not null has_recovery_plan
 from public.source_upload_attempts a join public.financial_accounts f on f.id=a.account_id and f.user_id=a.user_id
 union all
 select a.id,a.user_id,'document',a.state,a.file_hash,a.created_at,
 md5(jsonb_build_array(a.id,a.state,a.file_hash,a.recovery_plan)::text),
 null::integer,a.object_count,a.recovery_plan->>'parser',null::text,null::text,null::text,null::text,null::text,
 null::text,null::text,a.recovery_plan->>'year',a.recovery_plan->>'purpose',a.batch_id,a.recovery_plan is not null
 from public.document_upload_attempts a;
revoke all on public.evidence_recovery_attempts from public,anon,authenticated,service_role;
grant select on public.evidence_recovery_attempts to authenticated,service_role;

-- The server has authenticated the owner and verified every byte before this service-only commit.
create function public.complete_evidence_recovery(p_owner uuid,p_kind text,p_attempt uuid,p_stamp text,p_manifest text,p_rows jsonb,p_reason text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.evidence_recovery_requests; a public.source_upload_attempts; d public.document_upload_attempts; actual_stamp text; result jsonb;
begin
 if p_owner is null or p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 or p_manifest is null or p_manifest !~ '^[a-f0-9]{64}$' then raise exception 'Confirm verified recovery scope and reason.'; end if;
 -- Request lock precedes the same attempt→account/document locks used by ingestion.
 perform pg_advisory_xact_lock(hashtextextended('evidence-recovery:'||p_owner::text||p_request::text,0));
 select * into prior from public.evidence_recovery_requests where user_id=p_owner and request_id=p_request;
 if found then
  if (prior.kind,coalesce(prior.source_attempt_id,prior.document_attempt_id),prior.expected_stamp,prior.reason,prior.verified_manifest_sha256) is distinct from (p_kind,p_attempt,p_stamp,btrim(p_reason),p_manifest) then raise exception 'Recovery request was used for another review.'; end if;
  return prior.result;
 end if;
 if p_kind='source' then
  select * into a from public.source_upload_attempts where id=p_attempt and user_id=p_owner for update;
  if not found or a.state<>'failed' or a.recovery_plan is null then raise exception 'Failed source recovery scope changed or needs fresh mapping review.'; end if;
  actual_stamp:=md5(jsonb_build_array(a.id,a.state,a.file_hash,a.recovery_plan)::text);
  if actual_stamp is distinct from p_stamp then raise exception 'Recovery scope changed.'; end if;
  update public.source_upload_attempts set state='uploaded' where id=p_attempt;
  result:=public.ingest_source_csv(p_owner,p_attempt,a.recovery_plan->>'filename',a.recovery_plan->>'parser',a.recovery_plan->'mapping',p_rows);
 elsif p_kind='document' then
  select * into d from public.document_upload_attempts where id=p_attempt and user_id=p_owner for update;
  if not found or d.state<>'failed' or d.recovery_plan is null then raise exception 'Failed document recovery scope changed or needs fresh scope review.'; end if;
  actual_stamp:=md5(jsonb_build_array(d.id,d.state,d.file_hash,d.recovery_plan)::text);
  if actual_stamp is distinct from p_stamp then raise exception 'Recovery scope changed.'; end if;
  update public.document_upload_attempts set state='uploaded' where id=p_attempt;
  result:=public.register_document_intake(p_owner,p_attempt,(d.recovery_plan->>'year')::integer,d.recovery_plan->>'purpose',d.recovery_plan->>'parser');
 else raise exception 'Choose a source or document attempt.';
 end if;
 insert into public.evidence_recovery_requests(user_id,request_id,source_attempt_id,document_attempt_id,kind,expected_stamp,reason,verified_manifest_sha256,result)
 values(p_owner,p_request,case when p_kind='source' then p_attempt else null end,case when p_kind='document' then p_attempt else null end,p_kind,p_stamp,btrim(p_reason),p_manifest,result);
 return result;
end; $$;
revoke all on function public.complete_evidence_recovery(uuid,text,uuid,text,text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.complete_evidence_recovery(uuid,text,uuid,text,text,jsonb,text,uuid) to service_role;

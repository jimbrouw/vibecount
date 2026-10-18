-- Review and request foundation. The request writer is deliberately private:
-- no application role can activate deletion before restore/removal gates ship.
create table public.evidence_deletion_requests (
 id uuid primary key,user_id uuid not null references auth.users(id),
 kind text not null check(kind in ('source','document')),target_id uuid not null,
 inventory_sha256 text not null check(inventory_sha256 ~ '^[a-f0-9]{64}$'),
 review_sha256 text not null check(review_sha256 ~ '^[a-f0-9]{64}$'),
 disclosure_version text not null check(disclosure_version='evidence-deletion/1'),
 scope jsonb not null,reason text not null check(length(btrim(reason)) between 1 and 1000),
 created_at timestamptz not null default now(),unique(id,user_id)
);
alter table public.evidence_deletion_requests enable row level security;
revoke all on public.evidence_deletion_requests from public,anon,authenticated,service_role;
create trigger immutable_evidence_deletion_request before update or delete on public.evidence_deletion_requests for each row execute function public.reject_source_mutation();

-- Conservatively invalidate a review on any owned state change, rather than
-- infer incomplete JSON ancestry. Default/global records also participate.
-- Only chained hashes leave this function; no source fields enter the review.
create function public.evidence_deletion_review_stamp(p_owner uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare relation record;counted bigint;bytes bigint;total_bytes bigint:=0;digest text;result text:='evidence-deletion-review/1';predicate text;begin
 if p_owner is null then raise exception 'Owned evidence review required.';end if;
 for relation in select c.relname,exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='user_id' and not a.attisdropped) owned
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname
 loop
  if relation.owned then predicate:='where t.user_id=$1 or t.user_id is null';
  elsif relation.relname='user_settings' then predicate:='where t.id=$1';
  elsif relation.relname in ('glossary_terms','tax_rulesets','tax_form_mappings','finance_plan_rulesets','tax_deadline_rulesets','fx_currency_rulesets') then predicate:='';
  else raise exception 'Deletion dependency ownership mapping requires review: %',relation.relname;
  end if;
  execute format('with entries as materialized(select to_jsonb(t) r from public.%I t %s limit 20001),hashed as(select octet_length(r::text) bytes,encode(sha256(convert_to(r::text,''UTF8'')),''hex'') hash from entries) select count(*),coalesce(sum(bytes),0),encode(sha256(convert_to(coalesce(string_agg(hash,'','' order by hash),''''),''UTF8'')),''hex'') from hashed',relation.relname,predicate)
   into counted,bytes,digest using p_owner;
  total_bytes:=total_bytes+bytes;
  if counted>20000 or total_bytes>20000000 then raise exception 'Complete deletion dependency review exceeds direct review capacity.';end if;
  result:=encode(sha256(convert_to(jsonb_build_array(result,relation.relname,counted,digest)::text,'UTF8')),'hex');
 end loop;
 return result;
end $$;
revoke all on function public.evidence_deletion_review_stamp(uuid) from public,anon,authenticated,service_role;

create function public.review_evidence_deletion(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare preview jsonb;begin
 preview:=public.preview_evidence_deletion(p_kind,p_id);
 return preview||jsonb_build_object('review_sha256',public.evidence_deletion_review_stamp(auth.uid()),
  'disclosure_version','evidence-deletion/1','confirmation_enabled',false,
  'retained_material','Normalized transactions, financial records, approvals, exclusions, audit history and saved snapshots remain. Saved snapshots and import metadata may retain filenames and descriptions. Previously downloaded copies and external backups are not erased by active-store deletion.');
end $$;
revoke all on function public.review_evidence_deletion(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.review_evidence_deletion(text,uuid) to authenticated;

create function public.record_evidence_deletion_request(p_kind text,p_id uuid,p_inventory text,p_review text,p_disclosure text,p_reason text,p_request uuid,p_confirmed boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();prior public.evidence_deletion_requests;review jsonb;hashes text[];relation record;bucket text;begin
 if owner_id is null or p_request is null or p_confirmed is distinct from true or p_disclosure is distinct from 'evidence-deletion/1'
  or p_inventory is null or p_review is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Confirm the exact evidence scope and retained-material disclosure.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 select * into prior from public.evidence_deletion_requests where id=p_request;
 if found then
  if (prior.user_id,prior.kind,prior.target_id,prior.inventory_sha256,prior.review_sha256,prior.disclosure_version,prior.reason)
   is distinct from (owner_id,p_kind,p_id,p_inventory,p_review,p_disclosure,btrim(p_reason)) then raise exception 'Deletion request was used for a different review.';end if;
  return prior.id;
 end if;
 -- Rare destructive review: short global freezes cover older direct writers,
 -- new/removed dependencies and phantom inserts, including upload admission.
 for relation in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname loop
  execute format('lock table public.%I in share mode nowait',relation.relname);
 end loop;
 lock table storage.objects in share mode nowait;
 review:=public.review_evidence_deletion(p_kind,p_id);
 if review->>'inventory_sha256' is distinct from p_inventory or review->>'review_sha256' is distinct from p_review then raise exception 'Deletion scope or dependencies changed. Review again.';end if;
 if (review#>>'{counts,unresolved_upload_operations}')::bigint<>0 then raise exception 'Evidence upload outcome is unresolved. Deletion cannot begin.';end if;
 select array_agg(h) into hashes from jsonb_array_elements_text(review->'content_hashes') h;
 bucket:=case when p_kind='source' then 'source-evidence' else 'document-evidence' end;
 if exists(select 1 from public.evidence_deletion_targets where user_id=owner_id and bucket_id=bucket and file_hash=any(hashes)) then raise exception 'This evidence scope already belongs to a deletion request.';end if;
 insert into public.evidence_deletion_requests(id,user_id,kind,target_id,inventory_sha256,review_sha256,disclosure_version,scope,reason)
 values(p_request,owner_id,p_kind,p_id,p_inventory,p_review,p_disclosure,review,btrim(p_reason));
 if p_kind='source' then
  insert into public.evidence_deletion_targets(user_id,request_id,bucket_id,object_path,file_hash)
   select owner_id,p_request,bucket,path,hash from(
    select object_path path,file_hash hash from public.record_source_files where user_id=owner_id and file_hash=any(hashes)
    union select object_path,file_hash from public.source_upload_attempts where user_id=owner_id and file_hash=any(hashes)
   ) objects;
 else
  insert into public.evidence_deletion_targets(user_id,request_id,bucket_id,object_path,file_hash)
   select owner_id,p_request,bucket,path,hash from(
    select object_path path,file_hash hash from public.evidence_documents where user_id=owner_id and file_hash=any(hashes)
    union select v->>'path',v->>'hash' from public.document_upload_attempts a cross join lateral jsonb_array_elements(a.planned_objects) v
     where a.user_id=owner_id and v->>'hash'=any(hashes)
   ) objects;
 end if;
 if not found then raise exception 'Complete owned object inventory required.';end if;
 return p_request;
end $$;
revoke all on function public.record_evidence_deletion_request(text,uuid,text,text,text,text,uuid,boolean) from public,anon,authenticated,service_role;

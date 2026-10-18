-- A retained successful recovery is historical evidence, not permission to
-- restore or report the same content as available after a deletion request.
create function public.assert_evidence_attempt_retained(p_owner uuid,p_kind text,p_attempt uuid) returns boolean
language plpgsql security definer set search_path='' as $$declare hashes text[];begin
 if p_kind='source' then
  select array[file_hash] into hashes from public.source_upload_attempts where id=p_attempt and user_id=p_owner;
 elsif p_kind='document' then
  select array[a.file_hash]||array(select v->>'hash' from jsonb_array_elements(a.planned_objects) v)
   into hashes from public.document_upload_attempts a where a.id=p_attempt and a.user_id=p_owner;
 else raise exception 'Choose an evidence attempt kind.';
 end if;
 if hashes is null then raise exception 'Owned upload attempt unavailable.';end if;
 perform public.assert_upload_evidence_retained(p_owner,case when p_kind='source' then 'source-evidence' else 'document-evidence' end,hashes);
 return true;
end $$;
revoke all on function public.assert_evidence_attempt_retained(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.assert_evidence_attempt_retained(uuid,text,uuid) to service_role;

alter function public.complete_evidence_recovery(uuid,text,uuid,text,text,jsonb,text,uuid) rename to complete_evidence_recovery_v95;
revoke all on function public.complete_evidence_recovery_v95(uuid,text,uuid,text,text,jsonb,text,uuid) from public,anon,authenticated,service_role;
create function public.complete_evidence_recovery(p_owner uuid,p_kind text,p_attempt uuid,p_stamp text,p_manifest text,p_rows jsonb,p_reason text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform public.assert_evidence_attempt_retained(p_owner,p_kind,p_attempt);
 return public.complete_evidence_recovery_v95(p_owner,p_kind,p_attempt,p_stamp,p_manifest,p_rows,p_reason,p_request);
end $$;
revoke all on function public.complete_evidence_recovery(uuid,text,uuid,text,text,jsonb,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.complete_evidence_recovery(uuid,text,uuid,text,text,jsonb,text,uuid) to service_role;

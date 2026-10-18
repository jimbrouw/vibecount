-- Offline maintenance only. External quarantine and a trusted current manifest
-- are mandatory; this function does not establish restore readiness.
create function public.replay_evidence_deletion_intent(p_request jsonb,p_targets jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare request public.evidence_deletion_requests;target public.evidence_deletion_targets;item jsonb;prior jsonb;
begin
 request:=jsonb_populate_record(null::public.evidence_deletion_requests,p_request);
 if to_jsonb(request) is distinct from p_request or request.id is null or request.user_id is null
  or jsonb_typeof(p_targets) is distinct from 'array' or jsonb_array_length(p_targets)=0 then
  raise exception 'Exact deletion intent required.';end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||request.user_id::text,0));
 lock table public.evidence_deletion_requests,public.evidence_deletion_targets in share row exclusive mode nowait;
 select to_jsonb(r) into prior from public.evidence_deletion_requests r where id=request.id;
 if found then
  if prior is distinct from p_request then raise exception 'Conflicting restored deletion request.';end if;
 else insert into public.evidence_deletion_requests select request.*;end if;
 for item in select value from jsonb_array_elements(p_targets) loop
  target:=jsonb_populate_record(null::public.evidence_deletion_targets,item);
  if to_jsonb(target) is distinct from item or target.request_id is distinct from request.id or target.user_id is distinct from request.user_id then
   raise exception 'Exact owned deletion target required.';end if;
  select to_jsonb(t) into prior from public.evidence_deletion_targets t where bucket_id=target.bucket_id and object_path=target.object_path;
  if found then
   if prior is distinct from item then raise exception 'Conflicting restored deletion target.';end if;
  else
   -- Existing provenance and unresolved-upload guards remain in force.
   insert into public.evidence_deletion_targets select target.*;
  end if;
 end loop;
 if exists(select 1 from public.evidence_deletion_targets t where t.request_id=request.id and not exists(
  select 1 from jsonb_array_elements(p_targets) v where v->>'bucket_id'=t.bucket_id and v->>'object_path'=t.object_path)) then
  raise exception 'Incomplete restored deletion scope.';end if;
 perform public.scrub_evidence_deletion_request(request.user_id,request.id);
 return true;
end $$;
revoke all on function public.replay_evidence_deletion_intent(jsonb,jsonb) from public,anon,authenticated,service_role;

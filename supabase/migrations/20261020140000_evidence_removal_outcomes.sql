-- Private worker protocol. No application role is enabled to remove objects.
-- Provider absence must be checked by the worker; metadata absence alone is
-- not evidence that a provider operation completed.
create table public.evidence_removal_attempts (
 id uuid primary key,user_id uuid not null,request_id uuid not null,
 bucket_id text not null,object_path text not null,
 created_at timestamptz not null default now(),
 foreign key(request_id,user_id) references public.evidence_deletion_requests(id,user_id),
 foreign key(bucket_id,object_path) references public.evidence_deletion_targets(bucket_id,object_path)
);
create table public.evidence_removal_outcomes (
 attempt_id uuid primary key references public.evidence_removal_attempts(id),
 user_id uuid not null references auth.users(id),
 outcome text not null check(outcome in ('absent','failed','unknown')),
 created_at timestamptz not null default now()
);
alter table public.evidence_removal_attempts enable row level security;
alter table public.evidence_removal_outcomes enable row level security;
revoke all on public.evidence_removal_attempts,public.evidence_removal_outcomes from public,anon,authenticated,service_role;
create trigger immutable_evidence_removal_attempt before update or delete on public.evidence_removal_attempts for each row execute function public.reject_source_mutation();
create trigger immutable_evidence_removal_outcome before update or delete on public.evidence_removal_outcomes for each row execute function public.reject_source_mutation();

create function public.begin_evidence_removal(p_owner uuid,p_request uuid,p_bucket text,p_path text,p_attempt uuid) returns boolean
language plpgsql security definer set search_path='' as $$begin
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||p_owner::text,0));
 if not exists(select 1 from public.evidence_deletion_scrubs where request_id=p_request and user_id=p_owner)
  or not exists(select 1 from public.evidence_deletion_targets where request_id=p_request and user_id=p_owner and bucket_id=p_bucket and object_path=p_path)
 then raise exception 'Owned scrubbed deletion target required.';end if;
 if exists(select 1 from public.evidence_removal_attempts a left join public.evidence_removal_outcomes o on o.attempt_id=a.id
  where a.bucket_id=p_bucket and a.object_path=p_path and (o.attempt_id is null or o.outcome='absent'))
 then raise exception 'Removal is pending or already verified absent.';end if;
 -- Single-use admission. Replaying the ID never authorizes another remote call.
 insert into public.evidence_removal_attempts(id,user_id,request_id,bucket_id,object_path) values(p_attempt,p_owner,p_request,p_bucket,p_path);
 return true;
end $$;
revoke all on function public.begin_evidence_removal(uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;

create function public.record_evidence_removal_outcome(p_owner uuid,p_attempt uuid,p_outcome text,p_provider_absent boolean) returns boolean
language plpgsql security definer set search_path='' as $$declare attempt public.evidence_removal_attempts;prior public.evidence_removal_outcomes;begin
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||p_owner::text,0));
 select * into attempt from public.evidence_removal_attempts where id=p_attempt and user_id=p_owner;
 if not found then raise exception 'Owned removal attempt required.';end if;
 if p_outcome is null or p_outcome not in ('absent','failed','unknown') or p_provider_absent is distinct from (p_outcome='absent') then
  raise exception 'Exact provider outcome required.';end if;
 select * into prior from public.evidence_removal_outcomes where attempt_id=p_attempt;
 if found then
  if prior.outcome<>p_outcome then raise exception 'Removal outcome is immutable.';end if;
  return true;
 end if;
 lock table storage.objects in share mode nowait;
 if p_outcome='absent' and exists(select 1 from storage.objects where bucket_id=attempt.bucket_id and name=attempt.object_path) then
  raise exception 'Storage metadata still contains the evidence object.';end if;
 insert into public.evidence_removal_outcomes(attempt_id,user_id,outcome) values(p_attempt,p_owner,p_outcome);
 return true;
end $$;
revoke all on function public.record_evidence_removal_outcome(uuid,uuid,text,boolean) from public,anon,authenticated,service_role;

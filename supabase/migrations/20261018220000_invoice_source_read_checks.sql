-- Private server readability checks, not canonical invoices or financial effects.
create table public.invoice_source_read_checks (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 request_id uuid not null, intent jsonb not null, fact_revision_id uuid not null, document_id uuid not null,
 source_snapshot jsonb not null, outcome text not null check(outcome in('verified','unavailable')),
 author uuid not null references auth.users(id), checked_at timestamptz not null default now(),
 unique(user_id,request_id), unique(id,user_id),
 foreign key(fact_revision_id,user_id) references public.fx_document_fact_revisions(id,user_id),
 foreign key(document_id,user_id) references public.evidence_documents(id,user_id),
 check(jsonb_typeof(intent)='object' and jsonb_typeof(source_snapshot)='object'), check(author=user_id)
);
alter table public.invoice_source_read_checks enable row level security;
revoke all on public.invoice_source_read_checks from public,anon,authenticated,service_role;
grant select on public.invoice_source_read_checks to authenticated,service_role;
create policy invoice_source_check_owner_read on public.invoice_source_read_checks for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_invoice_source_checks before update or delete on public.invoice_source_read_checks for each row execute function public.reject_source_mutation();
create index invoice_source_checks_owner_history on public.invoice_source_read_checks(user_id,id);

create function public.record_invoice_source_read(p_owner uuid,p_intent jsonb,p_source jsonb,p_outcome text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior public.invoice_source_read_checks; fact public.fx_document_fact_revisions; rid uuid; fid uuid; result public.invoice_source_read_checks; normalized jsonb;
begin
 if p_owner is null or jsonb_typeof(p_intent) is distinct from 'object' or octet_length(p_intent::text)>5000
 or(select count(*) from jsonb_object_keys(p_intent))<>4 or not(p_intent ?& array['schema_version','request_id','fact_revision_id','reason'])
 or p_intent->>'schema_version' is distinct from 'invoice-source-read-intent/1'
 or jsonb_typeof(p_intent->'reason') is distinct from 'string' or length(btrim(p_intent->>'reason')) not between 1 and 1000
 or p_outcome is null or p_outcome not in('verified','unavailable') then raise exception 'Review a bounded invoice source check.';end if;
 rid:=public.fx_fact_uuid(p_intent->'request_id',false);fid:=public.fx_fact_uuid(p_intent->'fact_revision_id',false);
 normalized:=p_intent||jsonb_build_object('request_id',rid,'fact_revision_id',fid,'reason',btrim(p_intent->>'reason'));
 perform pg_advisory_xact_lock(hashtextextended('invoice-source-read:'||p_owner::text,0));
 select * into prior from public.invoice_source_read_checks where user_id=p_owner and request_id=rid;
 if found then
  if prior.intent is distinct from normalized or prior.source_snapshot is distinct from p_source or prior.outcome<>p_outcome then raise exception 'Source check request changed.';end if;
  return to_jsonb(prior);
 end if;
 -- Exclude registration/object phantoms between the final check and audit insertion.
 lock table public.fx_document_fact_families,public.fx_document_fact_revisions,public.evidence_documents,public.document_batches,public.document_batch_items,storage.objects in share mode nowait;
 select * into fact from public.fx_document_fact_revisions where id=fid and user_id=p_owner and kind='invoice';
 if not found or fact.source_snapshot is distinct from p_source then raise exception 'Owned invoice source unavailable.';end if;
 if p_outcome='verified' and(fact.state<>'verified' or not fact.human_read_original
  or fact.id is distinct from(select r.id from public.fx_document_fact_revisions r where r.family_id=fact.family_id and r.user_id=p_owner order by r.ordinal desc limit 1)
  or not public.fx_document_fact_source_current(fact.id,p_owner)
  or public.fx_document_source(p_owner,fact.document_id,true) is distinct from fact.source_snapshot->'document_source') then raise exception 'Current verified invoice source changed.';end if;
 insert into public.invoice_source_read_checks(user_id,request_id,intent,fact_revision_id,document_id,source_snapshot,outcome,author)
 values(p_owner,rid,normalized,fact.id,fact.document_id,fact.source_snapshot,p_outcome,p_owner) returning * into result;
 return to_jsonb(result);
end;$$;
revoke all on function public.record_invoice_source_read(uuid,jsonb,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.record_invoice_source_read(uuid,jsonb,jsonb,text) to service_role;

-- Private source-read prerequisite. No financial writer or action is enabled.
create table public.fx_settlement_source_checks (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
 request_id uuid not null,intent jsonb not null,sources jsonb not null,
 outcome text not null check(outcome in('verified','unavailable')),
 author uuid not null references auth.users(id),checked_at timestamptz not null default statement_timestamp(),
 unique(user_id,request_id),unique(id,user_id),check(author=user_id),
 check(jsonb_typeof(intent)='object' and jsonb_typeof(sources)='array'),
 check(octet_length(intent::text)<=128000 and octet_length(sources::text)<=2000000)
);
alter table public.fx_settlement_source_checks enable row level security;
revoke all on public.fx_settlement_source_checks from public,anon,authenticated,service_role;
grant select on public.fx_settlement_source_checks to authenticated,service_role;
create policy fx_settlement_checks_owner_read on public.fx_settlement_source_checks for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_fx_settlement_checks before update or delete on public.fx_settlement_source_checks for each row execute function public.reject_source_mutation();

-- Preserve the current public stamp function/OID. Copy the exact evidence stamp
-- body with an explicit owner and its already-parity-tested financial base.
do $$declare definition text;copied text;bound text;begin
 select pg_get_functiondef('public.fx_evidence_review_stamp()'::regprocedure) into definition;
 copied:=replace(definition,'FUNCTION public.fx_evidence_review_stamp()','FUNCTION public.fx_evidence_review_stamp_for_owner(p_owner uuid)');
 if copied=definition or position('public.reconciliation_export_stamp()' in copied)=0 then raise exception 'Inspect the current evidence stamp before private owner binding.';end if;
 bound:=regexp_replace(copied,'owner_id uuid\s*:=\s*auth\.uid\(\)','owner_id uuid := p_owner','g');
 if bound=copied then raise exception 'Inspect evidence stamp owner declaration before binding.';end if;copied:=bound;
 copied:=replace(copied,'public.reconciliation_export_stamp()','public.tax_financial_stamp_for_owner(p_owner)');
 execute copied;
end;$$;
revoke all on function public.fx_evidence_review_stamp_for_owner(uuid) from public,anon,authenticated,service_role;

create function public.fx_settlement_source_context(p_owner uuid,p_intent jsonb,p_current boolean) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare i jsonb;entry jsonb;parent public.fx_document_fact_revisions;conversion public.fx_document_fact_revisions;
 ids uuid[]:='{}';result jsonb;
begin
 if p_owner is null or p_current is null then raise exception 'Choose a complete owned settlement source scope.';end if;
 i:=public.validate_fx_settlement_intent(p_intent);
 for entry in select value from jsonb_array_elements(i->'allocations') loop
  select * into parent from public.fx_document_fact_revisions where id=(entry->>'invoice_evidence_revision_id')::uuid and user_id=p_owner and kind='invoice' and family_id=(entry->>'invoice_evidence_id')::uuid and state='verified' and human_read_original;
  select * into conversion from public.fx_document_fact_revisions where id=(entry->>'conversion_evidence_revision_id')::uuid and user_id=p_owner and kind='conversion' and family_id=(entry->>'conversion_evidence_id')::uuid and state='verified' and human_read_original;
  if parent.id is null or conversion.id is null or conversion.invoice_evidence_revision_id is distinct from parent.id
   or conversion.transaction_id is distinct from(i->>'receipt_id')::uuid or conversion.transaction_version is distinct from(i->>'receipt_version')::integer then raise exception 'Complete owned invoice and conversion facts required.';end if;
  if p_current then
   if not exists(select 1 from public.invoices inv join public.invoice_revisions r on r.invoice_id=inv.id and r.user_id=inv.user_id
    where inv.id=(entry->>'invoice_id')::uuid and inv.user_id=p_owner and inv.origin='preserved_external' and inv.status='finalised'
    and inv.external_revision=r.version and inv.source_fact_revision_id=parent.id and r.id=(entry->>'invoice_revision_id')::uuid and r.source_fact_revision_id=parent.id)
    or parent.id is distinct from(select id from public.fx_document_fact_revisions where user_id=p_owner and family_id=parent.family_id order by ordinal desc limit 1)
    or conversion.id is distinct from(select id from public.fx_document_fact_revisions where user_id=p_owner and family_id=conversion.family_id order by ordinal desc limit 1)
    or not public.fx_document_fact_source_current(parent.id,p_owner) or not public.fx_document_fact_source_current(conversion.id,p_owner)
    or public.fx_document_source(p_owner,parent.document_id,true) is distinct from parent.source_snapshot->'document_source'
    or public.fx_document_source(p_owner,conversion.document_id,false) is distinct from conversion.source_snapshot->'document_source'
   then raise exception 'Current settlement source facts changed.';end if;
   perform public.validate_external_invoice_revision((entry->>'invoice_revision_id')::uuid,p_owner);
  end if;
  ids:=ids||array[parent.id,conversion.id];
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('fact_revision_id',r.id,'kind',r.kind,'document_id',r.document_id,'source_snapshot',r.source_snapshot) order by r.id),'[]') into result
 from public.fx_document_fact_revisions r where r.user_id=p_owner and r.id=any(ids);
 if jsonb_array_length(result)<>(select count(distinct id) from unnest(ids) id) or jsonb_array_length(result)>100 or octet_length(result::text)>2000000 then raise exception 'Complete settlement source proof exceeds the safe limit.';end if;
 return result;
end;$$;
revoke all on function public.fx_settlement_source_context(uuid,jsonb,boolean) from public,anon,authenticated,service_role;

create function public.record_fx_settlement_source_check(p_owner uuid,p_intent jsonb,p_sources jsonb,p_outcome text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i jsonb;prior public.fx_settlement_source_checks;sources jsonb;result public.fx_settlement_source_checks;
begin
 if p_owner is null or p_outcome is null or p_outcome not in('verified','unavailable') or jsonb_typeof(p_sources) is distinct from 'array' or octet_length(p_sources::text)>2000000 then raise exception 'Review a bounded owned settlement source check.';end if;
 i:=public.validate_fx_settlement_intent(p_intent);
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||p_owner::text,0));
 select * into prior from public.fx_settlement_source_checks where user_id=p_owner and request_id=(i->>'request_id')::uuid;
 if found then
  if prior.intent is distinct from i or prior.sources is distinct from p_sources or prior.outcome is distinct from p_outcome then raise exception 'Settlement source-check request changed.';end if;
  return to_jsonb(prior);
 end if;
 lock table public.invoices,public.invoice_revisions,public.bank_transactions,public.financial_records,public.record_imports,
 public.fx_conversion_lots,public.invoice_settlements,public.fx_document_fact_families,public.fx_document_fact_revisions,
 public.evidence_documents,public.document_batches,public.document_batch_items,storage.objects in share mode nowait;
 sources:=public.fx_settlement_source_context(p_owner,i,p_outcome='verified');
 if sources is distinct from p_sources then raise exception 'Settlement source snapshot differs.';end if;
 if p_outcome='verified' and md5('fx-settlement-context/1|'||public.fx_evidence_review_stamp_for_owner(p_owner)) is distinct from i->>'expected_stamp' then raise exception 'Settlement source financial context changed.';end if;
 insert into public.fx_settlement_source_checks(user_id,request_id,intent,sources,outcome,author)
 values(p_owner,(i->>'request_id')::uuid,i,sources,p_outcome,p_owner) returning * into result;
 return to_jsonb(result);
end;$$;
revoke all on function public.record_fx_settlement_source_check(uuid,jsonb,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.record_fx_settlement_source_check(uuid,jsonb,jsonb,text) to service_role;

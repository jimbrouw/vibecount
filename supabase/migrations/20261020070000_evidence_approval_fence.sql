-- Deletion remains disabled. These gates protect new reviews once targets exist;
-- immutable historical facts and exclusions remain available for audit/reversal.
create function public.evidence_reference_targeted(p_owner uuid,p_document uuid,p_transaction uuid,p_record uuid)
returns boolean language sql stable security definer set search_path='' as $$
 with records as (
  select f.* from public.financial_records f where f.user_id=p_owner and f.id=p_record
 ),transactions as (
  select p_transaction id union select bank_transaction_id from records
  union select r.original_transaction_id from records f join public.refund_links r on r.id=f.refund_link_id and r.user_id=f.user_id
 ),imports as (
  select t.import_id id from public.bank_transactions t join transactions x on x.id=t.id where t.user_id=p_owner
  union select import_id from records
 ),documents as (
  select p_document id
  union select e.document_id from transactions x join public.bank_transactions t on t.id=x.id and t.user_id=p_owner
   join public.merchant_review_items m on m.transaction_id=t.id and m.user_id=t.user_id and m.after_version=t.decision_version
   join public.merchant_review_evidence e on e.item_id=m.id and e.user_id=m.user_id
 )
 select exists(select 1 from documents x join public.evidence_documents d on d.id=x.id and d.user_id=p_owner
  join public.evidence_deletion_targets z on z.user_id=d.user_id and z.bucket_id='document-evidence' and z.object_path=d.object_path)
 or exists(select 1 from imports x join public.record_imports i on i.id=x.id and i.user_id=p_owner
  join public.record_source_files f on f.id=i.source_file_id and f.user_id=i.user_id
  join public.evidence_deletion_targets z on z.user_id=f.user_id and z.bucket_id='source-evidence' and z.object_path=f.object_path);
$$;
revoke all on function public.evidence_reference_targeted(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function public.owned_evidence_reference_targeted(p_document uuid,p_transaction uuid,p_record uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.evidence_reference_targeted(auth.uid(),p_document,p_transaction,p_record);
$$;
revoke all on function public.owned_evidence_reference_targeted(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.owned_evidence_reference_targeted(uuid,uuid,uuid) to authenticated;

create function public.guard_review_evidence_retained() returns trigger language plpgsql security definer set search_path='' as $$
declare document uuid;transaction_id uuid;record_id uuid;original_transaction uuid;begin
 -- Target insertion conflicts with this lock until the review commits.
 lock table public.evidence_deletion_targets in share mode;
 if tg_table_name='tax_fact_sources' then
  -- Withdrawal/exclusion retains provenance without accepting a financial claim.
  if exists(select 1 from public.tax_fact_revisions where id=new.revision_id and user_id=new.user_id and state in ('withdrawn','excluded')) then return new;end if;
  document:=new.document_id;transaction_id:=new.transaction_id;record_id:=new.record_id;
 elsif tg_table_name='tax_calculation_scopes' then
  document:=new.evidence_document_id;
 elsif tg_table_name='merchant_review_evidence' then
  document:=new.document_id;
 elsif tg_table_name='financial_records' then
  if new.status<>'approved' then return new;end if;
  transaction_id:=new.bank_transaction_id;
  select original_transaction_id into original_transaction from public.refund_links where id=new.refund_link_id and user_id=new.user_id;
  if public.evidence_reference_targeted(new.user_id,null,original_transaction,null)
   or exists(select 1 from public.record_imports i join public.record_source_files f on f.id=i.source_file_id and f.user_id=i.user_id
    join public.evidence_deletion_targets z on z.user_id=f.user_id and z.bucket_id='source-evidence' and z.object_path=f.object_path
    where i.id=new.import_id and i.user_id=new.user_id) then raise exception 'Evidence is marked for deletion. Review available sources before approval.';end if;
 end if;
 if public.evidence_reference_targeted(new.user_id,document,transaction_id,record_id) then raise exception 'Evidence is marked for deletion. Review available sources before approval.';end if;
 return new;
end $$;
revoke all on function public.guard_review_evidence_retained() from public,anon,authenticated,service_role;
create trigger retained_tax_fact_source before insert on public.tax_fact_sources for each row execute function public.guard_review_evidence_retained();
create trigger retained_tax_scope before insert on public.tax_calculation_scopes for each row execute function public.guard_review_evidence_retained();
create trigger retained_merchant_evidence before insert on public.merchant_review_evidence for each row execute function public.guard_review_evidence_retained();
create trigger retained_financial_approval before insert or update on public.financial_records for each row execute function public.guard_review_evidence_retained();

-- Preserve the public view shape and RLS; only current availability is changed.
do $$declare definition text;changed text;begin
 select pg_get_viewdef('public.tax_fact_source_status'::regclass,true) into definition;
 changed:=replace(definition,'END AS source_unresolved','END OR public.owned_evidence_reference_targeted(s.document_id,s.transaction_id,s.record_id) AS source_unresolved');
 if changed=definition then raise exception 'Inspect tax source status predecessor.';end if;
 execute 'create or replace view public.tax_fact_source_status with(security_invoker=true) as '||changed;
end $$;

-- Keep earlier input projections and saved snapshots byte-for-byte intact. The
-- current projection uses its existing unresolved/current fields to withhold
-- newly captured totals when referenced evidence is targeted.
alter function public.tax_calculation_input_for_owner(uuid,integer) rename to tax_calculation_input_v94_for_owner;
revoke all on function public.tax_calculation_input_v94_for_owner(uuid,integer) from public,anon,authenticated,service_role;
create function public.tax_calculation_input_for_owner(p_owner uuid,p_year integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare result jsonb;sources jsonb;begin
 result:=public.tax_calculation_input_v94_for_owner(p_owner,p_year);
 select coalesce(jsonb_agg(case when public.evidence_reference_targeted(p_owner,(s->>'document_id')::uuid,(s->>'transaction_id')::uuid,(s->>'record_id')::uuid)
  then s||jsonb_build_object('source_unresolved',true) else s end order by n),'[]'::jsonb)
 into sources from jsonb_array_elements(result->'sources') with ordinality as entries(s,n);
 result:=jsonb_set(result,'{sources}',sources);
 if public.evidence_reference_targeted(p_owner,(result#>>'{scope,evidence_document_id}')::uuid,null,null) then
  result:=jsonb_set(result,'{scope,is_current}','false'::jsonb);
 end if;
 return result;
end $$;
revoke all on function public.tax_calculation_input_for_owner(uuid,integer) from public,anon,authenticated,service_role;

-- Current planning catalogs exclude targeted documents. Historical snapshot
-- verification continues to read the immutable evidence_documents metadata.
create view public.retained_evidence_documents with(security_invoker=true) as
 select d.* from public.evidence_documents d where not exists(
  select 1 from public.evidence_deletion_targets z where z.user_id=d.user_id and z.bucket_id='document-evidence' and z.object_path=d.object_path
 );
revoke all on public.retained_evidence_documents from public,anon,authenticated,service_role;
-- Definer view deliberately exposes only the signed-in owner's safe catalog.
create view public.current_evidence_documents with(security_barrier=true) as
 select d.id,d.user_id,d.file_hash,d.media_type,d.size_bytes from public.evidence_documents d where d.user_id=(select auth.uid())
 and not exists(select 1 from public.evidence_deletion_targets z where z.user_id=d.user_id and z.bucket_id='document-evidence' and z.object_path=d.object_path);
revoke all on public.current_evidence_documents from public,anon,authenticated,service_role;
grant select on public.current_evidence_documents to authenticated;

do $$declare f record;definition text;begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.prosrc like '%public.evidence_documents%'
   and (p.proname like 'finance_plan_context%for_owner' or p.proname in ('tax_deadline_context_for_owner','capture_finance_plan','capture_tax_deadline_review'))
 loop
  definition:=pg_get_functiondef(f.oid);
  if definition ~* '(insert into|delete from|update)[[:space:]]+public[.]evidence_documents' then raise exception 'Unexpected evidence mutation requires review.';end if;
  execute replace(definition,'public.evidence_documents','public.retained_evidence_documents');
 end loop;
end $$;
-- LOCK on the retained view recursively freezes both documents and targets,
-- preserving the existing deadline capture NOWAIT/retry behavior.

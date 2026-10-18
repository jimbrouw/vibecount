-- Share invoice-first registration selection across fresh catalog/preview/save.
-- Retained snapshots and exact request recovery remain unchanged.
-- Salt review context so an outstanding pre-upgrade preview must be reviewed again.
create or replace function public.fx_document_source(p_owner uuid,p_document uuid,p_invoice_scope boolean) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('document',jsonb_build_object('id',d.id,'file_sha256',d.file_hash,'media_type',d.media_type,'size_bytes',d.size_bytes),
  'available',exists(select 1 from storage.objects o where o.bucket_id='document-evidence' and o.name=d.object_path),
  'invoice_scope',exists(select 1 from public.document_batch_items i join public.document_batches b on b.id=i.batch_id and b.user_id=i.user_id where i.document_id=d.id and i.user_id=d.user_id and b.purpose='invoice'),
  'registration',jsonb_build_object('item_id',s.id,'batch_id',s.batch_id,'ordinal',s.ordinal,'purpose',s.purpose,'tax_year_start',s.tax_year_start))
 from public.evidence_documents d join lateral(
  select i.id,i.batch_id,i.ordinal,b.purpose,b.tax_year_start from public.document_batch_items i join public.document_batches b on b.id=i.batch_id and b.user_id=i.user_id
  where i.document_id=d.id and i.user_id=d.user_id and(not p_invoice_scope or b.purpose='invoice') order by (b.purpose='invoice') desc,i.id limit 1
 ) s on true where d.id=p_document and d.user_id=p_owner and d.media_type in('application/pdf','image/png','image/jpeg');
$$;
revoke all on function public.fx_document_source(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create or replace function public.fx_evidence_review_stamp() returns text
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();result text;
begin
 if owner_id is null then raise exception 'Sign in to review FX evidence.';end if;
 select md5('fx-document-source/invoice-first/1|'||public.reconciliation_export_stamp()||'|'||
  coalesce((select string_agg(f.id::text||':'||f.kind,',' order by f.id) from public.fx_document_fact_families f where f.user_id=owner_id),'')||'|'||
  coalesce((select string_agg(r.id::text||':'||r.ordinal::text,',' order by r.id) from public.fx_document_fact_revisions r where r.user_id=owner_id),'')||'|'||
  coalesce((select string_agg(d.id::text||':'||d.file_hash||':'||(exists(select 1 from storage.objects o where o.bucket_id='document-evidence' and o.name=d.object_path))::text,',' order by d.id) from public.evidence_documents d where d.user_id=owner_id),'')||'|'||
  coalesce((select string_agg(i.id::text||':'||b.purpose||':'||b.tax_year_start::text,',' order by i.id) from public.document_batch_items i join public.document_batches b on b.id=i.batch_id and b.user_id=i.user_id where i.user_id=owner_id),'')) into result;
 return result;
end;$$;
revoke all on function public.fx_evidence_review_stamp() from public,anon,service_role;
grant execute on function public.fx_evidence_review_stamp() to authenticated;


-- Read-only scope discovery. No deletion request or erasure capability is exposed.
create function public.preview_evidence_deletion(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); root_hash text; hashes text[]; doc_ids uuid[]:='{}'; import_ids uuid[]:='{}'; tx_ids uuid[]:='{}';
 paths text[]:='{}'; attempts jsonb:='[]'; identities jsonb:='[]'; rows_snapshot jsonb:='[]'; items jsonb:='[]';
 dependencies jsonb; owner_history jsonb; scope jsonb; docs jsonb:='[]'; accounts jsonb:='[]'; years jsonb:='[]';
 raw_rows bigint:=0; encrypted_names bigint:=0; name_copies bigint:=0; existing_objects bigint:=0; pending_attempts bigint:=0; bucket text;
begin
 if owner_id is null then raise exception 'Sign in to preview evidence deletion.'; end if;
 if p_kind not in ('source','document') or p_kind is null or p_id is null then raise exception 'Choose an owned source or document.'; end if;
 if p_kind='source' then
  select f.file_hash into root_hash from public.record_imports i join public.record_source_files f on f.id=i.source_file_id and f.user_id=i.user_id where i.id=p_id and i.user_id=owner_id;
  if not found then raise exception 'Owned source unavailable.'; end if;
  hashes:=array[root_hash];bucket:='source-evidence';
  if (select count(*) from public.source_upload_attempts where user_id=owner_id and file_hash=root_hash)>20000 then raise exception 'Source scope exceeds interactive review capacity.'; end if;
  select coalesce(array_agg(i.id order by i.id),'{}') into import_ids from public.record_imports i where i.user_id=owner_id and i.file_hash=root_hash and i.source_file_id is not null;
  select coalesce(array_agg(id order by id),'{}') into tx_ids from public.bank_transactions where user_id=owner_id and import_id=any(import_ids);
  if cardinality(tx_ids)>20000 then raise exception 'Source scope exceeds interactive review capacity.'; end if;
  select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]') into identities from public.record_source_files f where f.user_id=owner_id and f.file_hash=root_hash;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'),count(*) filter(where state in ('pending','uploaded','failed')) into attempts,pending_attempts from public.source_upload_attempts a where a.user_id=owner_id and a.file_hash=root_hash;
  select coalesce(jsonb_agg(jsonb_build_array(id,import_id,row_number,row_hash,encode(sha256(convert_to(raw_encrypted,'UTF8')),'hex')) order by id),'[]'),count(*) into rows_snapshot,raw_rows from public.source_rows where user_id=owner_id and import_id=any(import_ids);
  select coalesce(array_agg(distinct path order by path),'{}') into paths from (
   select f.object_path path from public.record_source_files f where f.user_id=owner_id and f.file_hash=root_hash
   union select a.object_path from public.source_upload_attempts a where a.user_id=owner_id and a.file_hash=root_hash
  ) all_paths;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'label',a.label,'masked_identifier',a.masked_identifier) order by a.id),'[]') into accounts from public.financial_accounts a where a.user_id=owner_id and a.id in(select account_id from public.record_imports where id=any(import_ids) and user_id=owner_id);
  select coalesce(jsonb_agg(y order by y),'[]') into years from(select distinct tax_year_start y from public.bank_transactions where id=any(tx_ids) and user_id=owner_id) scoped_years;
 else
  select file_hash into root_hash from public.evidence_documents where id=p_id and user_id=owner_id;
  if not found then raise exception 'Owned document unavailable.'; end if;
  bucket:='document-evidence';
  if (select coalesce(sum(jsonb_array_length(planned_objects)),0) from public.document_upload_attempts where user_id=owner_id)>20000 then raise exception 'Document scope exceeds interactive review capacity.'; end if;
  -- Shared child content connects archives/batches. Pending and duplicate attempts
  -- also count, because their retained roots can contain the same child bytes.
  with recursive members as materialized (
   select 'attempt:'||a.id::text group_id,a.file_hash hash from public.document_upload_attempts a where a.user_id=owner_id
   union select 'attempt:'||a.id::text,v->>'hash' from public.document_upload_attempts a cross join lateral jsonb_array_elements(a.planned_objects) v where a.user_id=owner_id
   union select 'batch:'||b.id::text,d.file_hash from public.document_batches b join public.evidence_documents d on d.id=b.root_document_id and d.user_id=b.user_id where b.user_id=owner_id
   union select 'batch:'||i.batch_id::text,d.file_hash from public.document_batch_items i join public.evidence_documents d on d.id=i.document_id and d.user_id=i.user_id where i.user_id=owner_id
  ), closure(hash) as (
   select root_hash union select m2.hash from closure c join members m1 on m1.hash=c.hash join members m2 on m2.group_id=m1.group_id where m2.hash is not null
  ) select array_agg(hash order by hash) into hashes from closure;
  if cardinality(hashes)>5000 or exists(select 1 from unnest(hashes) h where h!~'^[a-f0-9]{64}$') then raise exception 'Document scope cannot be completely previewed.'; end if;
  select coalesce(array_agg(id order by id),'{}'),coalesce(jsonb_agg(to_jsonb(d) order by id),'[]'),
   coalesce(jsonb_agg(jsonb_build_object('id',id,'file_hash',file_hash,'media_type',media_type,'size_bytes',size_bytes) order by id),'[]') into doc_ids,identities,docs from public.evidence_documents d where d.user_id=owner_id and d.file_hash=any(hashes);
  select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'),count(*) filter(where state in ('pending','uploaded','failed')) into attempts,pending_attempts from public.document_upload_attempts a where a.user_id=owner_id and (a.file_hash=any(hashes) or exists(select 1 from jsonb_array_elements(a.planned_objects) v where v->>'hash'=any(hashes)));
  if exists(select 1 from jsonb_array_elements(attempts) a cross join lateral jsonb_array_elements(a->'planned_objects') v where jsonb_typeof(v) is distinct from 'object' or (v->>'hash') is null or (v->>'hash') !~ '^[a-f0-9]{64}$' or (v->>'path') is null or (v->>'path') not like owner_id::text||'/%') then raise exception 'Document copy inventory is incomplete.'; end if;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'),count(*) into items,encrypted_names from public.document_batch_items i where i.user_id=owner_id and i.document_id=any(doc_ids);
  select count(*) into name_copies from jsonb_array_elements(attempts) a cross join lateral jsonb_array_elements(a->'planned_objects') v where v->>'name_encrypted' is not null;
  select coalesce(array_agg(distinct path order by path),'{}') into paths from (
   select object_path path from public.evidence_documents where user_id=owner_id and id=any(doc_ids)
   union select v->>'path' from jsonb_array_elements(attempts) a cross join lateral jsonb_array_elements(a->'planned_objects') v
  ) all_paths where path is not null;
  select coalesce(jsonb_agg(y order by y),'[]') into years from(select distinct b.tax_year_start y from public.document_batches b where b.user_id=owner_id and (b.root_document_id=any(doc_ids) or exists(select 1 from public.document_batch_items i where i.batch_id=b.id and i.user_id=b.user_id and i.document_id=any(doc_ids)))) scoped_years;
 end if;
 select count(*) into existing_objects from storage.objects where bucket_id=bucket and name=any(paths);
 -- Direct references are counted separately from owner-wide saved material that
 -- may retain ancestry in JSON. These counts are not a deletion authorization.
 dependencies:=jsonb_build_object(
  'bank_transactions',cardinality(tx_ids),
  'financial_records',(select count(*) from public.financial_records where user_id=owner_id and bank_transaction_id=any(tx_ids)),
  'classification_decisions',(select count(*) from public.classification_decisions where user_id=owner_id and transaction_id=any(tx_ids)),
  'invoice_settlements',(select count(*) from public.invoice_settlements where user_id=owner_id and transaction_id=any(tx_ids)),
  'tax_fact_sources',(select count(*) from public.tax_fact_sources where user_id=owner_id and (document_id=any(doc_ids) or transaction_id=any(tx_ids) or record_id in(select id from public.financial_records where user_id=owner_id and bank_transaction_id=any(tx_ids)))),
  'merchant_evidence',(select count(*) from public.merchant_review_evidence where user_id=owner_id and document_id=any(doc_ids)),
  'fx_document_revisions',(select count(*) from public.fx_document_fact_revisions where user_id=owner_id and (document_id=any(doc_ids) or transaction_id=any(tx_ids))),
  'bank_valuation_revisions',(select count(*) from public.bank_valuation_revisions where user_id=owner_id and document_id=any(doc_ids))
 );
 owner_history:=jsonb_build_object(
  'tax_calculations',(select count(*) from public.tax_calculations where user_id=owner_id),
  'filing_packs',(select count(*) from public.filing_packs where user_id=owner_id),
  'finance_plan_revisions',(select count(*) from public.finance_plan_revisions where user_id=owner_id)
 );
 -- Fingerprint the private inventory without exposing paths, ciphertext or keys.
 -- Future confirmation must recompute scope and dependency versions under locks.
 scope:=jsonb_build_object('kind',p_kind,'target',p_id,'hashes',hashes,'identities',identities,'attempts',attempts,'rows',rows_snapshot,'items',items,'paths',paths,'present_objects',existing_objects,'dependencies',dependencies,'owner_history',owner_history);
 return jsonb_build_object('schema_version',1,'kind',p_kind,'target_id',p_id,'preview_only',true,
  'inventory_sha256',encode(sha256(convert_to(scope::text,'UTF8')),'hex'),'content_hashes',to_jsonb(hashes),'documents',docs,'accounts',accounts,'tax_years',years,
  'counts',jsonb_build_object('content_hashes',cardinality(hashes),'registered_documents',cardinality(doc_ids),'imports',cardinality(import_ids),'retained_object_paths',cardinality(paths),'present_objects',existing_objects,'raw_source_rows',raw_rows,'document_name_copies',encrypted_names+name_copies,'upload_attempts',jsonb_array_length(attempts),'unfinished_attempts',pending_attempts),
  'direct_references',dependencies,'owner_saved_material',owner_history);
end $$;
revoke all on function public.preview_evidence_deletion(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.preview_evidence_deletion(text,uuid) to authenticated;

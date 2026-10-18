import {exportDeletionManifest,verifyDeletionManifest,type ManifestDatabase} from './deletion-manifest';

/** Run while application, upload workers and Storage access remain quarantined.
 * This verifies only manifest suppression, not backup integrity or hosted readiness.
 */
export async function verifyRestoredDeletion(
 db:ManifestDatabase,bytes:string,expected:{deployment:string;checkpoint:string;sha256:string},
 providerAbsent:(bucket:string,path:string)=>Promise<boolean>,
){
 const manifest=verifyDeletionManifest(bytes,expected);
 const current=await exportDeletionManifest(db,expected.deployment,expected.checkpoint);
 if(current.sha256!==expected.sha256)throw Error('Restored deletion scope does not match the independent ledger.');
 const checks=(await db.query<{blocked:boolean}>(`select (
 exists(select 1 from evidence_deletion_targets t join storage.objects o on o.bucket_id=t.bucket_id and o.name=t.object_path)
 or exists(select 1 from evidence_deletion_requests r where not exists(select 1 from evidence_deletion_scrubs s where s.request_id=r.id and s.user_id=r.user_id))
 or exists(select 1 from evidence_deletion_targets t where not exists(
  select 1 from evidence_removal_attempts a join evidence_removal_outcomes o on o.attempt_id=a.id and o.user_id=a.user_id
  where a.request_id=t.request_id and a.user_id=t.user_id and a.bucket_id=t.bucket_id and a.object_path=t.object_path and o.outcome='absent'))
 or exists(select 1 from evidence_deletion_targets t join evidence_upload_operations u on u.user_id=t.user_id and u.bucket_id=t.bucket_id and u.file_hash=t.file_hash
  where not exists(select 1 from evidence_upload_completions c where c.operation_id=u.id and c.user_id=u.user_id))
 or exists(select 1 from source_rows s join record_imports i on i.id=s.import_id and i.user_id=s.user_id
  join record_source_files f on f.id=i.source_file_id and f.user_id=i.user_id
  join evidence_deletion_targets t on t.user_id=f.user_id and t.bucket_id='source-evidence' and t.object_path=f.object_path
  where s.raw_encrypted is not null)
 or exists(select 1 from document_batch_items i join evidence_documents d on d.id=i.document_id and d.user_id=i.user_id
  join evidence_deletion_targets t on t.user_id=d.user_id and t.bucket_id='document-evidence' and t.object_path=d.object_path
  where i.original_name_encrypted is not null)
 or exists(select 1 from document_upload_attempts a cross join lateral jsonb_array_elements(a.planned_objects) v
  join evidence_deletion_targets t on t.user_id=a.user_id and t.bucket_id='document-evidence' and t.object_path=v->>'path'
  where v->>'name_encrypted' is not null)
 ) blocked`)).rows[0];
 if(!checks||checks.blocked!==false)throw Error('Restored evidence suppression is incomplete.');
 for(const target of manifest.targets){
  if(await providerAbsent(String(target.bucket_id),String(target.object_path))!==true)
   throw Error('Restored provider object absence is unverified.');
 }
 return{schema:'evidence-restore-suppression/1' as const,checkpoint:expected.checkpoint,sha256:expected.sha256,
  verifiedTargets:manifest.targets.length,suppressionVerified:true as const,hostedReady:false as const};
}

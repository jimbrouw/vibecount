import {createHash} from 'node:crypto';

type Row=Record<string,unknown>;
export type DeletionManifest={schema:'evidence-deletion-ledger/1';deployment:string;checkpoint:string;requests:Row[];targets:Row[]};
export type ManifestDatabase={query<T>(sql:string,params?:unknown[]):Promise<{rows:T[]}>};
const hash=(bytes:string)=>createHash('sha256').update(bytes).digest('hex');

/** Export inside a consistent transaction. Keep outside the restored backup domain. */
export async function exportDeletionManifest(db:ManifestDatabase,deployment:string,checkpoint:string){
 if(!deployment.trim()||!checkpoint.trim())throw Error('Deployment and checkpoint required.');
 const requests=(await db.query<{r:Row}>('select to_jsonb(r) r from evidence_deletion_requests r order by id')).rows.map(v=>v.r);
 const targets=(await db.query<{r:Row}>('select to_jsonb(t) r from evidence_deletion_targets t join evidence_deletion_requests r on r.id=t.request_id and r.user_id=t.user_id order by t.bucket_id,t.object_path')).rows.map(v=>v.r);
 const bytes=JSON.stringify({schema:'evidence-deletion-ledger/1',deployment,checkpoint,requests,targets});
 return{bytes,sha256:hash(bytes)};
}

/** Expected checkpoint/digest must come from an independent trusted channel. */
export function verifyDeletionManifest(bytes:string,expected:{deployment:string;checkpoint:string;sha256:string}):DeletionManifest{
 if(Buffer.byteLength(bytes)>20_000_000||hash(bytes)!==expected.sha256)throw Error('Deletion ledger digest mismatch or size limit.');
 const value=JSON.parse(bytes) as DeletionManifest;
 if(!value||value.schema!=='evidence-deletion-ledger/1'||value.deployment!==expected.deployment||value.checkpoint!==expected.checkpoint
  ||!Array.isArray(value.requests)||!Array.isArray(value.targets))throw Error('Deletion ledger identity mismatch.');
 const ids=new Map<string,string>(),paths=new Set<string>();
 for(const r of value.requests){
  if(!r||typeof r.id!=='string'||typeof r.user_id!=='string'||ids.has(r.id))throw Error('Invalid deletion request identity.');
  ids.set(r.id,r.user_id);
 }
 for(const t of value.targets){
  if(!t||typeof t.request_id!=='string'||!ids.has(t.request_id)||ids.get(t.request_id)!==t.user_id||typeof t.object_path!=='string'
   ||!['source-evidence','document-evidence'].includes(String(t.bucket_id)))throw Error('Invalid deletion target identity.');
  const path=JSON.stringify([t.bucket_id,t.object_path]);if(paths.has(path))throw Error('Duplicate deletion target.');paths.add(path);
 }
 if(value.requests.some(r=>!value.targets.some(t=>t.request_id===r.id)))throw Error('Deletion request has no targets.');
 return value;
}

/** Caller must hold external quarantine and a database transaction across replay. */
export async function replayDeletionManifest(db:ManifestDatabase,bytes:string,expected:{deployment:string;checkpoint:string;sha256:string}){
 const manifest=verifyDeletionManifest(bytes,expected);
 for(const request of manifest.requests){
  await db.query('select replay_evidence_deletion_intent($1::jsonb,$2::jsonb)',[
   JSON.stringify(request),JSON.stringify(manifest.targets.filter(t=>t.request_id===request.id)),
  ]);
 }
 return{checkpoint:manifest.checkpoint,requests:manifest.requests.length,targets:manifest.targets.length,ready:false as const};
}

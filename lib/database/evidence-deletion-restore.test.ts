import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {TEST_SCHEMA_BOOTSTRAP} from './test-schema';
import {bankValuationFixture,openSyntheticForeignAdmission} from './bank-valuation-fixture';
import {exportDeletionManifest,replayDeletionManifest,verifyDeletionManifest} from '../records/deletion-manifest';
import {verifyRestoredDeletion} from '../records/deletion-restore-verification';
import {removeEvidenceObject,type EvidenceRemovalWorker} from '../records/evidence-removal';

test('old backup replays later confirmed intent, scrubs restored ciphertext and preserves financial history',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url);
 for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 await openSyntheticForeignAdmission(db);const f=await bankValuationFixture(db),other=await bankValuationFixture(db,'KWD','-20.002',f.other);
 t.after(()=>{f.key.fill(0);other.key.fill(0)});
 await db.query("insert into financial_records(user_id,record_type,record_date,description,amount,status) values($1,'expense','2026-04-05','Retained synthetic fact',1,'draft')",[f.owner]);
 const financial=(await db.query('select * from financial_records order by id')).rows;
 const untouched=(await db.query('select * from source_rows where user_id=$1 order by id',[f.other])).rows;
 const backup=await db.dumpDataDir();
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.owner]);
 for(const [kind,id] of [['source',f.imported],['document',f.document]]){
  const review=(await db.query<{r:{inventory_sha256:string;review_sha256:string}}>('select review_evidence_deletion($1,$2) r',[kind,id])).rows[0].r;
  await db.query("select record_evidence_deletion_request($1,$2,$3,$4,'evidence-deletion/1','Synthetic explicit restore test',$5,true)",[kind,id,review.inventory_sha256,review.review_sha256,randomUUID()]);
 }
 // Independently retained intent excludes scrub/removal success from the live database.
 const manifest=await db.transaction(tx=>exportDeletionManifest(tx,'synthetic-deployment','checkpoint-1'));
 const expected={deployment:'synthetic-deployment',checkpoint:'checkpoint-1',sha256:manifest.sha256};
 assert.throws(()=>verifyDeletionManifest(manifest.bytes+' ',expected),/digest/);
 assert.throws(()=>verifyDeletionManifest(JSON.stringify({...JSON.parse(manifest.bytes),targets:[]}),expected),/digest/);
 assert.throws(()=>verifyDeletionManifest(manifest.bytes,{...expected,deployment:'wrong'}),/identity/);
 assert.throws(()=>verifyDeletionManifest(manifest.bytes,{...expected,checkpoint:'checkpoint-2'}),/identity/);
 const restored=new PGlite({loadDataDir:backup,extensions:{pgcrypto}});t.after(()=>restored.close());
 assert.equal((await restored.query('select * from evidence_deletion_requests')).rows.length,0);
 for(const [kind,id] of [['source',f.imported],['document',f.document]]){
  assert.equal((await restored.query<{ok:boolean}>('select evidence_original_available($1,$2,$3) ok',[f.owner,kind,id])).rows[0].ok,true);
 }
 // Mid-replay failure rolls the entire manifest back, not just the failing request.
 await restored.exec("create function reject_restore_scrub() returns trigger language plpgsql as $$begin raise exception 'Synthetic restore failure';end$$;create trigger reject_restore_scrub before insert on evidence_deletion_scrubs for each row execute function reject_restore_scrub()");
 await assert.rejects(restored.transaction(tx=>replayDeletionManifest(tx,manifest.bytes,expected)),/Synthetic restore failure/);
 assert.equal((await restored.query('select * from evidence_deletion_requests')).rows.length,0);
 await restored.exec('drop trigger reject_restore_scrub on evidence_deletion_scrubs;drop function reject_restore_scrub()');
 const result=await restored.transaction(tx=>replayDeletionManifest(tx,manifest.bytes,expected));assert.equal(result.ready,false);
 await restored.transaction(tx=>replayDeletionManifest(tx,manifest.bytes,expected));
 assert.equal((await restored.query('select * from source_rows where user_id=$1 and raw_encrypted is not null',[f.owner])).rows.length,0);
 assert.equal((await restored.query('select * from document_batch_items where user_id=$1 and original_name_encrypted is not null',[f.owner])).rows.length,0);
 assert.deepEqual((await restored.query('select * from source_rows where user_id=$1 order by id',[f.other])).rows,untouched);
 assert.deepEqual((await restored.query('select * from financial_records order by id')).rows,financial);
 for(const [kind,id] of [['source',f.imported],['document',f.document]]){
  assert.equal((await restored.query<{ok:boolean}>('select evidence_original_available($1,$2,$3) ok',[f.owner,kind,id])).rows[0].ok,false);
 }
 assert.equal((await restored.query('select * from evidence_removal_outcomes')).rows.length,0);
 assert.equal((await restored.query("select 1 from document_upload_attempts a cross join lateral jsonb_array_elements(a.planned_objects) v where a.user_id=$1 and v->>'name_encrypted' is not null",[f.owner])).rows.length,0);
 // Restored remote bytes have not been removed: replay must never claim ready.
 assert.ok((await restored.query('select * from storage.objects')).rows.length>0);
 // A separate object store survives the database restore. Use actual encrypted
 // fixture bytes, not metadata presence, as the provider absence check.
 const objects=new Map([
  ['source-evidence/'+f.path,Buffer.from(f.cipher)],['document-evidence/'+f.documentPath,Buffer.from(f.documentCipher)],
  ['source-evidence/'+other.path,Buffer.from(other.cipher)],['document-evidence/'+other.documentPath,Buffer.from(other.documentCipher)],
 ]);
 t.after(()=>{for(const bytes of objects.values())bytes.fill(0)});
 const absent=async(bucket:string,path:string)=>!objects.has(bucket+'/'+path);
 await assert.rejects(verifyRestoredDeletion(restored,manifest.bytes,expected,absent),/incomplete/);
 let failRemoval=true;
 const worker:EvidenceRemovalWorker={
  async rpc(name,args){
   if(name==='begin_evidence_removal')return{error:null,data:(await restored.query<{ok:boolean}>('select begin_evidence_removal($1,$2,$3,$4,$5) ok',[args.p_owner,args.p_request,args.p_bucket,args.p_path,args.p_attempt])).rows[0].ok};
   assert.equal(name,'record_evidence_removal_outcome');
   return{error:null,data:(await restored.query<{ok:boolean}>('select record_evidence_removal_outcome($1,$2,$3,$4) ok',[args.p_owner,args.p_attempt,args.p_outcome,args.p_provider_absent])).rows[0].ok};
  },
  async remove(bucket,path){
   if(failRemoval)return{error:Error('Synthetic provider failure')};
   const key=bucket+'/'+path;objects.get(key)?.fill(0);objects.delete(key);
   await restored.query('delete from storage.objects where bucket_id=$1 and name=$2',[bucket,path]);return{error:null};
  },verifyAbsent:absent,
 };
 const targets=verifyDeletionManifest(manifest.bytes,expected).targets;
 for(const row of targets){
  const target={owner:String(row.user_id),request:String(row.request_id),bucket:row.bucket_id as 'source-evidence'|'document-evidence',path:String(row.object_path)};
  if(failRemoval){assert.equal(await removeEvidenceObject(worker,target),'failed');await assert.rejects(verifyRestoredDeletion(restored,manifest.bytes,expected,absent),/incomplete/);failRemoval=false;}
  assert.equal(await removeEvidenceObject(worker,target),'absent');
 }
 const report=await verifyRestoredDeletion(restored,manifest.bytes,expected,absent);
 assert.equal(report.suppressionVerified,true);assert.equal(report.hostedReady,false);assert.equal(report.verifiedTargets,2);
 assert.deepEqual(objects.get('source-evidence/'+other.path),other.cipher);
 assert.deepEqual(objects.get('document-evidence/'+other.documentPath),other.documentCipher);
 assert.deepEqual((await restored.query('select * from financial_records order by id')).rows,financial);
 // Even a durable prior success cannot conceal a reappearing provider object.
 objects.set('source-evidence/'+f.path,Buffer.from(f.cipher));
 await assert.rejects(verifyRestoredDeletion(restored,manifest.bytes,expected,absent),/provider object absence/);
 objects.get('source-evidence/'+f.path)!.fill(0);objects.delete('source-evidence/'+f.path);
 for(const role of ['authenticated','anon','service_role']){
  await restored.exec('reset role;set role '+role);
  await assert.rejects(restored.transaction(tx=>replayDeletionManifest(tx,manifest.bytes,expected)),/permission denied/);
 }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {TEST_SCHEMA_BOOTSTRAP} from './test-schema';
import {bankValuationFixture,openSyntheticForeignAdmission} from './bank-valuation-fixture';
test('durable upload admission blocks deletion across duplicate paths until acknowledged completion',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url);for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 await openSyntheticForeignAdmission(db);const f=await bankValuationFixture(db);t.after(()=>f.key.fill(0));
 const attempt=randomUUID(),path=`${f.owner}/${f.account}/${attempt}.enc`,operation=randomUUID();
 await db.query("insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values($1,$2,$3,$4,$5,'synthetic',$6,'pending')",[attempt,f.owner,f.account,f.hash,path,f.sourceBytes.length]);
 const begin=(id=operation,owner=f.owner,destination=path)=>db.query('select begin_evidence_upload($1,$2,$3,$4,$5)',[owner,'source',attempt,destination,id]);
 const complete=(id=operation,owner=f.owner)=>db.query('select completed_evidence_upload($1,$2)',[owner,id]);
 const mark=()=>db.query("insert into evidence_deletion_targets(user_id,request_id,bucket_id,object_path,file_hash) values($1,$2,'source-evidence',$3,$4)",[f.owner,randomUUID(),f.path,f.hash]);
 const preview=async()=>{
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.owner]);await db.exec('set role authenticated');
  const r=(await db.query<{r:{counts:{unresolved_upload_operations:number};inventory_sha256:string}}>("select preview_evidence_deletion('source',$1) r",[f.imported])).rows[0].r;
  await db.exec('reset role;set role service_role');return r;
 };
 const before=await preview();assert.equal(before.counts.unresolved_upload_operations,0);
 await db.exec('set role service_role');
 await assert.rejects(begin(randomUUID(),f.other),/Owned upload attempt/);
 await assert.rejects(begin(randomUUID(),f.owner,f.path),/Owned planned evidence/);
 await begin();const pending=await preview();assert.equal(pending.counts.unresolved_upload_operations,1);assert.notEqual(pending.inventory_sha256,before.inventory_sha256);await assert.rejects(begin(),/unresolved outcome/);await assert.rejects(begin(randomUUID()),/unresolved outcome/);
 await assert.rejects(complete(operation,f.other),/Owned upload operation/);
 await assert.rejects(complete(),/Acknowledged evidence object unavailable/);
 await db.exec('reset role');await assert.rejects(mark(),/upload outcome is unresolved/);
 // Object presence without the provider acknowledgement does not release deletion.
 await db.query("insert into storage.objects(bucket_id,name) values('source-evidence',$1)",[path]);
 await assert.rejects(mark(),/upload outcome is unresolved/);
 await db.exec('set role service_role');await complete();await complete();const finished=await preview();assert.equal(finished.counts.unresolved_upload_operations,0);assert.notEqual(finished.inventory_sha256,pending.inventory_sha256);
 await assert.rejects(begin(),/duplicate key/);
 for(const table of ['evidence_upload_operations','evidence_upload_completions']){
  await assert.rejects(db.query('select * from '+table),/permission denied/);
  await assert.rejects(db.query('delete from '+table),/permission denied/);
 }
 await db.exec('reset role');await mark();
 await db.exec('set role service_role');await assert.rejects(begin(randomUUID()),/marked for deletion/);
 await complete(); // historical acknowledgement retry does not perform I/O
 await db.exec('reset role');
 for(const table of ['evidence_upload_operations','evidence_upload_completions'])await assert.rejects(db.query('delete from '+table),/immutable|preserved|append.only/i);
 const documentAttempt=(await db.query<{id:string}>('select id from document_upload_attempts where user_id=$1',[f.owner])).rows[0].id,documentOperation=randomUUID();
 await db.exec('set role service_role');
 await db.query("select begin_evidence_upload($1,'document',$2,$3,$4)",[f.owner,documentAttempt,f.documentPath,documentOperation]);
 await db.exec('reset role');await assert.rejects(db.query("insert into evidence_deletion_targets(user_id,request_id,bucket_id,object_path,file_hash) values($1,$2,'document-evidence',$3,$4)",[f.owner,randomUUID(),f.documentPath,f.documentHash]),/upload outcome is unresolved/);
 for(const role of ['authenticated','anon']){
  await db.exec('reset role;set role '+role);await assert.rejects(begin(randomUUID()),/permission denied/);await assert.rejects(complete(),/permission denied/);
 }
 await db.exec('reset role');assert.equal((await db.query('select * from evidence_upload_operations')).rows.length,2);
 assert.equal((await db.query('select * from evidence_upload_completions')).rows.length,1);
});

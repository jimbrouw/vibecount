import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {TEST_SCHEMA_BOOTSTRAP} from './test-schema';
import {bankValuationFixture,openSyntheticForeignAdmission} from './bank-valuation-fixture';
type Preview={counts:Record<string,number>;content_hashes:string[];inventory_sha256:string;direct_references:Record<string,number>;accounts:unknown[];preview_only:boolean};
test('deletion preview includes shared ZIP closure, unfinished copies and all-account statement duplicates without exposing or deleting ciphertext',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../../supabase/migrations/',import.meta.url);
 for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 const owner=randomUUID(),other=randomUUID();await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);
 const hashes=['a','b','d','e','f','1'].map(v=>v.repeat(64));
 async function archive(items:string[],register:boolean){
  await db.exec('reset role');const id=randomUUID(),objects=items.map((hash,n)=>({hash,size:100,media_type:n===0?'application/zip':'application/pdf',path:`${owner}/${id}/${n}.enc`,key_id:'PRIVATE_KEY_ID',name_encrypted:'PRIVATE_NAME_CIPHERTEXT'}));
  await db.query("insert into document_upload_attempts(id,user_id,file_hash,state,planned_objects) values($1,$2,$3,'uploaded',$4)",[id,owner,items[0],JSON.stringify(objects)]);
  for(const o of objects)await db.query("insert into storage.objects(bucket_id,name) values('document-evidence',$1)",[o.path]);
  if(register)await db.query("select register_document_intake($1,$2,2025,'invoice','opaque-evidence/1')",[owner,id]);return id;
 }
 await archive([hashes[0],hashes[1]],true);await archive([hashes[2],hashes[1],hashes[3]],true);await archive([hashes[4],hashes[1],hashes[5]],false);
 const document=(await db.query<{id:string}>('select id from evidence_documents where user_id=$1 and file_hash=$2',[owner,hashes[1]])).rows[0].id;
 async function auth(who=owner){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who]);await db.exec('set role authenticated')}
 async function preview(kind:string,id:string){return(await db.query<{r:Preview}>('select preview_evidence_deletion($1,$2) r',[kind,id])).rows[0].r}
 const before=(await db.query('select * from document_upload_attempts order by id')).rows;
 await auth();const result=await preview('document',document);
 assert.deepEqual(result.content_hashes,[...hashes].sort());assert.equal(result.counts.registered_documents,4);assert.equal(result.counts.retained_object_paths,8);assert.equal(result.counts.present_objects,8);assert.equal(result.counts.document_name_copies,13);assert.equal(result.counts.unfinished_attempts,1);assert.equal(result.preview_only,true);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|\.enc|"object_path"|"key_id"|"name_encrypted"|"raw_encrypted"/);assert.match(result.inventory_sha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(await preview('document',document),result);
 await auth(other);await assert.rejects(preview('document',document),/Owned document unavailable/);
 await db.exec('reset role');assert.deepEqual((await db.query('select * from document_upload_attempts order by id')).rows,before);
 await db.query("delete from storage.objects where bucket_id='document-evidence' and name=(select object_path from evidence_documents where id=$1)",[document]);await auth();const missing=await preview('document',document);assert.equal(missing.counts.present_objects,7);assert.notEqual(missing.inventory_sha256,result.inventory_sha256);
 await db.exec('reset role');await openSyntheticForeignAdmission(db);const a=await bankValuationFixture(db,'KWD','-10.001',owner),b=await bankValuationFixture(db,'KWD','-10.001',owner);
 const attempt=randomUUID();await db.query("insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state,recovery_plan) values($1,$2,$3,$4,$5,'PRIVATE_KEY',100,'failed',$6)",[attempt,owner,a.account,a.hash,`${owner}/${a.account}/${attempt}.enc`,JSON.stringify({filename:'PRIVATE_FILENAME'})]);
 await db.query("insert into financial_records(user_id,record_type,record_date,description,amount,status) values($1,'expense','2026-04-05','Synthetic unrelated record',1,'draft')",[owner]);
 const rawBefore=(await db.query('select id,raw_encrypted from source_rows order by id')).rows;
 await auth();const source=await preview('source',a.imported);assert.equal(source.counts.imports,2);assert.equal(source.counts.raw_source_rows,2);assert.equal(source.counts.retained_object_paths,3);assert.equal(source.counts.present_objects,2);assert.equal(source.accounts.length,2);assert.equal(source.direct_references.financial_records,0);assert.equal(source.direct_references.bank_transactions,2);assert.doesNotMatch(JSON.stringify(source),/PRIVATE_|\.enc|raw_encrypted/);
 await auth(other);await assert.rejects(preview('source',a.imported),/Owned source unavailable/);
 for(const role of ['anon','service_role']){await db.exec('reset role;set role '+role);await assert.rejects(preview('source',a.imported),/permission denied/)}
 await db.exec('reset role');assert.deepEqual((await db.query('select id,raw_encrypted from source_rows order by id')).rows,rawBefore);assert.equal((await db.query('select * from financial_records where user_id=$1',[owner])).rows.length,1);a.key.fill(0);b.key.fill(0);
});

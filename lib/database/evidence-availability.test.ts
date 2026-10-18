import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {TEST_SCHEMA_BOOTSTRAP} from './test-schema';
import {bankValuationFixture,openSyntheticForeignAdmission} from './bank-valuation-fixture';
import {prepareSourceOriginal,type OriginalSource} from '../records/source-original';

test('marked originals remain preserved but cannot be downloaded, re-registered or recovered',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url);
 for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 await openSyntheticForeignAdmission(db);const f=await bankValuationFixture(db);t.after(()=>f.key.fill(0));
 const available=async(kind:string,id:string,owner=f.owner)=>(await db.query<{ok:boolean}>('select evidence_original_available($1,$2,$3) ok',[owner,kind,id])).rows[0].ok;
 const mark=async(bucket:string,path:string,hash:string)=>db.query('insert into evidence_deletion_targets(user_id,request_id,bucket_id,object_path,file_hash) values($1,$2,$3,$4,$5)',[f.owner,randomUUID(),bucket,path,hash]);
 const before=(await db.query('select * from source_rows')).rows;
 await db.exec('set role service_role');assert.equal(await available('source',f.imported),true);assert.equal(await available('document',f.document),true);assert.equal(await available('source',f.imported,f.other),false);
 for(const role of ['service_role','authenticated','anon']){
  await db.exec('reset role;set role '+role);
  await assert.rejects(mark('source-evidence',f.path,f.hash),/permission denied/);
  await assert.rejects(db.query('select * from evidence_deletion_targets'),/permission denied/);
 }
 await db.exec('reset role');
 await assert.rejects(mark('source-evidence',f.path,'a'.repeat(64)),/Owned evidence target required/);
 // Simulate a target committing after ciphertext download, before audit approval.
 await db.exec('set role service_role');
 await assert.rejects(prepareSourceOriginal(f.owner,f.imported,{
  async read(){return(await db.query<{r:OriginalSource}>("select jsonb_build_object('id',i.id,'user_id',i.user_id,'account_id',i.account_id,'source_file_id',i.source_file_id,'file_hash',i.file_hash,'file',to_jsonb(s)) r from record_imports i join record_source_files s on s.id=i.source_file_id where i.id=$1",[f.imported])).rows[0].r},
  key:()=>Buffer.from(f.key),
  async download(){await db.exec('reset role');await mark('source-evidence',f.path,f.hash);await db.exec('set role service_role');return f.cipher},
  async audit(a){await db.query('insert into source_original_access(user_id,import_id,source_file_id,account_id,file_hash,size_bytes) values($1,$2,$3,$4,$5,$6)',[a.user_id,a.import_id,a.source_file_id,a.account_id,a.file_hash,a.size_bytes])}
 }),/Original evidence unavailable/);
 assert.equal(await available('source',f.imported),false);assert.equal(await available('document',f.document),true);
 await db.exec('reset role');await mark('document-evidence',f.documentPath,f.documentHash);
 await db.exec('set role service_role');assert.equal(await available('document',f.document),false);
 await assert.rejects(db.query('insert into document_original_access(user_id,document_id,file_hash,size_bytes) values($1,$2,$3,$4)',[f.owner,f.document,f.documentHash,f.documentBytes.length]),/Original evidence unavailable/);
 await db.exec('reset role');
 const attempt=(await db.query<{id:string}>('select id from document_upload_attempts where user_id=$1',[f.owner])).rows[0].id;
 await db.exec('set role service_role');
 await assert.rejects(db.query("select register_document_intake($1,$2,2025,'other','opaque-evidence/1')",[f.owner,attempt]),/marked for deletion/);
 await db.exec('reset role');
 await assert.rejects(db.query("insert into document_upload_attempts(id,user_id,file_hash,state,planned_objects) values($1,$2,$3,'uploaded',$4)",[randomUUID(),f.owner,f.documentHash,JSON.stringify([{hash:f.documentHash,path:f.documentPath,size:f.documentBytes.length,media_type:'application/pdf',key_id:'synthetic-v1'}])]),/marked for deletion/);
 await assert.rejects(db.query("insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values($1,$2,$3,$4,$5,'synthetic-v1',$6,'uploaded')",[randomUUID(),f.owner,f.account,f.hash,f.path,f.sourceBytes.length]),/marked for deletion/);
 for(const sql of ['delete from evidence_deletion_targets','update evidence_deletion_targets set request_id=gen_random_uuid()'])await assert.rejects(db.query(sql),/immutable|preserved|append.only/i);
 assert.deepEqual((await db.query('select * from source_rows')).rows,before);
 assert.equal((await db.query('select * from storage.objects')).rows.length,2);
 assert.equal((await db.query('select * from source_original_access')).rows.length,0);
 assert.equal((await db.query('select * from document_original_access')).rows.length,0);
});

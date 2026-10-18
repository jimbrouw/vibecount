import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {bankValuationFixture,openSyntheticForeignAdmission} from './bank-valuation-fixture';
import {prepareSourceOriginal,type OriginalSource} from '../records/source-original';
import {TEST_SCHEMA_BOOTSTRAP} from './test-schema';
test('original access audit is owner-readable, service-insertable and cannot bind another owner or rewrite history',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../../supabase/migrations/',import.meta.url);
 for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 const owner=randomUUID(),other=randomUUID(),doc=randomUUID(),documentPath=`${owner}/${randomUUID()}/0.enc`;await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);
 await db.query("insert into evidence_documents(id,user_id,file_hash,media_type,size_bytes,object_path,key_id) values($1,$2,$3,'application/pdf',100,$4,'retained-v1')",[doc,owner,'a'.repeat(64),documentPath]);
 await db.query("insert into storage.objects(bucket_id,name) values('document-evidence',$1)",[documentPath]);
 await db.exec('set role service_role');await db.query('insert into document_original_access(user_id,document_id,file_hash,size_bytes) values($1,$2,$3,100)',[owner,doc,'a'.repeat(64)]);
 await assert.rejects(db.query('insert into document_original_access(user_id,document_id,file_hash,size_bytes) values($1,$2,$3,100)',[other,doc,'a'.repeat(64)]),/Original evidence unavailable/);
 for(const sql of ['update document_original_access set size_bytes=101','delete from document_original_access'])await assert.rejects(db.query(sql),/permission denied/);
 await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');assert.equal((await db.query('select * from document_original_access')).rows.length,1);await assert.rejects(db.query('insert into document_original_access(user_id,document_id,file_hash,size_bytes) values($1,$2,$3,100)',[owner,doc,'a'.repeat(64)]),/permission denied/);
 await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);await db.exec('set role authenticated');assert.equal((await db.query('select * from document_original_access')).rows.length,0);
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from document_original_access'),/permission denied/);
 await db.exec('reset role');await openSyntheticForeignAdmission(db);const source=await bankValuationFixture(db,'KWD','-10.001',owner);await db.exec('set role service_role');
 const output=await prepareSourceOriginal(owner,source.imported,{
  async read(){return(await db.query<{r:OriginalSource}>("select jsonb_build_object('id',i.id,'user_id',i.user_id,'account_id',i.account_id,'source_file_id',i.source_file_id,'file_hash',i.file_hash,'file',to_jsonb(f)) r from record_imports i join record_source_files f on f.id=i.source_file_id where i.id=$1 and i.user_id=$2",[source.imported,owner])).rows[0].r},
  key:()=>Buffer.from(source.key),download:async()=>source.cipher,
  async audit(a){await db.query('insert into source_original_access(user_id,import_id,source_file_id,account_id,file_hash,size_bytes) values($1,$2,$3,$4,$5,$6)',[a.user_id,a.import_id,a.source_file_id,a.account_id,a.file_hash,a.size_bytes])}
 });assert.deepEqual(output.bytes,source.sourceBytes);assert.equal((await db.query('select * from source_original_access')).rows.length,1);
 for(const sql of ['update source_original_access set size_bytes=1','delete from source_original_access'])await assert.rejects(db.query(sql),/permission denied/);
 await assert.rejects(db.query('insert into source_original_access(user_id,import_id,source_file_id,account_id,file_hash,size_bytes) values($1,$2,$3,$4,$5,100)',[owner,source.imported,source.file,source.account,'b'.repeat(64)]),/Original evidence unavailable/);
 await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');assert.equal((await db.query('select * from source_original_access')).rows.length,1);await assert.rejects(db.query('delete from source_original_access'),/permission denied/);
 await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);await db.exec('set role authenticated');assert.equal((await db.query('select * from source_original_access')).rows.length,0);
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from source_original_access'),/permission denied/);source.key.fill(0);

});

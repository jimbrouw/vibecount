// Isolated rehearsal only: no production credentials, network, restore target or provider calls.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {TEST_SCHEMA_BOOTSTRAP} from '../lib/database/test-schema';
import {persistSourceCsv} from '../lib/records/source-persistence';
import {readSourceCsv,suggestMapping} from '../lib/records/source-csv';
import {persistDocumentIntake} from '../lib/records/document-persistence';
import {prepareDocumentIntake} from '../lib/records/document-intake';
import {verifiedBytes} from '../lib/records/evidence-recovery';
import {decryptSource,sourceContext,documentContext,documentNameContext,sourceHash} from '../lib/records/source-crypto';
import {parseEvidenceKeyring,type EvidenceKeyring} from '../lib/records/evidence-keyring';

async function databaseDigest(db:PGlite){
 const tables=(await db.query<{schemaname:string;tablename:string}>("select schemaname,tablename from pg_tables where schemaname in('public','auth','storage') order by schemaname,tablename")).rows;
 const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';const hashes=[];
 for(const t of tables){const rows=(await db.query<{r:string}>(`select to_jsonb(t)::text r from ${quote(t.schemaname)}.${quote(t.tablename)} t order by to_jsonb(t)::text`)).rows;hashes.push([t.schemaname,t.tablename,rows.length,sourceHash(Buffer.from(JSON.stringify(rows)))]);}
 return{tables:tables.length,sha256:sourceHash(Buffer.from(JSON.stringify(hashes)))};
}
async function verify(db:PGlite,objects:Map<string,Buffer>,keys:EvidenceKeyring){
 const metadata=(await db.query<{bucket_id:string;name:string}>("select bucket_id,name from storage.objects where bucket_id in('source-evidence','document-evidence') order by bucket_id,name")).rows;
 assert.deepEqual([...objects.keys()].sort(),metadata.map(r=>r.bucket_id+'/'+r.name).sort(),'Complete object inventory required');
 let originals=0,rows=0,names=0;
 const sources=(await db.query<{id:string;user_id:string;account_id:string;file_hash:string;size_bytes:number;object_path:string;key_id:string}>('select * from record_source_files order by id')).rows;
 for(const f of sources){const key=keys.key(f.key_id);try{verifiedBytes(objects.get('source-evidence/'+f.object_path)??null,key,sourceContext(f.user_id,f.account_id,f.file_hash),f.file_hash,f.size_bytes).fill(0);originals++;}finally{key.fill(0)}}
 const documents=(await db.query<{user_id:string;file_hash:string;size_bytes:number;object_path:string;key_id:string}>('select * from evidence_documents order by id')).rows;
 for(const d of documents){const key=keys.key(d.key_id);try{verifiedBytes(objects.get('document-evidence/'+d.object_path)??null,key,documentContext(d.user_id,d.file_hash),d.file_hash,d.size_bytes).fill(0);originals++;}finally{key.fill(0)}}
 const cells=(await db.query<{user_id:string;row_number:number;raw_encrypted:string;row_hash:string;account_id:string;file_hash:string;key_id:string}>('select r.user_id,r.row_number,r.raw_encrypted,r.row_hash,f.account_id,f.file_hash,f.key_id from source_rows r join record_imports i on i.id=r.import_id and i.user_id=r.user_id join record_source_files f on f.id=i.source_file_id and f.user_id=i.user_id order by r.id')).rows;
 assert.equal(cells.length,Number((await db.query<{n:number}>('select count(*)::int n from source_rows')).rows[0].n),'Every source row needs its original file');
 for(const r of cells){const key=keys.key(r.key_id);try{const bytes=decryptSource(Buffer.from(r.raw_encrypted,'base64'),key,sourceContext(r.user_id,r.account_id,r.file_hash,r.row_number));try{assert.equal(sourceHash(bytes),r.row_hash);JSON.parse(bytes.toString('utf8'));rows++;}finally{bytes.fill(0)}}finally{key.fill(0)}}
 const labels=(await db.query<{user_id:string;ordinal:number;original_name_encrypted:string;file_hash:string;key_id:string}>('select i.user_id,i.ordinal,i.original_name_encrypted,d.file_hash,k.key_id from document_batch_items i join document_batches b on b.id=i.batch_id and b.user_id=i.user_id join evidence_documents d on d.id=b.root_document_id and d.user_id=b.user_id join document_name_keys k on k.batch_item_id=i.id and k.user_id=i.user_id order by i.id')).rows;
 assert.equal(labels.length,Number((await db.query<{n:number}>('select count(*)::int n from document_batch_items')).rows[0].n),'Every encrypted name needs proven key provenance');
 for(const r of labels){const key=keys.key(r.key_id);try{const bytes=decryptSource(Buffer.from(r.original_name_encrypted,'base64'),key,documentNameContext(r.user_id,r.file_hash,r.ordinal));try{assert.ok(new TextDecoder('utf-8',{fatal:true}).decode(bytes).length>0);names++;}finally{bytes.fill(0)}}finally{key.fill(0)}}
 return{objects:objects.size,originals,source_rows:rows,encrypted_names:names};
}
async function main(){
 const db=new PGlite({extensions:{pgcrypto}});let sourceOpen=true,restored:PGlite|undefined;
 const objects=new Map<string,Buffer>(),sourceKey=randomBytes(32),documentKey=randomBytes(32);
 try{
  await db.exec(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../supabase/migrations/',import.meta.url),migrations=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort();for(const name of migrations)await db.exec(await readFile(new URL(name,dir),'utf8'));
  const owner=randomUUID(),other=randomUUID(),account=randomUUID();await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);await db.query("insert into financial_accounts(id,user_id,label,provider,account_type,currency,masked_identifier) values($1,$2,'Synthetic restore account','generic','bank','GBP','1234')",[account,owner]);
  const upload=async(bucket:string,path:string,bytes:Buffer)=>{assert.ok(!objects.has(bucket+'/'+path));objects.set(bucket+'/'+path,Buffer.from(bytes));await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bucket,path])};
  const csv=await readFile(new URL('../fixtures/synthetic-starling.csv',import.meta.url));
  const source=await persistSourceCsv({owner,account,bytes:csv,filename:'synthetic-starling.csv',mapping:suggestMapping(readSourceCsv(csv.toString())[0],'starling')},sourceKey,'retained-source-v1',{
   async createAttempt(a){await db.query('insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,recovery_plan) values($1,$2,$3,$4,$5,$6,$7,$8)',[a.id,a.user_id,a.account_id,a.file_hash,a.object_path,a.key_id,a.size_bytes,JSON.stringify(a.recovery_plan)])},
   upload:(p,b)=>upload('source-evidence',p,b),
   async transition(id,owner,from,to){await db.query('update source_upload_attempts set state=$1 where id=$2 and user_id=$3 and state=any($4)',[to,id,owner,from])},
   async register(a,rows){return(await db.query<{r:{import_id:string;created:boolean;transactions:number}}>('select ingest_source_csv($1,$2,$3,$4,$5,$6) r',[owner,a.id,a.recovery_plan.filename,a.recovery_plan.parser,JSON.stringify(a.recovery_plan.mapping),JSON.stringify(rows)])).rows[0].r}
  });
  const files=await prepareDocumentIntake('synthetic-invoices.zip',await readFile(new URL('../fixtures/document-evidence/synthetic-invoices.zip',import.meta.url)),'invoice');
  await persistDocumentIntake(owner,files,2025,'invoice',documentKey,'active-document-v2',{
   async createAttempt(a){await db.query('insert into document_upload_attempts(id,user_id,file_hash,planned_objects,recovery_plan) values($1,$2,$3,$4,$5)',[a.id,owner,a.file_hash,JSON.stringify(a.planned_objects),JSON.stringify(a.recovery_plan)])},upload:(p,b)=>upload('document-evidence',p,b),
   async transition(id,owner,from,to){await db.query('update document_upload_attempts set state=$1 where id=$2 and user_id=$3 and state=any($4)',[to,id,owner,from])},
   async register(id,owner,year,purpose){return(await db.query<{r:{batch_id:string;created:boolean;files:number}}>('select register_document_intake($1,$2,$3,$4,$5) r',[owner,id,year,purpose,'opaque-evidence/1'])).rows[0].r}
  });
  const tx=(await db.query<{id:string}>("select id from bank_transactions where import_id=$1 and signed_amount_pence<0 order by id limit 1",[source.import_id])).rows[0].id;
  const category=(await db.query<{id:string}>("select id from record_categories where record_type='expense' and is_default=true order by id limit 1")).rows[0].id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic review before restore')",[tx,category]);
  const before=await databaseDigest(db),keyBackup=JSON.stringify([{id:'retained-source-v1',key:sourceKey.toString('base64')},{id:'active-document-v2',key:documentKey.toString('base64')}]),objectBackup=new Map([...objects].map(([path,bytes])=>[path,Buffer.from(bytes)]));
  const archive=await db.dumpDataDir();await db.close();sourceOpen=false;sourceKey.fill(0);documentKey.fill(0);for(const bytes of objects.values())bytes.fill(0);objects.clear();
  restored=new PGlite({loadDataDir:archive,extensions:{pgcrypto}});const after=await databaseDigest(restored);assert.deepEqual(after,before);
  const keys=parseEvidenceKeyring({VIBECOUNT_SOURCE_KEY_ID:'active-document-v2',VIBECOUNT_SOURCE_ENCRYPTION_KEYS:keyBackup});const verified=await verify(restored,objectBackup,keys);
  const missing=new Map(objectBackup);missing.delete(missing.keys().next().value!);await assert.rejects(verify(restored,missing,keys),/inventory/);
  const corrupt=new Map(objectBackup),path=corrupt.keys().next().value!,damaged=Buffer.from(corrupt.get(path)!);damaged[damaged.length-1]^=1;corrupt.set(path,damaged);await assert.rejects(verify(restored,corrupt,keys),/authentication/);
  const onlyActive=parseEvidenceKeyring({VIBECOUNT_SOURCE_KEY_ID:'active-document-v2',VIBECOUNT_SOURCE_ENCRYPTION_KEYS:JSON.stringify(JSON.parse(keyBackup).slice(1))});await assert.rejects(verify(restored,objectBackup,onlyActive),/recorded evidence key/);
  await restored.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await restored.exec('set role authenticated');assert.equal(Number((await restored.query<{n:number}>('select count(*)::int n from bank_transactions')).rows[0].n),8);await assert.rejects(restored.query('select object_path,key_id from evidence_documents'),/permission denied/);await assert.rejects(restored.query('select * from record_source_files'),/permission denied/);
  await restored.exec('reset role');await restored.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);await restored.exec('set role authenticated');assert.equal(Number((await restored.query<{n:number}>('select count(*)::int n from bank_transactions')).rows[0].n),0);await restored.exec('reset role');
  assert.deepEqual(await databaseDigest(restored),after);assert.equal(Number((await restored.query<{n:number}>("select count(*)::int n from financial_records where status='approved'")).rows[0].n),1);
  const output=resolve(process.argv[2]??'/tmp/vibecount-evidence-restore');await mkdir(output,{recursive:true});await writeFile(resolve(output,'report.json'),JSON.stringify({synthetic_only:true,migrations:migrations.length,database:after,...verified,retained_keys:2,approved_records_preserved:1,missing_object_rejected:true,corrupt_object_rejected:true,missing_retained_key_rejected:true,verification_made_no_database_changes:true,restored_owner_isolation_verified:true,hosted_restore:false},null,2));console.log('PASS: isolated database/object/key restore verified; report: '+resolve(output,'report.json'));
 }finally{sourceKey.fill(0);documentKey.fill(0);if(sourceOpen)await db.close();await restored?.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});

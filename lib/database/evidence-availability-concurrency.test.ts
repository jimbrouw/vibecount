import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {randomBytes,randomUUID} from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import {TEST_SCHEMA_BOOTSTRAP} from './test-schema';
import {bankValuationFixture,openSyntheticForeignAdmission} from './bank-valuation-fixture';
test('evidence deletion serializes with original authorization and availability freezes',{timeout:30000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'vibecount-evidence-pg-'));
 const port=await new Promise<number>((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const a=s.address();if(!a||typeof a==='string'){s.close();reject(new Error('No test port'));return}s.close(()=>resolve(a.port))})});
 const cluster=new EmbeddedPostgres({databaseDir:join(directory,'data'),port,user:'postgres',password:randomBytes(24).toString('hex'),persistent:false,createPostgresUser:false,postgresFlags:['-c','listen_addresses=127.0.0.1','-c',`unix_socket_directories=${directory}`],onLog:()=>{},onError:()=>{}});
 let started=false;const clients:ReturnType<typeof cluster.getPgClient>[]=[];
 t.after(async()=>{for(const c of clients)await c.end().catch(()=>{});if(started)await cluster.stop();await rm(directory,{recursive:true,force:true})});
 await cluster.initialise();await cluster.start();started=true;
 const admin=cluster.getPgClient('postgres','127.0.0.1'),first=cluster.getPgClient('postgres','127.0.0.1'),second=cluster.getPgClient('postgres','127.0.0.1');clients.push(admin,first,second);await Promise.all(clients.map(c=>c.connect()));
 await admin.query(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../../supabase/migrations/',import.meta.url);for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await admin.query(await readFile(new URL(name,dir),'utf8'));

 const owner=randomUUID(),doc=randomUUID(),path=`${owner}/${randomUUID()}/0.enc`,hash='a'.repeat(64);
 await admin.query('insert into auth.users(id) values($1)',[owner]);
 await admin.query("insert into evidence_documents(id,user_id,file_hash,media_type,size_bytes,object_path,key_id) values($1,$2,$3,'application/pdf',100,$4,'synthetic')",[doc,owner,hash,path]);
 await admin.query("insert into storage.objects(bucket_id,name) values('document-evidence',$1)",[path]);
 for(const c of [first,second])await c.query("set statement_timeout='8s'");
 const target=()=>second.query("insert into evidence_deletion_targets(user_id,request_id,bucket_id,object_path,file_hash) values($1,$2,'document-evidence',$3,$4)",[owner,randomUUID(),path,hash]);
 const waitForLock=async(pid:number)=>{
  for(let n=0;n<500;n++){const state=(await admin.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0];if(state?.wait_event_type==='Lock')return;await new Promise(resolve=>setTimeout(resolve,5))}
  assert.fail('Expected a database lock wait');
 };
 const secondPid=(await second.query('select pg_backend_pid() pid')).rows[0].pid;
 async function waitThenTarget(release:string){
  await second.query('begin');const pending=target();await waitForLock(secondPid);
  await first.query(release);await pending;await second.query('rollback');
 }
 // Existing readers must complete before a target can become durable.
 await first.query('begin;lock table public.available_evidence_objects in share mode');
 await waitThenTarget('rollback');
 await first.query('begin');await first.query("select * from storage.objects where name=$1 for share",[path]);
 await assert.rejects(target(),/could not obtain lock/);await first.query('rollback');
 // A committed audit holds its freeze until transaction completion.
 await first.query('begin;set local role service_role');
 const audit='insert into document_original_access(user_id,document_id,file_hash,size_bytes) values($1,$2,$3,100)';
 await first.query(audit,[owner,doc,hash]);await waitThenTarget('commit');
 // In reverse order, final authorization waits, then observes the committed target.
 await second.query('begin');await target();
 const pid=(await first.query('select pg_backend_pid() pid')).rows[0].pid;
 const pending=first.query(audit,[owner,doc,hash]).then(()=>null,error=>error);
 await waitForLock(pid);await second.query('commit');
 assert.match(String(await pending),/Original evidence unavailable/);
 assert.equal((await admin.query('select count(*)::int n from document_original_access')).rows[0].n,1);
 assert.equal((await admin.query('select count(*)::int n from storage.objects')).rows[0].n,1);
 // Financial approval uses the same target boundary; retained approvals can
 // still be excluded after the boundary without rewriting original evidence.
 const fixtureDb={exec:(sql:string)=>admin.query(sql),query:async<T>(sql:string,params?:unknown[])=>({rows:(await admin.query(sql,params)).rows as T[]})};
 await openSyntheticForeignAdmission(fixtureDb);const f=await bankValuationFixture(fixtureDb);t.after(()=>f.key.fill(0));
 const record=(await admin.query("insert into financial_records(user_id,import_id,record_type,record_date,description,amount,status) values($1,$2,'expense','2026-04-05','Synthetic',1,'draft') returning id",[f.owner,f.imported])).rows[0].id;
 const sourceTarget=()=>second.query("insert into evidence_deletion_targets(user_id,request_id,bucket_id,object_path,file_hash) values($1,$2,'source-evidence',$3,$4)",[f.owner,randomUUID(),f.path,f.hash]);
 await first.query('begin');await first.query("update financial_records set status='approved' where id=$1",[record]);
 await second.query('begin');const marking=sourceTarget();await waitForLock(secondPid);
 await first.query('commit');await marking;await second.query('rollback');
 await second.query('begin');await sourceTarget();
 const approval=first.query("update financial_records set amount=2 where id=$1",[record]).then(()=>null,error=>error);
 await waitForLock(pid);await second.query('commit');assert.match(String(await approval),/marked for deletion/);
 assert.equal((await admin.query('select amount::text a from financial_records where id=$1',[record])).rows[0].a,'1.00');
 await first.query("update financial_records set status='excluded' where id=$1",[record]);

 // Upload admission and target insertion share the same durable boundary.
 const uploadFixture=await bankValuationFixture(fixtureDb);t.after(()=>uploadFixture.key.fill(0));
 const uploadAttempt=(await admin.query('select id from document_upload_attempts where user_id=$1',[uploadFixture.owner])).rows[0].id,operation=randomUUID();
 const beginUpload=()=>first.query("select begin_evidence_upload($1,'document',$2,$3,$4)",[uploadFixture.owner,uploadAttempt,uploadFixture.documentPath,operation]);
 const targetUpload=()=>second.query("insert into evidence_deletion_targets(user_id,request_id,bucket_id,object_path,file_hash) values($1,$2,'document-evidence',$3,$4)",[uploadFixture.owner,randomUUID(),uploadFixture.documentPath,uploadFixture.documentHash]);
 await first.query('begin');await beginUpload();
 const pendingTarget=targetUpload().then(()=>null,error=>error);await waitForLock(secondPid);await first.query('commit');
 assert.match(String(await pendingTarget),/upload outcome is unresolved/);
 await admin.query('select completed_evidence_upload($1,$2)',[uploadFixture.owner,operation]);
 await second.query('begin');await targetUpload();
 const pendingUpload=beginUpload().then(()=>null,error=>error);await waitForLock(pid);await second.query('commit');
 assert.match(String(await pendingUpload),/marked for deletion/);

 // The request boundary freezes direct financial writers, not just cooperating RPCs.
 const requestFixture=await bankValuationFixture(fixtureDb);t.after(()=>requestFixture.key.fill(0));
 const draft=(await admin.query("insert into financial_records(user_id,record_type,record_date,description,amount,status) values($1,'expense','2026-04-05','Synthetic dependency',1,'draft') returning id",[requestFixture.owner])).rows[0].id;
 for(const c of [admin,second])await c.query("select set_config('request.jwt.claim.sub',$1,false)",[requestFixture.owner]);
 const readReview=async()=>(await admin.query("select review_evidence_deletion('source',$1) r",[requestFixture.imported])).rows[0].r;
 const expected=await readReview(),requestId=randomUUID();
 const requestSql="select record_evidence_deletion_request('source',$1,$2,$3,'evidence-deletion/1','Synthetic concurrency request',$4,true)";
 const requestArgs=(r:{inventory_sha256:string;review_sha256:string})=>[requestFixture.imported,r.inventory_sha256,r.review_sha256,requestId];
 await first.query('begin');await first.query('update financial_records set amount=2 where id=$1',[draft]);
 await assert.rejects(second.query(requestSql,requestArgs(expected)),/could not obtain lock/);
 await first.query('commit');await assert.rejects(second.query(requestSql,requestArgs(expected)),/dependencies changed/);
 await second.query(requestSql,requestArgs(await readReview()));

});

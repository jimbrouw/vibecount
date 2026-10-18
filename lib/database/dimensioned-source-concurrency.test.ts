import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { openSyntheticForeignAdmission, type BankValuationDb } from './bank-valuation-fixture';
import { dimensionedSourcePlan, prepareDimensionedSourceRows } from '../records/source-persistence-v2';
import { readSourceCsv, suggestMapping } from '../records/source-csv';
import { sourceHash } from '../records/source-crypto';

test('native PostgreSQL serializes foreign same-file and overlapping imports', {timeout:30000}, async t=>{
 const directory=await mkdtemp(join(tmpdir(),'vibecount-foreign-import-pg-'));
 const port=await new Promise<number>((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const a=s.address();if(!a||typeof a==='string'){s.close();reject(new Error('No test port'));return;}s.close(()=>resolve(a.port));});});
 const cluster=new EmbeddedPostgres({databaseDir:join(directory,'data'),port,user:'postgres',password:randomBytes(24).toString('hex'),persistent:false,createPostgresUser:false,
  postgresFlags:['-c','listen_addresses=127.0.0.1','-c',`unix_socket_directories=${directory}`],onLog:()=>{},onError:()=>{}});
 let started=false;const clients:ReturnType<typeof cluster.getPgClient>[]=[];
 t.after(async()=>{for(const c of clients)await c.end().catch(()=>{});if(started)await cluster.stop();await rm(directory,{recursive:true,force:true});});
 await cluster.initialise();await cluster.start();started=true;
 const admin=cluster.getPgClient('postgres','127.0.0.1'),first=cluster.getPgClient('postgres','127.0.0.1'),second=cluster.getPgClient('postgres','127.0.0.1');clients.push(admin,first,second);
 await Promise.all(clients.map(c=>c.connect()));await admin.query(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url);for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await admin.query(await readFile(new URL(name,dir),'utf8'));
 function adapt(c:typeof admin):BankValuationDb{return{exec:sql=>c.query(sql),query:async<T>(sql:string,params?:unknown[])=>({rows:(await c.query(sql,params)).rows as T[]})};}
 await openSyntheticForeignAdmission(adapt(admin));const pid=(await second.query('select pg_backend_pid() pid')).rows[0].pid;
 for(const c of clients)await c.query("set statement_timeout='8s'");
 async function waitLock(kind?:string,target=pid){const deadline=Date.now()+5000;while(Date.now()<deadline){const r=(await admin.query('select wait_event_type,wait_event from pg_stat_activity where pid=$1',[target])).rows[0];if(r?.wait_event_type==='Lock'&&(!kind||r.wait_event===kind))return;await new Promise(r=>setTimeout(r,5));}throw new Error('Expected actual independent-connection lock wait.');}

 const owner=randomUUID();await admin.query('insert into auth.users(id) values($1)',[owner]);
 const csv='Date,Description,Amount,Currency\n05/04/2026,Purchase,-10.001,KWD\n05/04/2026,Purchase,-10.001,KWD';
 async function attempt(account:string,text:string){
  const id=randomUUID(),bytes=Buffer.from(text),hash=sourceHash(bytes),path=`${owner}/${account}/${id}.enc`;
  const mapping=suggestMapping(readSourceCsv(text)[0],'generic'),{plan,rows}=dimensionedSourcePlan(bytes,mapping,'synthetic.csv','KWD');
  const prepared=prepareDimensionedSourceRows(owner,account,hash,mapping,rows,randomBytes(32));
  await admin.query("insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,recovery_plan,state) values($1,$2,$3,$4,$5,'synthetic',$6,$7,'uploaded')",[id,owner,account,hash,path,bytes.length,JSON.stringify(plan)]);
  await admin.query("insert into storage.objects(bucket_id,name) values('source-evidence',$1)",[path]);
  return[owner,id,plan.filename,plan.parser,JSON.stringify(mapping),JSON.stringify(prepared)];
 }
 for(const scenario of ['same-file','overlap-forward','overlap-reverse']){
  const account=randomUUID();await admin.query("insert into financial_accounts(id,user_id,label,provider,account_type,currency,masked_identifier) values($1,$2,'Synthetic','generic','bank','KWD','1234')",[account,owner]);
  const extended=csv+'\n06/04/2026,Other purchase,-2.001,KWD';
  const a=await attempt(account,scenario==='overlap-reverse'?extended:csv),b=await attempt(account,scenario==='same-file'||scenario==='overlap-reverse'?csv:extended);
  const sql='select ingest_source_csv($1,$2,$3,$4,$5,$6) r';
  await first.query('begin');const original=(await first.query(sql,a)).rows[0].r;
  const pending=second.query(sql,b);pending.catch(()=>{});
  try{await waitLock('advisory');}finally{await first.query('commit');}
  const later=(await pending).rows[0].r;
  if(scenario==='same-file')assert.deepEqual(later,{import_id:original.import_id,created:false,transactions:0});
  else{
   assert.equal(later.created,true);
   assert.equal((await admin.query("select count(*)::int n from bank_transactions where import_id=$1 and dedupe_status='needs_review'",[later.import_id])).rows[0].n,2);
  }
  assert.equal((await admin.query("select count(*)::int n from bank_transactions where import_id=$1 and dedupe_status='clear'",[original.import_id])).rows[0].n,scenario==='overlap-reverse'?3:2);
  assert.equal((await admin.query('select count(*)::int n from bank_transactions where account_id=$1',[account])).rows[0].n,scenario==='same-file'?2:5);
 }
 assert.equal((await admin.query('select count(*)::int n from financial_records where user_id=$1',[owner])).rows[0].n,0);
});

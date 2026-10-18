import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { bankValuationFixture, openSyntheticForeignAdmission, type BankValuationDb } from './bank-valuation-fixture';
import { serialSubtest } from './serial-subtest';

test('native PostgreSQL serializes private valuation history and freezes actual source mutations', {timeout:30000}, async t=>{
 const directory=await mkdtemp(join(tmpdir(),'vibecount-bank-valuation-pg-'));
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
 await openSyntheticForeignAdmission(adapt(admin));const pid=(await second.query('select pg_backend_pid() pid')).rows[0].pid,firstPid=(await first.query('select pg_backend_pid() pid')).rows[0].pid;
 for(const c of clients)await c.query("set statement_timeout='8s'");
 async function waitLock(kind?:string,target=pid){const deadline=Date.now()+5000;while(Date.now()<deadline){const r=(await admin.query('select wait_event_type,wait_event from pg_stat_activity where pid=$1',[target])).rows[0];if(r?.wait_event_type==='Lock'&&(!kind||r.wait_event===kind))return;await new Promise(r=>setTimeout(r,5));}throw new Error('Expected actual independent-connection lock wait.');}
 await serialSubtest(t,'same request waits on owner lock then returns exact committed revision once',async()=>{
  const f=await bankValuationFixture(adapt(admin)),intent=await f.intent();await first.query('begin');
  const original=(await first.query('select record_bank_valuation($1,$2) r',[f.owner,JSON.stringify(intent)])).rows[0].r;
  const pending=second.query('select record_bank_valuation($1,$2) r',[f.owner,JSON.stringify(intent)]);await waitLock('advisory');await first.query('commit');
  assert.deepEqual((await pending).rows[0].r,original);assert.equal((await admin.query('select count(*)::int n from bank_valuation_revisions where user_id=$1',[f.owner])).rows[0].n,1);
 });
 await serialSubtest(t,'valuation first blocks actual object deletion; historical retry survives deletion after commit',async()=>{
  const f=await bankValuationFixture(adapt(admin)),intent=await f.intent();await first.query('begin');
  const original=(await first.query('select record_bank_valuation($1,$2) r',[f.owner,JSON.stringify(intent)])).rows[0].r;
  const pending=second.query("delete from storage.objects where bucket_id='source-evidence' and name=$1 returning id",[f.path]);await waitLock();await first.query('commit');assert.equal((await pending).rowCount,1);
  assert.deepEqual(await f.record(intent),original);assert.equal((await admin.query('select bank_valuation_source_current($1,$2) r',[f.owner,original.id])).rows[0].r,false);
 });
 await serialSubtest(t,'object deletion first reaches writer lock; NOWAIT rejects without history then retry after rollback succeeds',async()=>{
  const f=await bankValuationFixture(adapt(admin)),intent=await f.intent();await second.query('begin');
  assert.equal((await second.query("delete from storage.objects where bucket_id='document-evidence' and name=$1 returning id",[f.documentPath])).rowCount,1);
  try{await assert.rejects(first.query('select record_bank_valuation($1,$2)',[f.owner,JSON.stringify(intent)]),(e:unknown)=>(e as {code?:string}).code==='55P03');}
  finally{await second.query('rollback');}
  assert.equal((await admin.query('select count(*)::int n from bank_valuation_requests where user_id=$1',[f.owner])).rows[0].n,0);await f.record(intent);
 });
 await serialSubtest(t,'decision change in either order is serialized and an old decision preview cannot persist',async()=>{
  const f=await bankValuationFixture(adapt(admin)),intent=await f.intent();await second.query('begin');
  for(const c of [first,second])await c.query("select set_config('request.jwt.claim.sub',$1,false)",[f.owner]);
  const decision=async(version:number,classification:string)=>({schema_version:'foreign-classification-intent/1',transaction_id:f.transaction,transaction_version:version,valuation_revision_id:null,classification,category_id:null,business_use_bps:0,rounding_policy:'gbp_business_share_half_up/1',treatment_reviewed:false,expected_stamp:(await admin.query('select foreign_classification_review_stamp($1) s',[f.owner])).rows[0].s,rationale:'Synthetic classification concurrency',request_id:randomUUID(),human_confirmed:true});
  await second.query('select review_foreign_classification($1)',[JSON.stringify(await decision(0,'Personal'))]);
  // The existing source-update guard cooperates on the owner lock before table freezes.
  const waiting=first.query('select record_bank_valuation($1,$2)',[f.owner,JSON.stringify(intent)]);
  const rejection=assert.rejects(waiting,/changed/);await waitLock('advisory',firstPid);await second.query('commit');await rejection;
  await assert.rejects(f.record(intent),/changed/);
  const fresh=await f.intent({transaction_version:1});await first.query('begin');
  const saved=(await first.query('select record_bank_valuation($1,$2) r',[f.owner,JSON.stringify(fresh)])).rows[0].r;
  const pending=second.query('select review_foreign_classification($1)',[JSON.stringify(await decision(1,'Unknown'))]);const stale=assert.rejects(pending,/review changed/);await waitLock();await first.query('commit');await stale;
  await second.query('select review_foreign_classification($1)',[JSON.stringify(await decision(1,'Unknown'))]);
  assert.equal((await admin.query('select bank_valuation_source_current($1,$2) r',[f.owner,saved.id])).rows[0].r,true);
 });
 await serialSubtest(t,'authenticated valuation retries wait on the owner lock and recover one exact revision',async()=>{
  const f=await bankValuationFixture(adapt(admin)),intent=await f.intent();
  for(const c of [first,second]){await c.query("select set_config('request.jwt.claim.sub',$1,false)",[f.owner]);await c.query('set role authenticated');}
  await first.query('begin');
  const sql='select review_bank_valuation($1,$2) r',args=[JSON.stringify(intent),f.documentHash];
  const saved=(await first.query(sql,args)).rows[0].r;
  const pending=second.query(sql,args);pending.catch(()=>{});
  try{await waitLock('advisory');}finally{await first.query('commit');}
  assert.deepEqual((await pending).rows[0].r,saved);
  assert.equal((await admin.query('select count(*)::int n from bank_valuation_requests where user_id=$1',[f.owner])).rows[0].n,1);
  assert.equal((await admin.query('select count(*)::int n from financial_records where user_id=$1',[f.owner])).rows[0].n,0);
  for(const c of [first,second])await c.query('reset role');
 });
 await serialSubtest(t,'concurrent foreign classification retries create one canonical posting and decision',async()=>{
  const f=await bankValuationFixture(adapt(admin)),valuation=await f.record(await f.intent()) as {id:string};
  const category=(await admin.query("select id from record_categories where record_type='expense' and is_default limit 1")).rows[0].id;
  const intent={schema_version:'foreign-classification-intent/1',transaction_id:f.transaction,transaction_version:0,valuation_revision_id:valuation.id,classification:'Business',category_id:category,business_use_bps:10000,rounding_policy:'gbp_business_share_half_up/1',treatment_reviewed:true,expected_stamp:(await admin.query('select foreign_classification_review_stamp($1) s',[f.owner])).rows[0].s,rationale:'Synthetic separate review',request_id:randomUUID(),human_confirmed:true};
  for(const c of [first,second])await c.query("select set_config('request.jwt.claim.sub',$1,false)",[f.owner]);
  await first.query('begin');const sql='select review_foreign_classification($1) r',args=[JSON.stringify(intent)];
  const saved=(await first.query(sql,args)).rows[0].r,pending=second.query(sql,args);pending.catch(()=>{});
  try{await waitLock('advisory');}finally{await first.query('commit');}
  assert.deepEqual((await pending).rows[0].r,saved);
  assert.equal((await admin.query('select count(*)::int n from classification_decisions where user_id=$1',[f.owner])).rows[0].n,1);
  assert.equal((await admin.query('select count(*)::int n from financial_records where user_id=$1',[f.owner])).rows[0].n,1);
 });
 for(const order of ['classification-first','reversal-first','same-reversal'])await serialSubtest(t,'foreign import reversal serializes '+order,async()=>{
  const f=await bankValuationFixture(adapt(admin));
  for(const c of clients)await c.query("select set_config('request.jwt.claim.sub',$1,false)",[f.owner]);
  const context=(await admin.query('select read_foreign_import_reversal($1) r',[f.imported])).rows[0].r;
  const intent={schema_version:'foreign-classification-intent/1',transaction_id:f.transaction,transaction_version:0,valuation_revision_id:null,classification:'Personal',category_id:null,business_use_bps:0,rounding_policy:'gbp_business_share_half_up/1',treatment_reviewed:false,expected_stamp:(await admin.query('select foreign_classification_review_stamp($1) s',[f.owner])).rows[0].s,rationale:'Synthetic concurrent exclusion',request_id:randomUUID(),human_confirmed:true};
  const reverseSql='select reverse_foreign_import_reviewed($1,$2,$3,$4) r',args=[f.imported,context.stamp,'Reviewed complete import',randomUUID()];
  const classifySql='select confirm_foreign_classification($1) r',classifyArgs=[JSON.stringify(intent)];
  for(const c of [first,second])await c.query('set role authenticated');
  await first.query('begin');const saved=await first.query(order==='classification-first'?classifySql:reverseSql,order==='classification-first'?classifyArgs:args);
  const pending=second.query(order==='reversal-first'?classifySql:reverseSql,order==='reversal-first'?classifyArgs:args);pending.catch(()=>{});
  const expected=order==='same-reversal'?pending:assert.rejects(pending,/review changed/);
  try{await waitLock('advisory');}finally{await first.query('commit');}
  const result=await expected;
  if(order==='same-reversal')assert.deepEqual((result as {rows:unknown[]}).rows,saved.rows);
  assert.equal((await admin.query("select count(*)::int n from source_import_events where import_id=$1 and event='reversed'",[f.imported])).rows[0].n,order==='classification-first'?0:1);
  for(const c of [first,second])await c.query('reset role');
 });

});

import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {randomBytes,randomUUID} from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import type {PGlite} from '@electric-sql/pglite';
import {TEST_SCHEMA_BOOTSTRAP} from './test-schema';
import {serialSubtest} from './serial-subtest';
import {bankValuationFixture,openSyntheticForeignAdmission,type BankValuationDb} from './bank-valuation-fixture';
import {nativeBalanceFixture} from './native-balance-fixture';

test('native operational capture freezes actual source and valuation mutations and serializes invoice balance changes',{timeout:30000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'vibecount-operational-pg-'));
 const port=await new Promise<number>((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const a=s.address();if(!a||typeof a==='string'){s.close();reject(new Error('No test port'));return}s.close(()=>resolve(a.port))})});
 const cluster=new EmbeddedPostgres({databaseDir:join(directory,'data'),port,user:'postgres',password:randomBytes(24).toString('hex'),persistent:false,createPostgresUser:false,postgresFlags:['-c','listen_addresses=127.0.0.1','-c',`unix_socket_directories=${directory}`],onLog:()=>{},onError:()=>{}});
 let started=false;const clients:ReturnType<typeof cluster.getPgClient>[]=[];
 t.after(async()=>{for(const c of clients)await c.end().catch(()=>{});if(started)await cluster.stop();await rm(directory,{recursive:true,force:true})});
 await cluster.initialise();await cluster.start();started=true;
 const admin=cluster.getPgClient('postgres','127.0.0.1'),first=cluster.getPgClient('postgres','127.0.0.1'),second=cluster.getPgClient('postgres','127.0.0.1');clients.push(admin,first,second);await Promise.all(clients.map(c=>c.connect()));
 await admin.query(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../../supabase/migrations/',import.meta.url);for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await admin.query(await readFile(new URL(name,dir),'utf8'));
 const adapt=(c:typeof admin):BankValuationDb=>({exec:sql=>c.query(sql),query:async<T>(sql:string,params?:unknown[])=>({rows:(await c.query(sql,params)).rows as T[]})});
 await openSyntheticForeignAdmission(adapt(admin));for(const c of clients)await c.query("set statement_timeout='8s'");
 const pids=await Promise.all([first,second].map(async c=>(await c.query('select pg_backend_pid() pid')).rows[0].pid));
 const waitLock=async(target:number,kind?:string)=>{const until=Date.now()+5000;while(Date.now()<until){const r=(await admin.query('select wait_event_type,wait_event from pg_stat_activity where pid=$1',[target])).rows[0];if(r?.wait_event_type==='Lock'&&(!kind||r.wait_event===kind))return;await new Promise(r=>setTimeout(r,5))}throw new Error('Expected independent connection lock wait')};
 const capture=async(c:typeof admin,owner:string,year=2025)=>{await c.query('set role service_role');try{return(await c.query('select capture_quarter_readiness($1,$2,4,$3::date) r',[owner,year,`${year+1}-04-05`])).rows[0].r}finally{await c.query('reset role')}};
 const stamp=async(owner:string)=>(await admin.query("select financial_review_catalog($1,2025,'2026-04-05')->>'stamp' s",[owner])).rows[0].s;
 const savedStamp=async(owner:string)=>(await admin.query('select source_stamp s from quarterly_readiness_checks where user_id=$1',[owner])).rows[0]?.s;
 await serialSubtest(t,'capture first blocks actual source-object deletion until commit; later loss invalidates the check stamp',async()=>{
  const f=await bankValuationFixture(adapt(admin));await first.query('begin');await capture(first,f.owner);
  const before=await stamp(f.owner),pending=second.query("delete from storage.objects where bucket_id='source-evidence' and name=$1 returning id",[f.path]);await waitLock(pids[1]);await first.query('commit');assert.equal((await pending).rowCount,1);assert.equal(await savedStamp(f.owner),before);assert.notEqual(await stamp(f.owner),before);
 });
 await serialSubtest(t,'source deletion first makes capture NOWAIT fail without saving any optimistic check',async()=>{
  const f=await bankValuationFixture(adapt(admin));await second.query('begin');await second.query("delete from storage.objects where bucket_id='document-evidence' and name=$1 returning id",[f.documentPath]);
  try{await assert.rejects(capture(first,f.owner),(e:unknown)=>(e as {code?:string}).code==='55P03')}finally{await second.query('rollback')}
  assert.equal(await savedStamp(f.owner),undefined);await capture(first,f.owner);assert.equal(await savedStamp(f.owner),await stamp(f.owner));
 });
 await serialSubtest(t,'valuation first makes capture wait on the owner then save the committed new head',async()=>{
  const f=await bankValuationFixture(adapt(admin)),intent=await f.intent();await first.query('begin');await first.query('select record_bank_valuation($1,$2)',[f.owner,JSON.stringify(intent)]);
  const pending=capture(second,f.owner);await waitLock(pids[1],'advisory');await first.query('commit');await pending;assert.equal(await savedStamp(f.owner),await stamp(f.owner));
 });
 await serialSubtest(t,'capture first retains its head while the later valuation invalidates currentness after commit',async()=>{
  const f=await bankValuationFixture(adapt(admin)),intent=await f.intent(),before=await stamp(f.owner);await first.query('begin');await capture(first,f.owner);
  const pending=second.query('select record_bank_valuation($1,$2)',[f.owner,JSON.stringify(intent)]);await waitLock(pids[1],'advisory');await first.query('commit');await pending;assert.equal(await savedStamp(f.owner),before);assert.notEqual(await stamp(f.owner),before);
 });
 await serialSubtest(t,'reviewed native credit reversal waits behind capture and then changes the invoice-bound source stamp',async()=>{
  const f=await nativeBalanceFixture(adapt(admin) as unknown as PGlite);await admin.query('reset role');
  const invoice=f.ids.credited,credit=f.credits[1].args[1];await second.query("select set_config('request.jwt.claim.sub',$1,false)",[f.owner]);await second.query('set role authenticated');
  const balance=(await second.query('select invoice_balance_stamp($1) s',[invoice])).rows[0].s;
  await first.query('begin');await capture(first,f.owner,2026);const before=(await admin.query("select financial_review_catalog($1,2026,'2027-04-05')->>'stamp' s",[f.owner])).rows[0].s;
  const pending=second.query("select reverse_invoice_credit($1,$2,'Synthetic reviewed reversal',$3)",[credit,balance,randomUUID()]);await waitLock(pids[1],'advisory');await first.query('commit');await pending;await second.query('reset role');
  assert.equal(await savedStamp(f.owner),before);assert.notEqual((await admin.query("select financial_review_catalog($1,2026,'2027-04-05')->>'stamp' s",[f.owner])).rows[0].s,before);
 });
});

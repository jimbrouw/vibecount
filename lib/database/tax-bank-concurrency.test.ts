import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {randomBytes,randomUUID} from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import {TEST_SCHEMA_BOOTSTRAP} from './test-schema';
import {serialSubtest} from './serial-subtest';
import {bankValuationFixture,openSyntheticForeignAdmission,type BankValuationDb} from './bank-valuation-fixture';
import {prepareCalculation} from '../tax/snapshot';
import type {CalculationInput} from '../tax/calculation';

test('native tax capture freezes complete source scope while historical retries and independent owners remain safe',{timeout:30000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'vibecount-tax-bank-pg-'));
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
 const prepare=async(owner:string)=>prepareCalculation((await admin.query('select tax_calculation_input_for_owner($1,2025) r',[owner])).rows[0].r as CalculationInput);
 const capture=async(c:typeof admin,owner:string,p:ReturnType<typeof prepareCalculation>,request=randomUUID())=>{
  const args=[owner,2025,p.inputJson,p.resultJson,p.rulesJson,'Synthetic bank source capture',request];await c.query('set role service_role');try{return{id:(await c.query('select capture_tax_calculation($1,$2,$3,$4,$5,$6,$7) r',args)).rows[0].r,args}}finally{await c.query('reset role')}
 };
 await serialSubtest(t,'tax capture first blocks actual source deletion; exact retained retry recovers after loss',async()=>{
  const f=await bankValuationFixture(adapt(admin)),p=await prepare(f.owner);await first.query('begin');const saved=await capture(first,f.owner,p);
  const pending=second.query("delete from storage.objects where bucket_id='source-evidence' and name=$1 returning id",[f.path]);await waitLock(pids[1]);await first.query('commit');assert.equal((await pending).rowCount,1);assert.notEqual((await prepare(f.owner)).inputHash,p.inputHash);
  await first.query('set role service_role');assert.equal((await first.query('select capture_tax_calculation($1,$2,$3,$4,$5,$6,$7) r',saved.args)).rows[0].r,saved.id);await first.query('reset role');
 });
 await serialSubtest(t,'actual source deletion first rejects capture NOWAIT without a saved result',async()=>{
  const f=await bankValuationFixture(adapt(admin)),p=await prepare(f.owner);await second.query('begin');await second.query("delete from storage.objects where bucket_id='source-evidence' and name=$1",[f.path]);
  try{await assert.rejects(capture(first,f.owner,p),(e:unknown)=>(e as {code?:string}).code==='55P03')}finally{await second.query('rollback')}
  assert.equal((await admin.query('select count(*)::int n from tax_calculations where user_id=$1',[f.owner])).rows[0].n,0);await capture(first,f.owner,p);
 });
 await serialSubtest(t,'valuation first serializes capture and rejects the old preview; a fresh review captures the committed head',async()=>{
  const f=await bankValuationFixture(adapt(admin)),p=await prepare(f.owner),intent=await f.intent();await first.query('begin');await first.query('select record_bank_valuation($1,$2)',[f.owner,JSON.stringify(intent)]);
  const rejected=assert.rejects(capture(second,f.owner,p),/inputs changed/);await waitLock(pids[1],'advisory');await first.query('commit');await rejected;await capture(second,f.owner,await prepare(f.owner));
 });
 await serialSubtest(t,'capture first retains a stable input while later valuation changes invalidate its currentness',async()=>{
  const f=await bankValuationFixture(adapt(admin)),p=await prepare(f.owner),intent=await f.intent();await first.query('begin');const saved=await capture(first,f.owner,p);
  const pending=second.query('select record_bank_valuation($1,$2)',[f.owner,JSON.stringify(intent)]);await waitLock(pids[1],'advisory');await first.query('commit');await pending;
  assert.equal((await admin.query('select input_sha256 h from tax_calculations where id=$1',[saved.id])).rows[0].h,p.inputHash);assert.notEqual((await prepare(f.owner)).inputHash,p.inputHash);
 });
 await serialSubtest(t,'each added dependency lock blocks phantom writes before capture; failed captures create no history',async()=>{
  const f=await bankValuationFixture(adapt(admin)),p=await prepare(f.owner);
  for(const table of ['record_source_files','source_rows','tax_fact_sources','tax_section_attestations','tax_calculation_scopes','bank_valuation_families','bank_valuation_revisions','fx_document_fact_revisions','invoice_refund_assignment_reversals','merchant_review_items']){
   await second.query('begin');await second.query('lock table public.'+table+' in row exclusive mode');
   try{await assert.rejects(capture(first,f.owner,p),(e:unknown)=>(e as {code?:string}).code==='55P03',table)}finally{await second.query('rollback')}
  }
  assert.equal((await admin.query('select count(*)::int n from tax_calculations where user_id=$1',[f.owner])).rows[0].n,0);
 });
 await serialSubtest(t,'two owners can capture under shared input freezes without destination-table lock upgrades',async()=>{
  const a=await bankValuationFixture(adapt(admin)),b=await bankValuationFixture(adapt(admin)),pa=await prepare(a.owner),pb=await prepare(b.owner);
  await first.query('begin');await capture(first,a.owner,pa);await second.query('begin');await capture(second,b.owner,pb);await first.query('commit');await second.query('commit');
  assert.equal((await admin.query('select count(*)::int n from tax_calculations where user_id=any($1::uuid[])',[[a.owner,b.owner]])).rows[0].n,2);
 });
});

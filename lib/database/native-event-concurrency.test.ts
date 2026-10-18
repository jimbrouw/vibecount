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
import {openSyntheticForeignAdmission,type BankValuationDb} from './bank-valuation-fixture';
import {nativeBalanceFixture} from './native-balance-fixture';

test('native event source locks serialize account changes and preserve exact historical recovery',{timeout:30000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'vibecount-native-event-pg-'));
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
 const fixture=async()=>{const f=await nativeBalanceFixture(adapt(admin));await admin.query('reset role');const allocation=(await admin.query('select id from active_invoice_allocations where invoice_id=$1',[f.ids.partial])).rows[0].id,account=(await admin.query('select account_id from bank_transactions where id=$1',[f.receipt])).rows[0].account_id;return{...f,allocation,account}};
 const reverse=async(c:typeof admin,f:Awaited<ReturnType<typeof fixture>>,request=randomUUID())=>{await c.query("select set_config('request.jwt.claim.sub',$1,false)",[f.owner]);await c.query('set role authenticated');try{return{result:(await c.query('select reverse_invoice_allocation($1,$2,$3) r',[f.allocation,'Synthetic native event reversal',request])).rows[0].r,request}}finally{await c.query('reset role')}};
 await serialSubtest(t,'event first holds the actual account row until commit; original request recovers after corruption and source loss',async()=>{
  const f=await fixture();await admin.query('alter table financial_accounts disable trigger sourced_account_currency');
  try{
   await first.query('begin');const saved=await reverse(first,f);const changed=second.query("update financial_accounts set currency='USD' where id=$1 returning id",[f.account]);await waitLock(pids[1]);await first.query('commit');assert.equal((await changed).rowCount,1);
   await admin.query("delete from storage.objects where bucket_id='source-evidence' and name in(select object_path from record_source_files where user_id=$1)",[f.owner]);assert.deepEqual((await reverse(first,f,saved.request)).result,saved.result);
   assert.equal((await admin.query("select count(*)::int n from invoice_settlements where user_id=$1 and event_kind='reversal'",[f.owner])).rows[0].n,1);
  }finally{await admin.query('alter table financial_accounts enable trigger sourced_account_currency')}
 });
 await serialSubtest(t,'account change first is awaited and then rejected with no event or request',async()=>{
  const f=await fixture();await admin.query('alter table financial_accounts disable trigger sourced_account_currency');
  try{
   await second.query('begin');await second.query("update financial_accounts set currency='USD' where id=$1",[f.account]);const rejected=assert.rejects(reverse(first,f),/Native review requires actual GBP bank cash/);await waitLock(pids[0]);await second.query('commit');await rejected;
   assert.equal((await admin.query("select count(*)::int n from invoice_settlements where user_id=$1 and event_kind='reversal'",[f.owner])).rows[0].n,0);assert.equal((await admin.query('select count(*)::int n from settlement_requests where user_id=$1',[f.owner])).rows[0].n,1);
  }finally{await admin.query('alter table financial_accounts enable trigger sourced_account_currency')}
 });
 await serialSubtest(t,'the ordinary account currency guard and immutable source identity still reject real edits',async()=>{
  const f=await fixture();await assert.rejects(admin.query("update financial_accounts set currency='USD' where id=$1",[f.account]),/Retain the original currency/);await assert.rejects(admin.query('update bank_transactions set signed_amount_pence=1 where id=$1',[f.receipt]),/immutable|original/i);
 });
});

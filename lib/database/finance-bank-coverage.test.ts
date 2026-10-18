import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { financeCurrencyFixture } from './finance-currency-fixture';
import { bankValuationFixture, openSyntheticForeignAdmission } from './bank-valuation-fixture';
import { prepareCurrentFinancePlan, prepareBankCoveredFinancePlan } from '../finance/snapshot';
import { verifyPlanRevision, type PlanRevision, type PlanContext } from '../finance/server';
import { canonicalJson } from '../tax/snapshot';
import { financeBankCoverageBlocks } from '../finance/coverage';
import { rateFromDecimal } from '../fx/currency';

test('finance bank coverage upgrades retained drafts and independently gates owner-wide available cash',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url),target='20261019130000_finance_bank_source_coverage.sql',predecessor='20261018210000_finance_invoice_currency_coverage.sql';
 const names=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort();for(const n of names.filter(n=>n<predecessor))await db.exec(await readFile(new URL(n,dir),'utf8'));
 const f=await financeCurrencyFixture(db),sql='select capture_finance_plan($1,$2,$3,$4,$5,$6,$7,$8) r';
 await db.exec('reset role');for(const n of names.filter(n=>n>=predecessor&&n<target))await db.exec(await readFile(new URL(n,dir),'utf8'));
 const prior=await f.context(),v2=prepareCurrentFinancePlan(f.owner,f.plan,f.today,f.catalog,prior.invoice_coverage),v2args=[f.owner,prior.ordinal,prior.stamp,v2.inputJson,v2.resultJson,v2.rulesJson,'Synthetic retained V2',randomUUID()];
 await f.service();const oldId=(await db.query<{r:string}>(sql,v2args)).rows[0].r;await f.auth();const old=(await db.query<PlanRevision>('select * from finance_plan_revisions where id=$1',[oldId])).rows[0];
 const identities=async()=>{await db.exec('reset role');return(await db.query("select oid,proname,proacl from pg_proc where oid in ('public.finance_plan_context_for_owner(uuid)'::regprocedure,'public.read_finance_plan_context()'::regprocedure,'public.capture_finance_plan(uuid,integer,text,text,text,text,text,uuid)'::regprocedure) order by proname")).rows};
 const oldIdentities=await identities();await db.exec(await readFile(new URL(target,dir),'utf8'));
 const prepare=async()=>{const ctx=await f.context();return{ctx,p:prepareBankCoveredFinancePlan(f.owner,f.plan,f.today,f.catalog,ctx.invoice_coverage,ctx.bank_source_coverage)}};
 const capture=async()=>{const{ctx,p}=await prepare(),args=[f.owner,ctx.ordinal,ctx.stamp,p.inputJson,p.resultJson,p.rulesJson,'Synthetic current bank plan',randomUUID()];await f.service();return{id:(await db.query<{r:string}>(sql,args)).rows[0].r,args,p}};
 await serialSubtest(t,'old bytes, requests, OIDs/grants and scenario remain exact across the ordered upgrade',async()=>{
  assert.deepEqual(await identities(),oldIdentities);for(const [args,id]of [[f.args,f.id],[v2args,oldId]]as const){await f.service();assert.equal((await db.query<{r:string}>(sql,args)).rows[0].r,id)}
  await f.auth();assert.deepEqual((await db.query<PlanRevision>('select * from finance_plan_revisions where id=$1',[oldId])).rows[0],old);assert.deepEqual(verifyPlanRevision(old,f.owner).result,v2.result);
  const{ctx,p}=await prepare();assert.equal(ctx.schema_version,'finance-plan-context/3');assert.deepEqual(p.result.scenario,f.legacy.result);assert.equal(p.rulesJson,v2.rulesJson);const saved=await capture();await f.auth();assert.deepEqual(verifyPlanRevision((await db.query<PlanRevision>('select * from finance_plan_revisions where id=$1',[saved.id])).rows[0],f.owner).result,saved.p.result);
 });
 let current:Awaited<ReturnType<typeof capture>>;
 await serialSubtest(t,'an empty foreign account alone blocks effective cash and SQL rejects forged optimism, omitted amounts and coverage',async()=>{
  await db.exec('reset role;begin');try{
   await openSyntheticForeignAdmission(db);await db.query("insert into financial_accounts(user_id,label,provider,account_type,currency,masked_identifier) values($1,'Synthetic empty USD','generic','bank','USD','1234')",[f.owner]);
   const{ctx,p}=await prepare();assert.equal(ctx.bank_source_coverage.counts.observations,0);assert.equal(p.result.status,'incomplete');assert.equal(p.result.current_free_cash_pence,null);assert.deepEqual(p.result.scenario,f.legacy.result);
   const call=async(input=p.inputJson,result=p.resultJson)=>{await f.service();return db.query(sql,[f.owner,ctx.ordinal,ctx.stamp,input,result,p.rulesJson,'Synthetic blocked current cash',randomUUID()])};
   for(const patch of [{status:'estimate'},{current_free_cash_pence:0},{additional_drawings_ceiling_pence:0}]){await db.exec('savepoint forged');await assert.rejects(call(p.inputJson,canonicalJson({...p.result,...patch})),/cannot authorize/);await db.exec('rollback to savepoint forged')}
   const missing:Partial<typeof p.result>={...p.result};delete missing.current_free_cash_pence;await db.exec('savepoint missing');await assert.rejects(call(p.inputJson,canonicalJson(missing)),/versioned finance result/);await db.exec('rollback to savepoint missing');
   for(const input of [{...p.input,bank_source_coverage:{}},{...p.input,owner_id:f.other}]){await db.exec('savepoint coverage');await assert.rejects(call(canonicalJson(input)),/coverage changed|owner\/date/);await db.exec('rollback to savepoint coverage')}
   await db.exec('savepoint stamp');await assert.rejects(call(p.inputJson,canonicalJson({...p.result,bank_coverage_stamp:'f'.repeat(64)})),/versioned finance result/);await db.exec('rollback to savepoint stamp');
   await capture();
  }finally{await db.exec('rollback');await db.exec('reset role')}
 });
 await db.exec('reset role');await openSyntheticForeignAdmission(db);const foreign=await bankValuationFixture(db,'KWD','-10.001',f.owner);
 await serialSubtest(t,'all valuation heads including zero remain context; current hashes change without altering scenario or effects',async()=>{
  let previous='';
  for(const [ordinal,state]of [[0,'provisional'],[1,'reviewed'],[2,'reviewed']]as const){await db.exec('reset role');const patch=ordinal===2?{data:{method:'documented_rate/1',rate:rateFromDecimal('KWD','GBP','0.00001'),valuation_date:'2026-04-06',evidence_date:'2026-04-07'}}:{};await foreign.record(await foreign.intent({expected_ordinal:ordinal,state,human_read_original:state==='reviewed',...patch}));
   const{p}=await prepare();assert.notEqual(p.inputHash,previous);previous=p.inputHash;assert.equal(p.result.status,'incomplete');assert.equal(p.result.additional_drawings_ceiling_pence,null);assert.deepEqual(p.result.scenario,f.legacy.result);assert.equal(p.input.bank_source_coverage.observations[0].valuation_status,ordinal===2?'reviewed_zero':state);
  }
  current=await capture();await db.exec('reset role');await db.query("delete from storage.objects where name=$1",[foreign.path]);const stale=await prepare();assert.equal(stale.p.input.bank_source_coverage.observations[0].valuation_status,'stale');
  await db.exec('reset role');await foreign.record(await foreign.intent({expected_ordinal:3,state:'withdrawn',document_id:null,transaction_version:null,data:null,human_read_original:false}));assert.equal((await prepare()).p.input.bank_source_coverage.observations[0].valuation_status,'withdrawn');
  await f.service();for(const[args,id]of [[f.args,f.id],[v2args,oldId],[current.args,current.id]]as const)assert.equal((await db.query<{r:string}>(sql,args)).rows[0].r,id);
  await f.auth();assert.deepEqual(verifyPlanRevision((await db.query<PlanRevision>('select * from finance_plan_revisions where id=$1',[current.id])).rows[0],f.owner).result,current.p.result);
  assert.equal((await db.query<{n:number}>('select count(*)::int n from financial_records')).rows[0].n,0);
 });
 await serialSubtest(t,'native metadata unavailability blocks even when all currency counters are supported; discarded native context does not',async()=>{
  const b=(await prepare()).ctx.bank_source_coverage;const native=structuredClone(b);native.accounts=native.accounts.filter(a=>a.currency==='GBP');native.counts.foreign_accounts=0;native.counts.accounts=native.accounts.length;native.observations=[];native.counts.observations=native.counts.foreign_observations=native.counts.active_blocked_observations=native.counts.reviewed_zero_observations=0;
  await db.exec('reset role');const block=async(value:unknown)=>(await db.query<{r:boolean}>('select finance_bank_sources_blocked($1) r',[JSON.stringify(value)])).rows[0].r;assert.equal(await block(native),false);
  const owner=randomUUID(),account=randomUUID(),file=randomUUID(),imported=randomUUID(),row=randomUUID(),tx=randomUUID(),path='synthetic-native/'+randomUUID();
  await db.query('insert into auth.users(id) values($1)',[owner]);await db.query("insert into financial_accounts(id,user_id,label,provider,account_type,masked_identifier) values($1,$2,'Synthetic native','generic','bank','1234')",[account,owner]);
  await db.query("insert into record_source_files(id,user_id,account_id,file_hash,object_path,key_id,size_bytes) values($1,$2,$3,$4,$5,'synthetic-v1',100)",[file,owner,account,'c'.repeat(64),path]);
  await db.query("insert into record_imports(id,user_id,source_type,status,account_id,source_file_id,file_hash,parser_version,coverage_start,coverage_end,metadata) values($1,$2,'csv','review',$3,$4,$5,'mapped-csv/1','2026-04-06','2026-04-06','{}')",[imported,owner,account,file,'c'.repeat(64)]);
  await db.query("insert into source_rows(id,user_id,import_id,row_number,row_hash,raw_encrypted) values($1,$2,$3,2,$4,'synthetic-placeholder-no-byte-proof')",[row,owner,imported,'d'.repeat(64)]);
  await db.query("insert into bank_transactions(id,user_id,account_id,import_id,source_row_id,transaction_date,signed_amount_pence,currency,description,fingerprint) values($1,$2,$3,$4,$5,'2026-04-06',-100,'GBP','Synthetic native metadata',$6)",[tx,owner,account,imported,row,'e'.repeat(64)]);
  const read=async()=>(await db.query<{r:PlanContext}>('select finance_plan_context_for_owner($1) r',[owner])).rows[0].r;
  const nativeCtx=await read();assert.equal(nativeCtx.bank_source_coverage.counts.active_blocked_observations,0);assert.equal(financeBankCoverageBlocks(nativeCtx.bank_source_coverage),true);assert.equal(await block(nativeCtx.bank_source_coverage),true);
  const manual=structuredClone(f.plan);for(const a of manual.assets){a.account_id=null;a.document_id=null}
  assert.equal(prepareBankCoveredFinancePlan(owner,manual,f.today,{accounts:[],documents:[]},nativeCtx.invoice_coverage,nativeCtx.bank_source_coverage).result.status,'incomplete');
  await db.query("insert into storage.objects(bucket_id,name) values('source-evidence',$1)",[path]);assert.equal(await block((await read()).bank_source_coverage),false);
  await db.query('delete from storage.objects where name=$1',[path]);await db.query("update record_imports set status='discarded' where id=$1",[imported]);const discarded=await read();assert.equal(await block(discarded.bank_source_coverage),false);assert.equal(financeBankCoverageBlocks(discarded.bank_source_coverage),false);

 });
 await serialSubtest(t,'helpers stay private, current read derives owner and authenticated capture is denied',async()=>{
  for(const role of ['anon','authenticated','service_role']){await db.exec('reset role;set role '+role);for(const name of ['finance_plan_context_for_owner','finance_plan_context_v2_for_owner'])await assert.rejects(db.query('select '+name+'($1)',[f.owner]),/permission denied/);await assert.rejects(db.query("select finance_bank_sources_blocked('{}')"),/permission denied/)}
  await f.auth(f.other);const ctx=(await db.query<{c:PlanContext}>('select read_finance_plan_context() c')).rows[0].c;assert.equal(ctx.owner_id,f.other);assert.equal(ctx.bank_source_coverage.counts.accounts,0);await assert.rejects(db.query(sql,current.args),/permission denied/);
 });
});

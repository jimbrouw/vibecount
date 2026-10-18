import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {TEST_SCHEMA_BOOTSTRAP} from './test-schema';
import {serialSubtest} from './serial-subtest';
import {fxConversionLotFixture} from './fx-lot-fixture';
import {bankValuationFixture,openSyntheticForeignAdmission} from './bank-valuation-fixture';
import {parseFinancialReview,parseCurrentFinancialReview,financialReviewPrompt} from '../records/financial-review';
import {rateFromDecimal} from '../fx/currency';

test('operational V2 preserves V1 replay and native money while complete raw bank scope drives quarter attention',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url),target='20261019110000_operational_bank_coverage.sql';
 for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<target).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 const native=await fxConversionLotFixture(db);await db.exec('reset role');
 const oldRaw=(await db.query<{r:unknown}>("select financial_review_catalog($1,2026,'2026-10-18') r",[native.f.owner])).rows[0].r;
 const legacy=parseFinancialReview(native.f.owner,2026,'2026-10-18',oldRaw),oldBytes=JSON.stringify(oldRaw);
 await db.query("select capture_quarter_readiness($1,2026,1,'2026-10-18')",[native.f.owner]);
 const oldCheck=(await db.query<{r:unknown}>('select to_jsonb(c) r from quarterly_readiness_checks c where user_id=$1',[native.f.owner])).rows[0].r;
 const identities=async()=>(await db.query("select oid,proacl from pg_proc where pronamespace='public'::regnamespace and proname in('financial_review_catalog','read_financial_review','capture_quarter_readiness') order by oid")).rows;
 const oldIds=await identities();await db.exec(await readFile(new URL(target,dir),'utf8'));
 const read=async(owner:string,year=2025)=>parseCurrentFinancialReview(owner,year,year===2025?'2026-04-05':'2026-10-18',(await db.query<{r:unknown}>('select financial_review_catalog($1,$2,$3::date) r',[owner,year,year===2025?'2026-04-05':'2026-10-18'])).rows[0].r);
 await serialSubtest(t,'predecessor bytes, current OIDs/grants and legacy quarter history survive the upgrade',async()=>{
  assert.deepEqual(await identities(),oldIds);assert.equal(JSON.stringify((await db.query<{r:unknown}>("select financial_review_catalog_v1($1,2026,'2026-10-18') r",[native.f.owner])).rows[0].r),oldBytes);
  assert.deepEqual((await db.query<{r:unknown}>("select to_jsonb(c)-array['unsupported_source_count','source_unavailable_count','bank_coverage_stamp'] r from quarterly_readiness_checks c where user_id=$1",[native.f.owner])).rows[0].r,oldCheck);
  const current=await read(native.f.owner,2026);assert.equal(current.quarters[0].income_pence,legacy.quarters[0].income_pence);assert.deepEqual(current.recent_records,legacy.recent_records);assert.deepEqual(current.overdue_invoices,legacy.overdue_invoices);assert.equal(current.source_count,legacy.source_count);assert.equal(current.unresolved_source_count,legacy.unresolved_source_count);assert.notEqual(current.stamp,legacy.stamp);
 });
 await openSyntheticForeignAdmission(db);const f=await bankValuationFixture(db);
 await serialSubtest(t,'foreign Unknown is counted once; future Business with null GBP cannot disappear through materiality',async()=>{
  let c=await read(f.owner);assert.equal(c.source_count,1);assert.equal(c.unsupported_source_count,1);assert.equal(c.unresolved_source_count,1);assert.equal(c.quarters[3].unresolved_source_count,1);assert.equal(c.quarters[3].source_count,1);
  // Simulate future/legacy classification metadata, not a newly enabled writer.
  await db.exec('alter table bank_transactions disable trigger native_bank_decision_fence');
  try{await db.query("update bank_transactions set classification='Business',business_use_bps=10000 where id=$1",[f.transaction])}finally{await db.exec('alter table bank_transactions enable trigger native_bank_decision_fence')}
  const category=(await db.query<{id:string}>("select id from record_categories where is_default and record_type='income' limit 1")).rows[0].id;
  await db.query("insert into financial_records(user_id,record_type,record_date,description,amount,status,category_id) values($1,'income','2026-01-06','Synthetic separate native record',1,'approved',$2)",[f.owner,category]);
  const old=parseFinancialReview(f.owner,2025,'2026-04-05',(await db.query<{r:unknown}>("select financial_review_catalog_v1($1,2025,'2026-04-05') r",[f.owner])).rows[0].r);assert.equal(old.unresolved_source_count,0);
  c=await read(f.owner);assert.equal(c.unresolved_source_count,1);assert.equal(c.quarters[3].income_pence,100);
  await db.exec('set role service_role');await db.query("select capture_quarter_readiness($1,2025,4,'2026-04-05')",[f.owner]);await db.exec('reset role');
  const saved=(await db.query<{status:string;coverage_version:string;source_stamp:string;bank_coverage_stamp:string;unsupported_source_count:number;source_unavailable_count:number}>('select * from quarterly_readiness_checks where user_id=$1',[f.owner])).rows[0];
  assert.equal(saved.status,'needs_attention');assert.equal(saved.coverage_version,'vibecount.financial-review/2');assert.equal(saved.source_stamp,c.stamp);assert.equal(saved.bank_coverage_stamp,c.bank_source_coverage.stamp);assert.equal(saved.unsupported_source_count,1);assert.equal(saved.source_unavailable_count,0);
 });
 await serialSubtest(t,'all valuation heads including reviewed zero remain contextual and unsupported; source loss changes the stamp',async()=>{
  let c=await read(f.owner),stamp=c.stamp;
  for(const [ordinal,state] of [[0,'provisional'],[1,'reviewed'],[2,'reviewed']] as const){
   const patch=ordinal===2?{data:{method:'documented_rate/1',rate:rateFromDecimal('KWD','GBP','0.00001'),valuation_date:'2026-04-06',evidence_date:'2026-04-07'}}:{};
   await f.record(await f.intent({expected_ordinal:ordinal,state,human_read_original:state==='reviewed',...patch}));c=await read(f.owner);assert.notEqual(c.stamp,stamp);stamp=c.stamp;assert.equal(c.unsupported_source_count,1);assert.equal(c.unresolved_source_count,1);assert.equal(c.quarters[3].income_pence,100);
  }
  assert.equal(c.bank_source_coverage.counts.reviewed_zero_observations,1);
  await db.query('delete from storage.objects where name=$1',[f.documentPath]);c=await read(f.owner);assert.equal(c.bank_source_coverage.observations[0].valuation_status,'stale');assert.notEqual(c.stamp,stamp);
  await f.record(await f.intent({expected_ordinal:3,state:'withdrawn',document_id:null,transaction_version:null,data:null,human_read_original:false}));c=await read(f.owner);assert.equal(c.bank_source_coverage.observations[0].valuation_status,'withdrawn');
  assert.doesNotMatch(financialReviewPrompt(c),/object_path|key_id|file_sha256|row_sha256|original_signed_minor|family_id/);
 });
 await serialSubtest(t,'discarded/other-year context does not inflate year sources; native missing objects independently require attention',async()=>{
  await db.query("update record_imports set status='discarded' where id=$1",[f.imported]);const discarded=await read(f.owner);assert.equal(discarded.source_count,0);assert.equal(discarded.unsupported_source_count,0);assert.equal(discarded.bank_source_coverage.counts.foreign_observations,1);
  assert.equal((await read(f.owner,2026)).source_count,0);
  const source=(await db.query<{object_path:string}>('select s.object_path from record_source_files s join record_imports i on i.source_file_id=s.id join bank_transactions t on t.import_id=i.id where t.id=$1',[native.tx])).rows[0];
  const before=await read(native.f.owner,2026);await db.query("delete from storage.objects where bucket_id='source-evidence' and name=$1",[source.object_path]);const missing=await read(native.f.owner,2026);assert.equal(missing.unsupported_source_count,0);assert.equal(missing.source_unavailable_count,1);assert.equal(missing.unresolved_source_count,1);assert.notEqual(missing.stamp,before.stamp);assert.equal(missing.quarters[0].income_pence,before.quarters[0].income_pence);
 });
 await serialSubtest(t,'current reader is owner-derived and capture/private helpers retain narrow role grants',async()=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.other]);await db.exec('set role authenticated');const own=parseCurrentFinancialReview(f.other,2025,'2026-04-05',(await db.query<{r:unknown}>("select read_financial_review(2025,'2026-04-05') r")).rows[0].r);assert.equal(own.source_count,0);
  for(const role of ['authenticated','anon','service_role']){
   await db.exec('reset role;set role '+role);await assert.rejects(db.query("select financial_review_catalog_v1($1,2025,'2026-04-05')",[f.owner]),/permission denied/);await assert.rejects(db.query('select freeze_financial_review_inputs()'),/permission denied/);
   if(role!=='service_role')await assert.rejects(db.query("select capture_quarter_readiness($1,2025,4,'2026-04-05')",[f.owner]),/permission denied/);
   if(role!=='authenticated')await assert.rejects(db.query("select read_financial_review(2025,'2026-04-05')"),/permission denied/);
  }await db.exec('reset role');
 });
});

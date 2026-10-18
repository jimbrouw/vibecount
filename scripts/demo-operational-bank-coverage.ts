import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {TEST_SCHEMA_BOOTSTRAP} from '../lib/database/test-schema';
import {bankValuationFixture,openSyntheticForeignAdmission} from '../lib/database/bank-valuation-fixture';
import {parseFinancialReview,parseCurrentFinancialReview,financialReviewPrompt,type FinancialReview} from '../lib/records/financial-review';
import {rateFromDecimal} from '../lib/fx/currency';
import {sourceHash} from '../lib/records/source-crypto';

async function main(){
 const db=new PGlite({extensions:{pgcrypto}}),output='/tmp/vibecount-operational-bank-coverage-demo';
 try{
  await db.exec(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../supabase/migrations/',import.meta.url),migrations=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort();
  for(const name of migrations)await db.exec(await readFile(new URL(name,dir),'utf8'));
  const closed=async()=>{
   assert.equal((await db.query<{n:number}>("select count(*)::int n from pg_constraint where conname in('financial_accounts_currency_check','bank_transactions_currency_check') and pg_get_constraintdef(oid) like '%GBP%'")).rows[0].n,2);
   assert.equal((await db.query<{n:boolean}>("select attnotnull n from pg_attribute where attrelid='bank_transactions'::regclass and attname='signed_amount_pence'")).rows[0].n,true);
  };
  await closed();await db.exec('begin');let result;
  try{
   await openSyntheticForeignAdmission(db);const f=await bankValuationFixture(db);
   // Simulated future/legacy metadata, isolated from every production decision writer.
   await db.exec('alter table bank_transactions disable trigger native_bank_decision_fence');
   await db.query("update bank_transactions set classification='Business',business_use_bps=10000 where id=$1",[f.transaction]);
   await db.exec('alter table bank_transactions enable trigger native_bank_decision_fence');
   const category=(await db.query<{id:string}>("select id from record_categories where is_default and record_type='income' limit 1")).rows[0].id;
   // One pre-existing synthetic native effect lets the example expose the V1 false-clear defect.
   await db.query("insert into financial_records(user_id,record_type,record_date,description,amount,status,category_id) values($1,'income','2026-01-06','Synthetic existing native record',1,'approved',$2)",[f.owner,category]);
   const effectBytes=(await db.query<{r:unknown}>('select to_jsonb(r) r from financial_records r order by id')).rows;
   const legacy=parseFinancialReview(f.owner,2025,'2026-04-05',(await db.query<{r:unknown}>("select financial_review_catalog_v1($1,2025,'2026-04-05') r",[f.owner])).rows[0].r);assert.equal(legacy.unresolved_source_count,0);
   const snapshots:{state:string;review:FinancialReview;capture:unknown}[]=[];
   const capture=async(state:string,expectedBlocked=true)=>{
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.owner]);await db.exec('set role authenticated');
    const review=parseCurrentFinancialReview(f.owner,2025,'2026-04-05',(await db.query<{r:unknown}>("select read_financial_review(2025,'2026-04-05') r")).rows[0].r);
    assert.equal(review.unsupported_source_count,expectedBlocked?1:0);assert.equal(review.quarters[3].income_pence,100);
    await db.exec('reset role;set role service_role');const saved=(await db.query<{r:{status:string}}>("select capture_quarter_readiness($1,2025,4,'2026-04-05') r",[f.owner])).rows[0].r;await db.exec('reset role');assert.equal(saved.status,expectedBlocked?'needs_attention':'ok');
    snapshots.push({state,review,capture:saved});
   };
   await capture('unvalued');await f.record(await f.intent({state:'provisional',human_read_original:false}));await capture('provisional');
   await f.record(await f.intent({expected_ordinal:1}));await capture('reviewed');
   await f.record(await f.intent({expected_ordinal:2,data:{method:'documented_rate/1',rate:rateFromDecimal('KWD','GBP','0.00001'),valuation_date:'2026-04-06',evidence_date:'2026-04-07'}}));await capture('reviewed_zero');
   await db.query('delete from storage.objects where name=$1',[f.documentPath]);await capture('stale');
   await f.record(await f.intent({expected_ordinal:3,state:'withdrawn',document_id:null,transaction_version:null,data:null,human_read_original:false}));await capture('withdrawn');
   await db.query("update record_imports set status='discarded' where id=$1",[f.imported]);await capture('discarded',false);
   assert.equal(new Set(snapshots.map(s=>s.review.stamp)).size,snapshots.length);assert.deepEqual((await db.query<{r:unknown}>('select to_jsonb(r) r from financial_records r order by id')).rows,effectBytes);
   const prompt=financialReviewPrompt(snapshots[3].review);assert.doesNotMatch(prompt,/file_sha256|row_sha256|original_signed_minor|object_path|key_id|family_id/);assert.ok(!prompt.includes(f.owner));
   result={synthetic_only:true,migration_count:migrations.length,legacy_unresolved_source_count:legacy.unresolved_source_count,recognised_effect_count_before:effectBytes.length,recognised_effect_count_after:effectBytes.length,recognised_effect_bytes_unchanged:true,provider_calls:0,provider_preview:JSON.parse(prompt),snapshots};f.key.fill(0);
  }finally{await db.exec('rollback;reset role')}
  await closed();assert.equal((await db.query('select id from quarterly_readiness_checks')).rows.length,0);
  await mkdir(output,{recursive:true});const body=JSON.stringify(result,null,2);await writeFile(output+'/operational-review.json',body);
  await writeFile(output+'/manifest.json',JSON.stringify({synthetic_only:true,artifact:'operational-review.json',size_bytes:Buffer.byteLength(body),sha256:sourceHash(Buffer.from(body)),production_admission_still_closed:true,all_fixture_changes_rolled_back:true},null,2));
  await writeFile(output+'/README.md','# Synthetic operational bank coverage V2\n\nAll ordered local migrations run in disposable SQL. Temporary foreign admission, simulated Business metadata and one pre-existing native GBP 1.00 effect exist only inside a rolled-back fixture. The retained V1 materiality check reports no unresolved row for foreign Business with null GBP cash; V2 counts it explicitly. Unvalued, provisional, reviewed, reviewed-zero, stale and withdrawn states all require operational attention while native ledger GBP 1.00 remains unchanged. Discarded source stays in owner-wide context but leaves active-year counters; its operational no-listed-issues result is not source, account cash, retained byte or tax certification. Every snapshot changes the stamp. The provider summary is a local aggregate preview, never sent. Actual admission guards are checked after rollback. No real approvals, provider calls, hosted writes or filing.\n');
  process.stdout.write('Synthetic operational bank coverage artifacts: '+output+'\n');
 }finally{await db.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});

import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {TEST_SCHEMA_BOOTSTRAP} from '../lib/database/test-schema';
import {bankValuationFixture,openSyntheticForeignAdmission} from '../lib/database/bank-valuation-fixture';
import {bankSourceCoverageBlocks,parseBankSourceCoverage,type BankSourceCoverage} from '../lib/records/bank-source-coverage';
import {sourceHash,decryptSource,sourceContext} from '../lib/records/source-crypto';
import {rateFromDecimal} from '../lib/fx/currency';

async function main(){
 const db=new PGlite({extensions:{pgcrypto}}),output='/tmp/vibecount-bank-source-coverage-demo';
 try{
  await db.exec(TEST_SCHEMA_BOOTSTRAP);
  const dir=new URL('../supabase/migrations/',import.meta.url),migrations=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort();
  for(const name of migrations)await db.exec(await readFile(new URL(name,dir),'utf8'));
  const closed=async()=>{
   assert.equal((await db.query<{n:number}>("select count(*)::int n from pg_constraint where conname in('financial_accounts_currency_check','bank_transactions_currency_check') and pg_get_constraintdef(oid) like '%GBP%'")).rows[0].n,2);
   assert.equal((await db.query<{n:boolean}>("select attnotnull n from pg_attribute where attrelid='bank_transactions'::regclass and attname='signed_amount_pence'")).rows[0].n,true);
  };
  await closed();await db.exec('begin');let result;
  try{
   await openSyntheticForeignAdmission(db);const f=await bankValuationFixture(db);
   assert.deepEqual(decryptSource(f.cipher,f.key,sourceContext(f.owner,f.account,f.hash)),f.sourceBytes);
   const read=async()=>{
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.owner]);await db.exec('set role authenticated');
    try{return parseBankSourceCoverage((await db.query<{r:unknown}>('select read_bank_source_coverage() r')).rows[0].r,f.owner)}finally{await db.exec('reset role')}
   };
   const states:BankSourceCoverage[]=[];
   const capture=async(status:string)=>{const c=await read();assert.equal(c.observations.length,1);assert.equal(c.observations[0].valuation_status,status);assert.equal(c.observations[0].signed_amount_pence,null);assert.equal(c.observations[0].original_signed_minor,'-10001');assert.equal(bankSourceCoverageBlocks(c),true);assert.doesNotMatch(JSON.stringify(c),/object_path|key_id|raw_encrypted/);states.push(c);};
   await capture('unvalued');
   await f.record(await f.intent({state:'provisional',human_read_original:false}));await capture('provisional');
   await f.record(await f.intent({expected_ordinal:1}));await capture('reviewed');
   await f.record(await f.intent({expected_ordinal:2,data:{method:'documented_rate/1',rate:rateFromDecimal('KWD','GBP','0.00001'),valuation_date:'2026-04-06',evidence_date:'2026-04-07'}}));await capture('reviewed_zero');
   await db.query('delete from storage.objects where name=$1',[f.documentPath]);await capture('stale');
   await f.record(await f.intent({expected_ordinal:3,state:'withdrawn',document_id:null,transaction_version:null,data:null,human_read_original:false}));await capture('withdrawn');
   await db.query("update record_imports set status='discarded' where id=$1",[f.imported]);await capture('withdrawn');assert.equal(states.at(-1)!.counts.active_blocked_observations,0);
   assert.equal(new Set(states.map(c=>c.stamp)).size,states.length);
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.owner]);await db.exec('set role authenticated');
   await db.exec('savepoint rejected_native');
   await assert.rejects(db.query("select review_bank_transaction($1,0,'Personal',null,0,'No inferred native amount')",[f.transaction]),/actual GBP/);await db.exec('rollback to rejected_native;reset role');
   assert.equal((await db.query('select id from receipt_allocation_balances where user_id=$1',[f.owner])).rows.length,0);
   const effects=(await db.query<{records:number;decisions:number;settlements:number}>("select (select count(*)::int from financial_records) records,(select count(*)::int from classification_decisions) decisions,(select count(*)::int from invoice_settlements) settlements")).rows[0];
   assert.deepEqual(effects,{records:0,decisions:0,settlements:0});
   result={synthetic_only:true,migration_count:migrations.length,scope:'Coverage and native containment prerequisite; not foreign ingestion, posting, source-byte certification or tax/finance readiness.',source_roundtrip_verified:true,native_view_rows:0,financial_effect_counts:effects,states};f.key.fill(0);
  }finally{await db.exec('rollback;reset role');}
  await closed();assert.equal((await db.query('select id from bank_transactions')).rows.length,0);
  await mkdir(output,{recursive:true});const body=JSON.stringify(result,null,2);await writeFile(output+'/coverage.json',body);
  await writeFile(output+'/manifest.json',JSON.stringify({synthetic_only:true,artifact:'coverage.json',sha256:sourceHash(Buffer.from(body)),size_bytes:Buffer.byteLength(body),all_fixture_changes_rolled_back:true,production_admission_still_closed:true},null,2));
  await writeFile(output+'/README.md','# Synthetic bank source coverage demo\n\nOrdered local migrations run in disposable SQL. Temporary foreign admission and all fixture/history changes roll back. KWD -10.001 survives unvalued, provisional, reviewed, reviewed-zero, stale, withdrawn and discarded states, despite native receipt views omitting it. Each state changes the complete source stamp. The authenticated owner reader exposes safe dimensions without object paths or keys; native classification rejects the foreign source and no financial effect is created. This does not enable foreign ingestion or certify downstream completeness, readable retained bytes, account cash balances, tax treatment or hosted access.\n');
  process.stdout.write('Synthetic bank source coverage artifacts: '+output+'\n');
 }finally{await db.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});

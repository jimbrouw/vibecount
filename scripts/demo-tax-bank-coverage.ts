import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {TEST_SCHEMA_BOOTSTRAP} from '../lib/database/test-schema';
import {taxCurrencyFixture} from '../lib/database/tax-currency-fixture';
import {bankValuationFixture,openSyntheticForeignAdmission} from '../lib/database/bank-valuation-fixture';
import {canonicalJson,prepareCalculation,sha256} from '../lib/tax/snapshot';
import {buildFilingPack,verifyFilingPack,type SavedFilingPack} from '../lib/tax/filing-pack';
import {BANK_WITHHELD_TOTALS,bankTaxScope} from '../lib/tax/bank-source-coverage';
import {rateFromDecimal} from '../lib/fx/currency';

async function main(){
 const db=new PGlite({extensions:{pgcrypto}}),output='/tmp/vibecount-tax-bank-coverage-demo',target='20261019120000_tax_bank_source_coverage.sql';
 try{
  await db.exec(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../supabase/migrations/',import.meta.url),migrations=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort();for(const name of migrations.filter(n=>n<target))await db.exec(await readFile(new URL(name,dir),'utf8'));
  const closed=async()=>{
   assert.equal((await db.query<{n:number}>("select count(*)::int n from pg_constraint where conname in('financial_accounts_currency_check','bank_transactions_currency_check') and pg_get_constraintdef(oid) like '%GBP%'")).rows[0].n,2);
   assert.equal((await db.query<{n:boolean}>("select attnotnull n from pg_attribute where attrelid='bank_transactions'::regclass and attname='signed_amount_pence'")).rows[0].n,true);
  };
  await closed();await db.exec('begin');let result;let retained:ReturnType<typeof buildFilingPack>|undefined;
  try{
   const f=await taxCurrencyFixture(db);await db.exec('reset role');await db.exec(await readFile(new URL(target,dir),'utf8'));await openSyntheticForeignAdmission(db);const bank=await bankValuationFixture(db,'KWD','-10.001',f.owner);
   await db.query("insert into financial_records(user_id,record_type,record_date,description,amount,status) values($1,'income','2026-01-06','Synthetic existing native GBP record',1,'approved')",[f.owner]);
   const before=(await db.query<{r:unknown}>('select to_jsonb(r) r from financial_records r order by id')).rows;
   const snapshots:unknown[]=[];let first:{calculation:string;calculationArgs:unknown[];pack:string;packArgs:unknown[];row:SavedFilingPack}|undefined;
   const changes=[['unvalued',async()=>{}],['provisional',async()=>{await bank.record(await bank.intent({state:'provisional',human_read_original:false}))}],['reviewed',async()=>{await bank.record(await bank.intent({expected_ordinal:1}))}],
    ['reviewed_zero',async()=>{await bank.record(await bank.intent({expected_ordinal:2,data:{method:'documented_rate/1',rate:rateFromDecimal('KWD','GBP','0.00001'),valuation_date:'2026-04-06',evidence_date:'2026-04-07'}}))}],
    ['stale',async()=>{await db.query('delete from storage.objects where name=$1',[bank.documentPath])}],['withdrawn',async()=>{await bank.record(await bank.intent({expected_ordinal:3,state:'withdrawn',document_id:null,transaction_version:null,data:null,human_read_original:false}))}],
    ['discarded',async()=>{await db.query("update record_imports set status='discarded' where id=$1",[bank.imported])}]] as const;
   for(const[state,change]of changes){
    await db.exec('reset role');await change();const p=prepareCalculation(await f.input());if(p.input.schema_version!=='tax-calculation-input/3')throw new Error('Current tax input required');const scope=bankTaxScope(p.input,p.input.bank_source_coverage);assert.equal(scope.blocks,state!=='discarded');assert.equal(p.result.totals.ledger_income,100);if(scope.blocks)for(const k of BANK_WITHHELD_TOTALS)assert.equal(p.result.totals[k],null);
    const calculationArgs=[f.owner,2025,p.inputJson,p.resultJson,p.rulesJson,'Synthetic current bank source calculation',randomUUID()];await f.service();const calculation=(await db.query<{r:string}>('select capture_tax_calculation($1,$2,$3,$4,$5,$6,$7) r',calculationArgs)).rows[0].r;
    const input=await f.packInput(calculation),bundle=buildFilingPack(input,[],randomUUID(),false);assert.equal(input.schema_version,'filing-pack-input/4');assert.equal(input.calculation_is_current,true);assert.equal(bundle.schema_version,'draft-filing-pack/5');assert.equal(bundle.artifacts.length,7);
    const packArgs=[f.owner,calculation,canonicalJson(input),canonicalJson(bundle),'Synthetic incomplete source-linked pack',bundle.request_id];await f.service();const pack=(await db.query<{r:string}>('select capture_filing_pack($1,$2,$3,$4,$5,$6) r',packArgs)).rows[0].r;await f.auth();const row=(await db.query<SavedFilingPack>('select * from filing_packs where id=$1',[pack])).rows[0];verifyFilingPack(row);
    if(!first){first={calculation,calculationArgs,pack,packArgs,row};retained=bundle}
    snapshots.push({state,input_sha256:p.inputHash,result_sha256:p.resultHash,bank_scope:{source_count:scope.source_count,unsupported_count:scope.unsupported_count,source_unavailable_count:scope.source_unavailable_count,blocks:scope.blocks},ledger_income_pence:p.result.totals.ledger_income,tax_status:p.result.status,calculation,pack,pack_version:bundle.schema_version,review_status:bundle.review_status,artifacts:bundle.artifacts.map(({name,sha256,size_bytes})=>({name,sha256,size_bytes}))});
   }
   if(!first||!retained)throw new Error('Retained example unavailable');await f.service();assert.equal((await db.query<{r:string}>('select capture_tax_calculation($1,$2,$3,$4,$5,$6,$7) r',f.calculationArgs)).rows[0].r,f.calculation);assert.equal((await db.query<{r:string}>('select capture_filing_pack($1,$2,$3,$4,$5,$6) r',f.packArgs)).rows[0].r,f.pack);
   assert.equal((await db.query<{r:string}>('select capture_tax_calculation($1,$2,$3,$4,$5,$6,$7) r',first.calculationArgs)).rows[0].r,first.calculation);assert.equal((await db.query<{r:string}>('select capture_filing_pack($1,$2,$3,$4,$5,$6) r',first.packArgs)).rows[0].r,first.pack);verifyFilingPack(first.row);assert.equal(verifyFilingPack(f.oldPack).schema_version,'draft-filing-pack/4');
   await db.exec('reset role');assert.deepEqual((await db.query<{r:unknown}>('select to_jsonb(r) r from financial_records r order by id')).rows,before);
   result={synthetic_only:true,migration_count:migrations.filter(n=>n<=target).length,ordered_upgrade_in_rolled_back_fixture:true,old_and_new_exact_recovery:true,old_pack_version:'draft-filing-pack/4',retained_current_pack_version:retained.schema_version,recognised_effect_bytes_unchanged:true,provider_calls:0,snapshots};bank.key.fill(0);
  }finally{await db.exec('rollback;reset role')}
  await closed();for(const table of ['financial_records','tax_calculations','filing_packs'])assert.equal((await db.query('select 1 from '+table)).rows.length,0);
  if(!retained)throw new Error('No retained artifacts');await mkdir(output+'/artifacts',{recursive:true});for(const a of retained.artifacts)await writeFile(output+'/artifacts/'+a.name,a.body);
  const report=canonicalJson(result),bundle=canonicalJson(retained);await writeFile(output+'/report.json',report);await writeFile(output+'/bundle.json',bundle);
  await writeFile(output+'/manifest.json',JSON.stringify({synthetic_only:true,production_admission_still_closed:true,all_fixture_and_upgrade_changes_rolled_back:true,files:[{name:'report.json',sha256:sha256(report),size_bytes:Buffer.byteLength(report)},{name:'bundle.json',sha256:sha256(bundle),size_bytes:Buffer.byteLength(bundle)},...retained.artifacts.map(a=>({name:'artifacts/'+a.name,sha256:a.sha256,size_bytes:a.size_bytes}))]},null,2));
  await writeFile(output+'/README.md','# Synthetic tax bank coverage and filing V5\n\nOrdered predecessor captures, the current upgrade, foreign admission and all fixture/history changes exist only in a rolled-back disposable transaction. KWD -10.001 remains separate from one synthetic native GBP 1.00 effect. Unvalued/provisional/reviewed/reviewed-zero/stale/withdrawn sources block dependent tax figures and completeness; discarded unrelated sources stay in labelled context without an active bank blocker. Other missing tax inputs still make every example an incomplete draft. Seven artifacts retain original dimensions, trace and evidence. Exact old V4 and current V5 requests recover after changes; recognised effect bytes are unchanged. Hash/size manifest covers all exported JSON and seven artifacts. No real approval, provider call, hosted change or filing.\n');
  process.stdout.write('Synthetic tax bank coverage artifacts: '+output+'\n');
 }finally{await db.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});

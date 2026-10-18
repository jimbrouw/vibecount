import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {TEST_SCHEMA_BOOTSTRAP} from './test-schema';
import {serialSubtest} from './serial-subtest';
import {taxCurrencyFixture} from './tax-currency-fixture';
import {bankValuationFixture,openSyntheticForeignAdmission} from './bank-valuation-fixture';
import {canonicalJson,prepareCalculation,type SavedCalculation} from '../tax/snapshot';
import {buildFilingPack,buildFilingReview,verifyFilingPack,type SavedFilingPack} from '../tax/filing-pack';
import {BANK_WITHHELD_TOTALS,bankTaxScope} from '../tax/bank-source-coverage';
import {rateFromDecimal} from '../fx/currency';

test('tax input3 and filing input4/bundle5 preserve exact history while raw bank coverage independently prevents optimistic claims',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url),target='20261019120000_tax_bank_source_coverage.sql';
 for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<target).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 const f=await taxCurrencyFixture(db),oldInput=f.oldPack.input,step=buildFilingReview(oldInput,[]).steps[0],stepArgs=[f.owner,f.calculation,canonicalJson(oldInput),step.id,step.digest,JSON.stringify(step.data),'Synthetic retained step',randomUUID()];
 await f.service();const stepId=(await db.query<{r:string}>('select review_filing_pack_step($1,$2,$3,$4,$5,$6,$7,$8) r',stepArgs)).rows[0].r;
 const identities=async()=>(await db.query("select oid,proacl from pg_proc where pronamespace='public'::regnamespace and proname in('tax_calculation_input_for_owner','tax_filing_pack_input_for_owner','capture_tax_calculation','capture_filing_pack','review_filing_pack_step','freeze_tax_pack_inputs','read_tax_calculation_input','read_tax_filing_pack_input') order by oid")).rows;
 const oldIds=await identities();await db.exec('reset role');await db.exec(await readFile(new URL(target,dir),'utf8'));
 const capture=async(p:ReturnType<typeof prepareCalculation>,request=randomUUID())=>{const args=[f.owner,2025,p.inputJson,p.resultJson,p.rulesJson,'Synthetic bank source draft',request];await f.service();return{id:(await db.query<{r:string}>('select capture_tax_calculation($1,$2,$3,$4,$5,$6,$7) r',args)).rows[0].r,args}};
 await serialSubtest(t,'old calculation/pack/step bytes and exact retries survive in-place upgrade while native arithmetic is unchanged',async()=>{
  assert.deepEqual(await identities(),oldIds);assert.equal(verifyFilingPack(f.oldPack).schema_version,'draft-filing-pack/4');
  await f.service();assert.equal((await db.query<{r:string}>('select capture_tax_calculation($1,$2,$3,$4,$5,$6,$7) r',f.calculationArgs)).rows[0].r,f.calculation);
  assert.equal((await db.query<{r:string}>('select capture_filing_pack($1,$2,$3,$4,$5,$6) r',f.packArgs)).rows[0].r,f.pack);assert.equal((await db.query<{r:string}>('select review_filing_pack_step($1,$2,$3,$4,$5,$6,$7,$8) r',stepArgs)).rows[0].r,stepId);
  await f.auth();assert.deepEqual((await db.query<SavedCalculation>('select * from tax_calculations where id=$1',[f.calculation])).rows[0],f.oldCalculation);assert.deepEqual((await db.query<SavedFilingPack>('select * from filing_packs where id=$1',[f.pack])).rows[0],f.oldPack);
  const current=await f.input();assert.equal(current.schema_version,'tax-calculation-input/3');assert.deepEqual(prepareCalculation(current).result,f.before.result);assert.equal((await f.packInput()).calculation_is_current,false);
 });
 await db.exec('reset role');await openSyntheticForeignAdmission(db);const foreign=await bankValuationFixture(db,'KWD','-10.001',f.owner);
 let saved:{id:string;args:unknown[]}|undefined,packArgs:unknown[]=[],packId='';
 await serialSubtest(t,'actual foreign rows retain original dimensions and withhold every dependent tax total; incomplete capture remains useful',async()=>{
  const p=prepareCalculation(await f.input());assert.equal(p.input.schema_version,'tax-calculation-input/3');if(p.input.schema_version!=='tax-calculation-input/3')throw new Error('V3 required');
  assert.equal(p.input.bank_source_coverage.counts.foreign_observations,1);assert.equal(p.input.bank_source_coverage.observations[0].original_signed_minor,'-10001');assert.equal(p.result.status,'incomplete');for(const key of BANK_WITHHELD_TOTALS)assert.equal(p.result.totals[key],null,key);
  saved=await capture(p);const input=await f.packInput(saved.id);assert.equal(input.schema_version,'filing-pack-input/4');assert.equal(input.calculation_is_current,true);
  const bundle=buildFilingPack(input,[],randomUUID(),false);assert.equal(bundle.schema_version,'draft-filing-pack/5');assert.equal(bundle.artifacts.length,7);assert.match(bundle.artifacts.find(a=>a.name==='normalized-ledger.csv')!.body,/-10001/);
  packArgs=[f.owner,saved.id,canonicalJson(input),canonicalJson(bundle),'Synthetic incomplete bank pack',bundle.request_id];await f.service();packId=(await db.query<{r:string}>('select capture_filing_pack($1,$2,$3,$4,$5,$6) r',packArgs)).rows[0].r;
  await f.auth();assert.equal(verifyFilingPack((await db.query<SavedFilingPack>('select * from filing_packs where id=$1',[packId])).rows[0]).schema_version,'draft-filing-pack/5');
 });
 await serialSubtest(t,'SQL rejects optimistic or missing withheld totals and unsupported completeness independently of application checks',async()=>{
  const p=prepareCalculation(await f.input());
  for(const mode of ['estimate','non_null','missing']){
   const forged=structuredClone(p.result);if(mode==='estimate')forged.status='estimate';if(mode==='non_null')forged.totals.trade_profit=0;if(mode==='missing')delete forged.totals.trade_profit;
   await f.service();await assert.rejects(db.query('select capture_tax_calculation($1,2025,$2,$3,$4,$5,$6)',[f.owner,p.inputJson,canonicalJson(forged),p.rulesJson,'Synthetic optimistic bank claim',randomUUID()]),/Bank source coverage/);
  }
  const input=await f.packInput(saved!.id),bundle=buildFilingPack(input,[],randomUUID(),false),forged={...bundle,review_status:'draft_reviewed',completeness_attested:true};await f.service();await assert.rejects(db.query('select capture_filing_pack($1,$2,$3,$4,$5,$6)',[f.owner,saved!.id,canonicalJson(input),canonicalJson(forged),'Synthetic optimistic bank pack',forged.request_id]),/Bank source coverage/);
  await assert.rejects(db.query('select capture_tax_calculation($1,2025,$2,$3,$4,$5,$6)',[f.owner,'x'.repeat(4000001),p.resultJson,p.rulesJson,'Synthetic oversized capture',randomUUID()]),/safe capacity/);
 });
 await serialSubtest(t,'valuation states/zero and source-object loss invalidate currentness while old and new exact requests still recover',async()=>{
  for(const [ordinal,state]of [[0,'provisional'],[1,'reviewed'],[2,'reviewed']]as const){
   await db.exec('reset role');const patch=ordinal===2?{data:{method:'documented_rate/1',rate:rateFromDecimal('KWD','GBP','0.00001'),valuation_date:'2026-04-06',evidence_date:'2026-04-07'}}:{};
   await foreign.record(await foreign.intent({expected_ordinal:ordinal,state,human_read_original:state==='reviewed',...patch}));const p=prepareCalculation(await f.input());for(const key of BANK_WITHHELD_TOTALS)assert.equal(p.result.totals[key],null);assert.equal((await f.packInput(saved!.id)).calculation_is_current,false);
  }
  await db.exec('reset role');await db.query('delete from storage.objects where name in($1,$2)',[foreign.path,foreign.documentPath]);
  const p=prepareCalculation(await f.input());assert.equal(p.input.schema_version==='tax-calculation-input/3'&&p.input.bank_source_coverage.observations[0].valuation_status,'stale');
  await db.exec('reset role');await foreign.record(await foreign.intent({expected_ordinal:3,state:'withdrawn',document_id:null,transaction_version:null,data:null,human_read_original:false}));
  await f.service();for(const call of [f.calculationArgs,saved!.args])assert.ok((await db.query<{r:string}>('select capture_tax_calculation($1,$2,$3,$4,$5,$6,$7) r',call)).rows[0].r);assert.equal((await db.query<{r:string}>('select capture_filing_pack($1,$2,$3,$4,$5,$6) r',packArgs)).rows[0].r,packId);assert.equal((await db.query<{r:string}>('select review_filing_pack_step($1,$2,$3,$4,$5,$6,$7,$8) r',stepArgs)).rows[0].r,stepId);
 });
 await serialSubtest(t,'private compatibility/blocker/freeze helpers stay inaccessible and current owned input cannot be read by another owner',async()=>{
  for(const role of ['authenticated','anon','service_role']){await db.exec('reset role;set role '+role);for(const sql of ['select freeze_tax_calculation_inputs()',"select tax_bank_sources_blocked('{}')",'select tax_calculation_input_v2_for_owner($1,2025)'])await assert.rejects(db.query(sql,sql.includes('$1')?[f.owner]:[]),/permission denied/)}
  await f.auth(f.other);const empty=(await db.query<{r:{owner_id:string;bank_source_coverage:{counts:{observations:number}}}}>('select read_tax_calculation_input(2025) r')).rows[0].r;assert.equal(empty.owner_id,f.other);assert.equal(empty.bank_source_coverage.counts.observations,0);await db.exec('reset role');
 });
 await serialSubtest(t,'SQL and model agree on other-year, connected discarded and missing connected sources',async()=>{
  const input=await f.input(2026);if(input.schema_version!=='tax-calculation-input/3')throw new Error('V3 required');await db.exec('reset role');
  const blocked=async(value:unknown)=>(await db.query<{r:boolean}>('select tax_bank_sources_blocked($1) r',[JSON.stringify(value)])).rows[0].r;
  assert.equal(bankTaxScope(input,input.bank_source_coverage).blocks,false);assert.equal(await blocked(input),false);
  input.records.push({id:'synthetic-context',record_type:'income',record_date:'2026-04-06',amount_pence:1,effect_sign:1,status:'approved',category:null,bank_transaction_id:foreign.transaction,original_bank_transaction_id:null,source_type:'csv'});
  assert.equal(bankTaxScope(input,input.bank_source_coverage).blocks,true);assert.equal(await blocked(input),true);
  input.bank_source_coverage.observations[0].import_status='discarded';input.bank_source_coverage.counts.active_blocked_observations=0;assert.equal(bankTaxScope(input,input.bank_source_coverage).blocks,true);assert.equal(await blocked(input),true);
  input.records[0].bank_transaction_id=randomUUID();assert.throws(()=>bankTaxScope(input,input.bank_source_coverage),/connected/);assert.equal(await blocked(input),true);
  await db.query("update record_imports set status='discarded' where id=$1",[foreign.imported]);const discarded=await f.input();if(discarded.schema_version!=='tax-calculation-input/3')throw new Error('V3 required');await db.exec('reset role');assert.equal(bankTaxScope(discarded,discarded.bank_source_coverage).blocks,false);assert.equal(await blocked(discarded),false);assert.equal(discarded.bank_source_coverage.counts.observations,1);
 });
});

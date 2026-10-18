import assert from 'node:assert/strict';
import test from 'node:test';
import {bankTaxPackFixture,foreignTaxBankFixture} from './bank-source-fixture';
import {bankSourceCoverageFixture,bankCoverageFixtureId as id} from '../records/bank-source-coverage-fixture';
import {parseBankSourceCoverage} from '../records/bank-source-coverage';
import {bankTaxScope,BANK_WITHHELD_TOTALS} from './bank-source-coverage';
import {packFixture,reviewFixture} from './filing-pack-fixture';
import {buildFilingPack,buildFilingReview,verifyFilingPack,type SavedFilingPack} from './filing-pack';
import {canonicalJson,sha256,verifySavedCalculation,prepareCalculation} from './snapshot';

test('empty current bank scope preserves native arithmetic while explicit older builders remain unchanged',()=>{
 const current=bankTaxPackFixture(),old=packFixture();assert.deepEqual(current.calculation.result,old.calculation.result);
 assert.equal(buildFilingPack(current,reviewFixture(current),'bank',true).schema_version,'draft-filing-pack/5');assert.equal(buildFilingPack(old,reviewFixture(old),'old',true).schema_version,'draft-filing-pack/2');
});
test('foreign original, reviewed-zero and missing native object withhold tax figures without altering recorded GBP effects',()=>{
 const bank=foreignTaxBankFixture();
 for(const zero of [false,true]){
  const b=structuredClone(bank);if(zero){b.observations[0].valuation={id:id(40),family_id:id(41),ordinal:1,state:'reviewed',signed_gbp_pence:'0',source_current:true};b.observations[0].valuation_status='reviewed_zero';b.counts.reviewed_zero_observations=1}
  const p=bankTaxPackFixture(b),r=p.calculation.result;assert.equal(r.status,'incomplete');for(const k of BANK_WITHHELD_TOTALS)assert.equal(r.totals[k],null,k);assert.equal(r.totals.ledger_income,packFixture().calculation.result.totals.ledger_income);
  assert.throws(()=>buildFilingPack(p,reviewFixture(p),'no',true),/completeness/);
 }
 const native=parseBankSourceCoverage(bankSourceCoverageFixture(id(1),1,2025),id(1));native.observations[0].classification='Personal';native.observations[0].source_available=false;const p=bankTaxPackFixture(native);assert.equal(p.calculation.result.status,'incomplete');assert.equal(bankTaxScope(p.calculation.input,native).source_unavailable_count,1);
 const forged=structuredClone(p.calculation);forged.result.totals.income_tax=0;forged.result_canonical_json=canonicalJson(forged.result);forged.result_sha256=sha256(forged.result_canonical_json);assert.throws(()=>verifySavedCalculation(forged,p.rules),/bank source/);
});
test('cash-year and connected evidence scope retains other-year/discarded context without a blanket foreign-account blocker',()=>{
 const bank=foreignTaxBankFixture();bank.observations[0].cash_date='2024-04-06';bank.observations[0].tax_year_start=2024;const p=bankTaxPackFixture(bank);assert.equal(p.calculation.result.status,'estimate');assert.equal(bankTaxScope(p.calculation.input,bank).source_count,0);
 p.calculation.input.records[0].bank_transaction_id=bank.observations[0].id;assert.equal(bankTaxScope(p.calculation.input,bank).blocks,true);
 bank.observations[0].import_status='discarded';bank.counts.active_blocked_observations=0;assert.equal(bankTaxScope(p.calculation.input,bank).blocks,true);p.calculation.input.records[0].bank_transaction_id=null;assert.equal(bankTaxScope(p.calculation.input,bank).blocks,false);
 p.calculation.input.records[0].bank_transaction_id=id(999);assert.throws(()=>bankTaxScope(p.calculation.input,bank),/connected/);
});
test('V5 invalidates every step and preserves bank dimensions in trace, manifest and recomputable ledger',()=>{
 const base=bankTaxPackFixture(),history=reviewFixture(base),changed=bankTaxPackFixture(foreignTaxBankFixture());assert.equal(buildFilingReview(changed,history).current.length,0);
 const bundle=buildFilingPack(changed,[],'bank-source',false);for(const name of ['calculation-trace.json','evidence-manifest.json'])assert.deepEqual(JSON.parse(bundle.artifacts.find(a=>a.name===name)!.body).bank_source_coverage,changed.bank_source_coverage);
 assert.match(bundle.artifacts.find(a=>a.name==='normalized-ledger.csv')!.body,/bank_source_coverage_context/);assert.match(bundle.artifacts.find(a=>a.name==='normalized-ledger.csv')!.body,/10001/);
 const row:SavedFilingPack={id:'pack',tax_year_start:2025,input:changed,input_canonical_json:canonicalJson(changed),input_sha256:bundle.input_sha256,bundle,bundle_canonical_json:canonicalJson(bundle),bundle_sha256:sha256(canonicalJson(bundle)),reason:'Synthetic',author:changed.owner_id,created_at:'2026-10-18',request_id:'bank-source'};assert.equal(verifyFilingPack(row).schema_version,'draft-filing-pack/5');
 for(const name of ['calculation-trace.json','evidence-manifest.json','normalized-ledger.csv']){
  const forged=structuredClone(row),a=forged.bundle.artifacts.find(a=>a.name===name)!;a.body=name.endsWith('.json')?canonicalJson({...JSON.parse(a.body),bank_source_coverage:{}}):a.body.replace('10001','10002');a.sha256=sha256(a.body);a.size_bytes=Buffer.byteLength(a.body);forged.bundle_canonical_json=canonicalJson(forged.bundle);forged.bundle_sha256=sha256(forged.bundle_canonical_json);assert.throws(()=>verifyFilingPack(forged),/bank/);
 }
 const mismatched=structuredClone(base);mismatched.bank_source_coverage.stamp='b'.repeat(64);assert.throws(()=>buildFilingReview(mismatched,[]),/match/);
 const missing=structuredClone(base.calculation.input);Reflect.deleteProperty(missing,'bank_source_coverage');assert.throws(()=>prepareCalculation(missing));
});
test('current source identities, native observation completeness and uniqueness reject contradictory or repeated ledger evidence',()=>{
 const bank=parseBankSourceCoverage(bankSourceCoverageFixture(id(1),1,2025),id(1));bank.observations[0].classification='Personal';const valid=bankTaxPackFixture(bank);
 for(const patch of [{signed_amount_pence:9999},{currency:'USD'},{transaction_date:'2025-04-07'},{file_hash:'d'.repeat(64)},{original_signed_minor:'9999'},{import_status:'discarded'}]){
  const input=structuredClone(valid);Object.assign(input.observations[0],patch);assert.throws(()=>buildFilingReview(input,[]),/coverage|units/);
  const calc=structuredClone(valid.calculation.input);Object.assign(calc.observations[0],patch);assert.throws(()=>prepareCalculation(calc),/coverage|units/);
 }
 const duplicate=structuredClone(valid);duplicate.observations.push({...duplicate.observations[0]});assert.throws(()=>buildFilingPack(duplicate,[],'duplicate',false),/Unique/);
 const missing=structuredClone(valid.calculation.input);missing.observations=[];assert.throws(()=>prepareCalculation(missing),/Complete native/);
 const repeated=structuredClone(valid.calculation.input);repeated.observations.push({...repeated.observations[0]});assert.throws(()=>prepareCalculation(repeated),/Unique/);
 const discarded=structuredClone(valid.calculation.input);if(discarded.schema_version!=='tax-calculation-input/3')throw new Error('V3 required');discarded.observations[0].import_status='discarded';discarded.bank_source_coverage.observations[0].import_status='discarded';assert.equal(bankTaxScope(discarded,discarded.bank_source_coverage).source_count,0);
});

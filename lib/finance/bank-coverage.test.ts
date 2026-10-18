import assert from 'node:assert/strict';
import test from 'node:test';
import { bankSourceCoverageFixture, bankCoverageFixtureId } from '../records/bank-source-coverage-fixture';
import { parseBankSourceCoverage } from '../records/bank-source-coverage';
import { syntheticCoverage, syntheticExternal } from '../invoices/currency-coverage-fixture';
import { financeFixture } from './test-fixture';
import { prepareFinancePlan, prepareCurrentFinancePlan, prepareBankCoveredFinancePlan, verifyFinancePlan, type SavedFinancePlan } from './snapshot';
import { canonicalJson, sha256 } from '../tax/snapshot';
import { financeScenario } from './coverage';
import { deadlineCatalogFromPlan } from './deadlines/snapshot';
import type { PlanRevision } from './server';
const owner=bankCoverageFixtureId(1),today='2026-10-17',catalog={accounts:[],documents:[]},plan=financeFixture(today);
const invoices=syntheticCoverage(owner);
const save=(p:ReturnType<typeof prepareBankCoveredFinancePlan>):SavedFinancePlan=>({input:p.input,result:p.result,input_canonical_json:p.inputJson,result_canonical_json:p.resultJson,rules_canonical_json:p.rulesJson,input_sha256:p.inputHash,result_sha256:p.resultHash,rules_sha256:p.rulesHash});
function prepared(bank=bankSourceCoverageFixture()){return prepareBankCoveredFinancePlan(owner,plan,today,catalog,invoices,parseBankSourceCoverage(bank,owner))}
test('bank V3 preserves the entered scenario and explicit historical version pairings',()=>{
 const one=prepareFinancePlan(owner,plan,today,catalog),two=prepareCurrentFinancePlan(owner,plan,today,catalog,invoices),three=prepared();
 assert.deepEqual(three.result.scenario,one.result);assert.deepEqual(three.result.scenario,two.result.scenario);assert.equal(three.rulesJson,two.rulesJson);assert.deepEqual(three.input.sources,two.input.sources);
 assert.equal(three.result.status,'estimate');assert.equal(three.result.current_free_cash_pence,two.result.current_free_cash_pence);assert.equal(financeScenario(three.result).pension_assets_pence,4305500);
 assert.deepEqual(verifyFinancePlan(save(three),owner).result,three.result);
 for(const prior of [one,two]){const row={...save(three),input:prior.input,result:prior.result,input_canonical_json:prior.inputJson,result_canonical_json:prior.resultJson,input_sha256:prior.inputHash,result_sha256:prior.resultHash};assert.deepEqual(verifyFinancePlan(row,owner).result,prior.result);}
 const wrong=save(three);wrong.result=two.result;wrong.result_canonical_json=two.resultJson;wrong.result_sha256=two.resultHash;assert.throws(()=>verifyFinancePlan(wrong,owner),/version/);
});
test('empty foreign accounts, missing active native objects and every foreign valuation state withhold drawings',()=>{
 const native=bankSourceCoverageFixture(owner,1);assert.equal(prepared(native).result.status,'estimate');native.observations[0].source_available=false;
 assert.equal(prepared(native).result.current_free_cash_pence,null);native.observations[0].import_status='discarded';assert.equal(prepared(native).result.status,'estimate');
 const empty=bankSourceCoverageFixture();empty.accounts.push({id:bankCoverageFixtureId(20),currency:'USD',representation:'foreign'});empty.counts.accounts=empty.counts.foreign_accounts=1;
 const p=prepared(empty);assert.equal(p.result.status,'incomplete');assert.equal(p.result.additional_drawings_ceiling_pence,null);
 for(const state of ['unvalued','provisional','reviewed','reviewed_zero','stale','withdrawn']){
  const b=parseBankSourceCoverage(bankSourceCoverageFixture(owner,1),owner);b.accounts[0].currency='KWD';b.accounts[0].representation='foreign';b.counts.native_accounts=0;b.counts.foreign_accounts=1;b.counts.native_observations=0;b.counts.foreign_observations=1;b.counts.active_blocked_observations=1;b.counts.reviewed_zero_observations=state==='reviewed_zero'?1:0;
  Object.assign(b.observations[0],{currency:'KWD',signed_amount_pence:null,original_signed_minor:'10001',ruleset_id:'vibecount-currencies/1',parser_version:'mapped-csv/2',representation:'foreign',valuation_status:state,valuation:state==='unvalued'?null:{id:bankCoverageFixtureId(50),family_id:bankCoverageFixtureId(51),ordinal:1,state:['provisional','withdrawn'].includes(state)?state:'reviewed',signed_gbp_pence:state==='reviewed_zero'?'0':'2500',source_current:['reviewed','reviewed_zero'].includes(state)}});
  const next=prepareBankCoveredFinancePlan(owner,plan,today,catalog,invoices,parseBankSourceCoverage(b,owner));assert.equal(next.result.status,'incomplete',state);assert.equal(next.result.current_free_cash_pence,null);assert.deepEqual(next.result.scenario,p.result.scenario);
 }
 const external=prepareBankCoveredFinancePlan(owner,plan,today,catalog,syntheticCoverage(owner,[syntheticExternal()]),parseBankSourceCoverage(bankSourceCoverageFixture(),owner));assert.equal(external.result.status,'incomplete');
});
test('retained bank results reject rehashed optimistic outputs and freeze owned inputs without altering deadline obligations',()=>{
 const b=bankSourceCoverageFixture(owner,1);b.observations[0].source_available=false;const p=prepared(b),row=save(p);b.observations[0].source_available=true;assert.equal(p.input.bank_source_coverage.observations[0].source_available,false);
 for(const key of ['current_free_cash_pence','additional_drawings_ceiling_pence','bank_coverage_stamp','status']){const forged=structuredClone(row);Object.assign(forged.result,{[key]:key==='status'?'estimate':key==='bank_coverage_stamp'?'f'.repeat(64):0});forged.result_canonical_json=canonicalJson(forged.result);forged.result_sha256=sha256(forged.result_canonical_json);assert.throws(()=>verifyFinancePlan(forged,owner),/replay/);}
 const revision:PlanRevision={...row,id:bankCoverageFixtureId(60),user_id:owner,author:owner,ordinal:1,expected_ordinal:0,context_stamp:'a'.repeat(32),request_id:bankCoverageFixtureId(61),rationale:'Synthetic bank scope',created_at:today};
 const deadlines=deadlineCatalogFromPlan(owner,2026,revision,[]);assert.deepEqual(deadlines.obligations,plan.obligations.filter(o=>o.kind==='tax'&&o.tax_year_start===2026).map(o=>({id:o.id,label:o.label,tax_year_start:2026,due_date:o.due_date,amount_pence:o.amount_pence})));
 for(const bad of [null,{}, {...bankSourceCoverageFixture(),owner_id:bankCoverageFixtureId(2)}])assert.throws(()=>prepareBankCoveredFinancePlan(owner,plan,today,catalog,invoices,bad as never));
});

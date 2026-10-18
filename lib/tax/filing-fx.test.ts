import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildFilingPack, buildFilingReview, verifyFilingPack, type SavedFilingPack } from './filing-pack';
import { canonicalJson, sha256 } from './snapshot';
import { reviewFixture } from './filing-pack-fixture';
import { filingFxFixture } from './filing-fx-fixture';
import { validateFilingFxContext } from './filing-fx-context';
import { syntheticCoverage } from '../invoices/currency-coverage-fixture';
test('retained filing input2/bundle3 bytes, reviews and artifact hashes stay frozen',()=>{
 const frozen=JSON.parse(readFileSync(new URL('../../fixtures/filing-pack-v3-frozen.json',import.meta.url),'utf8'));
 const body=canonicalJson(buildFilingPack(frozen.input,frozen.history,'frozen-v3',true));assert.equal(body,frozen.bundle);assert.equal(sha256(body),frozen.sha256);
});
test('filing V4 freezes FX context in three artifacts without changing recognised ledger effects or permitting completeness',()=>{
 const input=filingFxFixture(),reviews=reviewFixture(input),bundle=buildFilingPack(input,reviews,'fx-request',false);
 assert.equal(bundle.schema_version,'draft-filing-pack/4');assert.equal(bundle.artifacts.length,7);assert.equal(bundle.review_status,'draft_incomplete');
 assert.throws(()=>buildFilingPack(input,reviews,'fx-request',true),/completeness/);
 for(const name of ['calculation-trace.json','evidence-manifest.json'])assert.equal(JSON.parse(bundle.artifacts.find(a=>a.name===name)!.body).fx_provenance.events.length,3);
 const reconciliation=bundle.artifacts.find(a=>a.name==='invoice-payment-reconciliation.csv')!.body;assert.match(reconciliation,/fx_settlement_event/);assert.match(reconciliation,/KWD 0.001/);assert.match(reconciliation,/not_accounting_effects/);
 assert.equal(input.calculation.result.totals.ledger_income,202500);assert.equal(input.calculation.result.totals.income_tax,null);
 const row:SavedFilingPack={id:'pack',tax_year_start:2025,input,input_canonical_json:canonicalJson(input),input_sha256:bundle.input_sha256,bundle,bundle_canonical_json:canonicalJson(bundle),bundle_sha256:sha256(canonicalJson(bundle)),reason:'Synthetic',author:input.owner_id,created_at:'2026-10-18',request_id:'fx-request'};
 assert.equal(verifyFilingPack(row).schema_version,'draft-filing-pack/4');
 const changed=structuredClone(input);changed.fx_provenance.events[0].rationale='New retained context';assert.equal(buildFilingReview(changed,reviews).current.length,0);
 const missing=structuredClone(input);missing.fx_provenance.events.pop();assert.throws(()=>buildFilingReview(missing,[]));
 for(const patch of [{allocated_pence:2501},{unallocated_pence:0}]){const changed=structuredClone(input);Object.assign(changed.receipt_balances[0],patch);assert.throws(()=>buildFilingReview(changed,[]),/receipt cash/);}
 const clipped=structuredClone(input);clipped.receipt_balances=[];assert.throws(()=>buildFilingReview(clipped,[]),/receipt balance/);
 const wrongCash=structuredClone(input);Object.assign(wrongCash.receipt_balances[0],{signed_amount_pence:9999,unallocated_pence:7499});assert.throws(()=>buildFilingReview(wrongCash,[]),/source observation/);
 const unrelated=structuredClone(input);unrelated.receipt_balances.push({id:'unrelated',transaction_date:'2026-04-06',signed_amount_pence:100,allocated_pence:0,unallocated_pence:100});assert.throws(()=>buildFilingReview(unrelated,[]),/source observation/);
 const oldNative=structuredClone(input);oldNative.invoice_coverage=syntheticCoverage(input.owner_id,[...input.invoice_coverage.invoices,{id:'native',status:'finalised',origin:'native_gbp',currency:'GBP',invoice_date:'2025-08-01',amount:'1.00',original_total_minor:null,currency_ruleset_id:null,source_fact_revision_id:null,source_fact_family_id:null,native_balance_available:true,representation:'native_gbp'}]);
 oldNative.reconciliation.push({id:'allocation',kind:'settlement',data:{invoice_id:'native',transaction_id:'missing-historical-receipt',amount_pence:1,event_kind:'allocation',reverses_id:null}},{id:'reversal',kind:'settlement',data:{invoice_id:'native',transaction_id:'missing-historical-receipt',amount_pence:1,event_kind:'reversal',reverses_id:'allocation'}});assert.throws(()=>validateFilingFxContext(oldNative),/receipt balance/);
 const duplicate=structuredClone(input);duplicate.reconciliation.push({id:input.fx_provenance.events[0].id,kind:'settlement',data:{}});assert.throws(()=>buildFilingReview(duplicate,[]),/exactly once/);
 const forged=structuredClone(row),artifact=forged.bundle.artifacts.find(a=>a.name==='evidence-manifest.json')!,body=JSON.parse(artifact.body);body.fx_provenance.events=[];artifact.body=canonicalJson(body);artifact.sha256=sha256(artifact.body);artifact.size_bytes=Buffer.byteLength(artifact.body);forged.bundle_canonical_json=canonicalJson(forged.bundle);forged.bundle_sha256=sha256(forged.bundle_canonical_json);assert.throws(()=>verifyFilingPack(forged),/FX artifact provenance/);
 const csvForged=structuredClone(row),csv=csvForged.bundle.artifacts.find(a=>a.name==='invoice-payment-reconciliation.csv')!;csv.body=csv.body.replace('fx_settlement_event','omitted_fx_history');csv.sha256=sha256(csv.body);csv.size_bytes=Buffer.byteLength(csv.body);csvForged.bundle_canonical_json=canonicalJson(csvForged.bundle);csvForged.bundle_sha256=sha256(csvForged.bundle_canonical_json);assert.throws(()=>verifyFilingPack(csvForged),/FX reconciliation artifact/);
 const oversized=structuredClone(input);oversized.documents.push({id:'oversized',note:'x'.repeat(4000001)});assert.throws(()=>buildFilingReview(oversized,[]),/capacity/);
});

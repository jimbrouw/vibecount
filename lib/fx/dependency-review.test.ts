import assert from 'node:assert/strict';
import test from 'node:test';
import { importDependencyFixture } from './dependency-fixture';
import { importReversalDependencyReview } from './dependency-review';
import { sourceImportReversalReview } from '../records/import-reversal';
import { fxAuthoritativeReviewFixture } from './review-fixture';
import { fxLotReversalReadback } from './reversal-review';
import { fxSettlementChoices } from './settlement-catalog';
import { fxFixtureId as id } from './fixture';
test('V2 native context retains exact complete read-back; FX blockers withhold native financial totals',()=>{
 const f=importDependencyFixture();assert.deepEqual(importReversalDependencyReview(f.owner_id,f),sourceImportReversalReview(f.owner_id,f.native_context!));
 const b=importDependencyFixture(true),r=importReversalDependencyReview(b.owner_id,b);assert.equal(r.blocked,true);assert.equal(r.schema_version,'source-import-fx-blocked-review/1');assert.ok(!('income_delta_pence'in r));
 if(r.schema_version==='source-import-fx-blocked-review/1'){assert.equal(r.fx_blockers[0].cash_pence,0);assert.equal(r.fx_blockers[0].original_minor,1);}
});
test('FX blocker envelope rejects missing, foreign, inconsistent and partial sources and projects safe metadata',()=>{
 const f=importDependencyFixture(true);
 for(const patch of [{blocked:false},{native_context:importDependencyFixture().native_context},{owner_id:id(99)},{financial_stamp:''},{counts:{sources:f.sources.length,fx_blockers:0}}])assert.throws(()=>importReversalDependencyReview(f.owner_id,{...f,...patch}));
 for(const patch of [{user_id:id(99)},{receipt_id:id(99)},{active_count:0},{cash_pence:-1},{original_minor:0},{version:2},{source_row_id:id(99)}]){const c=structuredClone(f);Object.assign(c.fx_blockers[0],patch);assert.throws(()=>importReversalDependencyReview(f.owner_id,c));}
 const extra=structuredClone(f);Object.assign(extra,{raw:'PRIVATE'});Object.assign(extra.fx_blockers[0],{object_path:'PRIVATE'});Object.assign(extra.sources[0],{description:'PRIVATE'});const r=importReversalDependencyReview(f.owner_id,extra);assert.ok(!JSON.stringify(r).includes('PRIVATE'));extra.sources[0].transaction_date='2026-01-01';assert.notEqual(JSON.stringify(r),JSON.stringify(importReversalDependencyReview(f.owner_id,extra)));
});
test('complete retained-lot reversal has independent balances and works without current evidence',()=>{
 const c=fxAuthoritativeReviewFixture(true),intent={schema_version:'fx-lot-reversal-intent/1',lot_id:id(70),lot_version:1,expected_stamp:c.financial_stamp,rationale:'Synthetic retained source reversal',request_id:id(500)};
 const read=()=>fxLotReversalReadback(c.owner_id,intent,c).result;assert.equal(read().released_original_minor,5000);assert.equal(read().released_cash_pence,1250);assert.equal(read().outstanding_original_after_minor,10001);assert.equal(read().unallocated_cash_after_pence,2501);assert.equal(read().recognized_income_change_pence,0);
 for(const f of c.evidence.facts){f.usable=false;f.source_current=false;}c.evidence.documents[0].source.available=false;assert.ok(fxSettlementChoices(c).every(c=>!c.eligible));assert.equal(read().released_original_minor,5000);
 for(const patch of [{lot_id:id(99)},{lot_version:0},{expected_stamp:'0'.repeat(32)},{rationale:''},{raw:'PRIVATE'}])assert.throws(()=>fxLotReversalReadback(c.owner_id,{...intent,...patch},c));
 c.lots[0].active_count=0;c.lots[0].version=2;c.lots[0].prior_invoice_minor=0;c.lots[0].prior_cash_minor=0;c.invoices[0].allocated_minor=0;c.invoices[0].allocated_cash_pence=0;c.receipts[0].allocated_minor=0;assert.throws(()=>fxLotReversalReadback(c.owner_id,{...intent,lot_version:2},c),/active/);
});
test('an original receipt refund blocks new FX choices even without a refund-side scalar marker',()=>{
 const c=fxAuthoritativeReviewFixture();assert.equal(fxSettlementChoices(c)[0].eligible,true);c.receipts[0].active_refund_count=1;assert.equal(c.receipts[0].active_refund_id,null);assert.equal(fxSettlementChoices(c)[0].blocked_reason,'receipt_unavailable');
});

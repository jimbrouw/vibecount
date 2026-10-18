import assert from 'node:assert/strict';
import test from 'node:test';
import { fxHistoryFixture } from './history-fixture';
import { parseFxLotPortions, validateFxSettlementHistory } from './settlement-history';
import { completeFxLotReversalReadback } from './reversal-review';
import { fxFixtureId as id } from './fixture';
test('full immutable FX history recomputes cumulative allocations, copied LIFO reversals and reused counters',()=>{
 const f=fxHistoryFixture(),a=f.allocation(5000),b=f.allocation(5000,5000,1250,2),z=f.allocation(1,10000,2500,3),reversed=[f.reversal(z,4),f.reversal(b,5),f.reversal(a,6)],again=f.allocation(5000,0,0,7),history=[a,b,z,...reversed,again];
 const result=validateFxSettlementHistory(f.owner,[f.lot],history.reverse());assert.equal(result.lots[0].version,7);assert.equal(result.lots[0].active_count,1);assert.equal(result.lots[0].original_minor,5000);assert.equal(result.lots[0].cash_pence,1250);assert.equal(result.lots[0].events[2].amount_pence,0);assert.deepEqual(result.lots[0].active_ids,[again.id]);
 const before=JSON.stringify(result);history[0].rationale='Changed';assert.equal(JSON.stringify(result),before);
});
test('full history rejects omitted events, reordered suffix reversals, forged dimensions, ancestry and snapshots',()=>{
 const f=fxHistoryFixture(),a=f.allocation(5000),b=f.allocation(5000,5000,1250,2);
 for(const events of [[b],[a,a],[a,b,f.reversal(a,3)],[a,f.reversal(a,2),f.reversal(a,3)]])assert.throws(()=>validateFxSettlementHistory(f.owner,[f.lot],events));
 for(const patch of [{user_id:id(99)},{author:id(99)},{transaction_id:id(99)},{invoice_revision_id:id(99)},{invoice_minor:5001},{amount_pence:1249},{lot_event_ordinal:2},{reverses_id:id(99)}])assert.throws(()=>validateFxSettlementHistory(f.owner,[f.lot],[{...a,...patch}]));
 const bad=structuredClone(a);bad.fx_snapshot.tranche.after.rounding_delta_numerator='0';bad.fx_snapshot.tranche.before.target_minor=1;assert.throws(()=>validateFxSettlementHistory(f.owner,[f.lot],[bad]));
 const lot=structuredClone(f.lot);lot.invoice_fact.id=id(99);assert.throws(()=>validateFxSettlementHistory(f.owner,[lot],[a]));assert.throws(()=>validateFxSettlementHistory(f.owner,[f.lot,f.lot],[a]));assert.throws(()=>validateFxSettlementHistory(f.owner,[],[a]));
});
test('complete active review accepts retained ordered prefix with historical ordinal gaps and zero cash',()=>{
 const f=fxHistoryFixture(),a=f.allocation(5000),b=f.allocation(5000,5000,1250,4),z=f.allocation(1,10000,2500,5),raw=f.activeReview([a,b,z],5),r=parseFxLotPortions(f.owner,raw);
 assert.equal(r.active_count,3);assert.equal(r.original_minor,10001);assert.equal(r.cash_pence,2500);assert.equal(r.portions[2].amount_pence,0);
 for(const patch of [{version:4},{active_count:2},{financial_stamp:''},{owner_id:id(99)}])assert.throws(()=>parseFxLotPortions(f.owner,{...raw,...patch}));
 assert.throws(()=>parseFxLotPortions(f.owner,{...raw,portions:[b,a,z]}));assert.throws(()=>parseFxLotPortions(f.owner,{...raw,portions:[a,b]}));
 f.lot.invoice_fact.source_snapshot.document_source.available=false;f.lot.conversion_fact.source_snapshot.document_source.available=false;assert.equal(parseFxLotPortions(f.owner,raw).cash_pence,2500);
 const extra={...raw,object_path:'PRIVATE',portions:raw.portions.map(e=>({...e,bank_details:'PRIVATE'}))};assert.ok(!JSON.stringify(parseFxLotPortions(f.owner,extra)).includes('PRIVATE'));
});

test('complete reversal binds every active portion and fresh head to the aggregate current balance review',()=>{
 const f=fxHistoryFixture(),c=f.catalog,intent={schema_version:'fx-lot-reversal-intent/1',lot_id:f.lot.id,lot_version:1,expected_stamp:c.financial_stamp,rationale:'Synthetic complete portion review',request_id:id(500)};
 const raw=f.activeReview(),r=completeFxLotReversalReadback(f.owner,intent,c,raw);assert.equal(r.result.schema_version,'fx-lot-reversal-review/2');assert.equal(r.result.portions.length,1);
 const parsed=parseFxLotPortions(f.owner,raw);assert.deepEqual(parseFxLotPortions(f.owner,parsed),parsed);assert.deepEqual(completeFxLotReversalReadback(f.owner,intent,c,parsed),r);
 for(const patch of [{financial_stamp:'b'.repeat(32)},{active_count:0},{version:3}])assert.throws(()=>completeFxLotReversalReadback(f.owner,intent,c,{...raw,...patch}));
 const missing={...raw,portions:[]};assert.throws(()=>completeFxLotReversalReadback(f.owner,intent,c,missing));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { fxProvenanceFixture } from './provenance-fixture';
import { parseFxProvenance } from './provenance';
import { fxFixtureId as id } from './fixture';

test('retained source provenance binds complete history to authoritative heads and immutable receipt observations', () => {
  const f = fxProvenanceFixture(), parsed = parseFxProvenance(f.owner, f.raw, f.sources);
  assert.equal(parsed.events[2].amount_pence,0);assert.equal(parsed.lots[0].event_count,3);
  assert.deepEqual(parseFxProvenance(f.owner,parsed,f.sources),parsed);
  assert.throws(()=>parseFxProvenance(f.owner,f.raw,[]),/source observation/);
  for (const field of ['import_id','source_row_id','transaction_date','currency'] as const)
    assert.throws(()=>parseFxProvenance(f.owner,f.raw,[{...f.sources[0],[field]:'wrong'}]));
  assert.throws(()=>parseFxProvenance(f.owner,f.raw,[{...f.sources[0],signed_amount_pence:2500}]));
  const reversed=structuredClone(f.raw);reversed.events.push(f.reversal(reversed.events[2],4),f.reversal(reversed.events[1],5),f.reversal(reversed.events[0],6));
  reversed.lots[0].event_count=6;reversed.lots[0].active_count=0;reversed.counts.events=6;
  assert.equal(parseFxProvenance(f.owner,reversed,f.sources).events.length,6);
  // Omitting an entire final reversal suffix can otherwise leave valid ordinals/arithmetic.
  const clipped=structuredClone(reversed);clipped.events=clipped.events.slice(0,3);clipped.counts.events=3;
  assert.throws(()=>parseFxProvenance(f.owner,clipped,f.sources),/authoritative event head/);
  for(const patch of [{owner_id:'foreign'},{counts:{lots:0,events:3}},{events:[]},{lots:[]}])assert.throws(()=>parseFxProvenance(f.owner,{...f.raw,...patch},f.sources));
  const extra={...f.raw,object_path:'PRIVATE',lots:f.raw.lots.map(l=>({...l,key_id:'PRIVATE'}))};
  assert.ok(!JSON.stringify(parseFxProvenance(f.owner,extra,f.sources)).includes('PRIVATE'));
  assert.throws(()=>parseFxProvenance(f.owner,{...f.raw,extra:'x'.repeat(2000001)},f.sources));
});
test('shared FX capacity is independently bounded across individually valid retained lots',()=>{
 const make=()=>{
  const f=fxProvenanceFixture(),a=f.allocation(6000),first={...f.raw.lots[0],event_count:1,active_count:1},second=structuredClone(first);
  Object.assign(second,{id:id(801),conversion_family_id:id(802),conversion_fact_revision_id:id(803),conversion_document_id:id(804)});
  Object.assign(second.conversion_fact,{id:id(803),family_id:id(802),document_id:id(804)});second.conversion_fact.source_snapshot.document_source.document.id=id(804);
  const b=structuredClone(a);Object.assign(b,{id:id(805),conversion_lot_id:second.id});Object.assign(b.fx_snapshot,{lot_id:second.id,conversion_fact_revision_id:second.conversion_fact_revision_id});
  return{...f,raw:{...f.raw,counts:{lots:2,events:2},lots:[first,second],events:[a,b]}};
 };
 const cash=make();cash.raw.lots[1].invoice_id=id(806);cash.raw.lots[1].invoice_snapshot.invoice_id=id(806);cash.raw.events[1].invoice_id=id(806);cash.raw.events[1].invoice_snapshot.invoice_id=id(806);
 assert.throws(()=>parseFxProvenance(cash.owner,cash.raw,cash.sources),/Shared FX receipt cash/);
 const original=make();original.sources[0].signed_amount_pence=5000;
 for(const l of original.raw.lots)l.conversion_fact.source_snapshot.receipt!.signed_amount_pence=5000;
 for(const e of original.raw.events){e.fx_snapshot.observed_cash_pence=5000;e.fx_snapshot.receipt_recognized_gbp_pence=5000;}
 assert.throws(()=>parseFxProvenance(original.owner,original.raw,original.sources),/Shared FX original invoice/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { checkSettlementSources, parseSettlementSourceCheck } from './settlement-source';
import { settlementSourceFixture } from './settlement-source-fixture';
import { fxFixtureId as id } from './fixture';
test('full-intent source verification reads both distinct documents and deduplicates shared bytes without dropping fact bindings',async()=>{
 for(const separate of [false,true]){const f=settlementSourceFixture(separate),result=await checkSettlementSources(f.owner,f.intent,f.dependencies);assert.equal(result.outcome,'verified');assert.equal(result.sources.length,2);assert.equal(f.calls.filter(c=>c==='download').length,separate?2:1);assert.ok(f.keys.every(k=>k.every(b=>b===0)));assert.equal(f.calls[0],'recover');assert.equal(f.calls.at(-1),'record');assert.ok(!JSON.stringify(result).includes('.enc'));assert.ok(!JSON.stringify(result).includes('key_id'));assert.deepEqual(parseSettlementSourceCheck(f.owner,{...result,raw_text:'PRIVATE'}),result);}
});
test('private metadata failures precede object access; cryptographic failures audit unavailable and uncertain audits never claim success',async()=>{
 for(const failure of ['foreign','path','key','download','tamper','audit','forged','catalog']){const f=settlementSourceFixture(true);f.state.failure=failure;
  if(['audit','forged','catalog'].includes(failure))await assert.rejects(checkSettlementSources(f.owner,f.intent,f.dependencies));
  else assert.equal((await checkSettlementSources(f.owner,f.intent,f.dependencies)).outcome,'unavailable');
  if(['foreign','path'].includes(failure))assert.equal(f.calls.filter(c=>c==='download').length,0);
  assert.ok(f.keys.every(k=>k.every(b=>b===0)));
 }
});
test('exact proof retries recover before mutable sources and preserve unavailable outcomes; altered requests and malformed ancestry fail closed',async()=>{
 for(const unavailable of [false,true]){const f=settlementSourceFixture();if(unavailable)f.state.failure='tamper';const old=await checkSettlementSources(f.owner,f.intent,f.dependencies);f.calls.length=0;f.state.failure='catalog';assert.deepEqual(await checkSettlementSources(f.owner,f.intent,f.dependencies),old);assert.deepEqual(f.calls,['recover']);await assert.rejects(checkSettlementSources(f.owner,{...f.intent,rationale:'Changed financial request'},f.dependencies),/request changed/);
  for(const patch of [{user_id:id(999)},{author:id(999)},{request_id:id(999)},{sources:old.sources.slice(1)},{checked_at:'invalid'},{outcome:['verified']},{raw:'x'.repeat(2200000)}])assert.throws(()=>parseSettlementSourceCheck(f.owner,{...old,...patch}));
  for(const field of ['family_id','document_id'] as const){const bad=structuredClone(old),conversion=bad.sources.find(s=>s.kind==='conversion')!;conversion.source_snapshot.invoice_evidence![field]=id(999);assert.throws(()=>parseSettlementSourceCheck(f.owner,bad),/ancestry/);}
 }
});
test('one full-intent proof retains both invoices and both conversion facts without creating duplicate object reads',async()=>{
 const f=settlementSourceFixture(),invoice=structuredClone(f.catalog.evidence.facts.find(r=>r.kind==='invoice')!),conversion=structuredClone(f.catalog.evidence.facts.find(r=>r.kind==='conversion')!);
 const secondInvoice=id(910),secondRevision=id(911);invoice.id=id(912);invoice.family_id=id(913);conversion.id=id(914);conversion.family_id=id(915);conversion.invoice_evidence_revision_id=invoice.id;
 conversion.source_snapshot.invoice_evidence={...conversion.source_snapshot.invoice_evidence!,id:invoice.id,family_id:invoice.family_id};
 f.catalog.evidence.facts.push(invoice,conversion);f.catalog.evidence.counts.facts+=2;
 f.catalog.invoices.push({...f.catalog.invoices[0],id:secondInvoice,revision_id:secondRevision,source_fact_revision_id:invoice.id});f.catalog.counts.invoices++;
 const first={...f.intent.allocations[0],invoice_minor:1,cash_minor:0},second={...first,invoice_id:secondInvoice,invoice_revision_id:secondRevision,invoice_evidence_id:invoice.family_id,invoice_evidence_revision_id:invoice.id,conversion_evidence_id:conversion.family_id,conversion_evidence_revision_id:conversion.id,conversion_lot_id:id(916)};
 const result=await checkSettlementSources(f.owner,{...f.intent,allocations:[second,first]},f.dependencies);
 assert.equal(result.outcome,'verified');assert.equal(result.intent.allocations.length,2);assert.equal(result.sources.length,4);assert.equal(f.calls.filter(c=>c==='download').length,1);
 assert.deepEqual(result.intent.allocations.map(a=>a.invoice_id),[first.invoice_id,secondInvoice]);
});

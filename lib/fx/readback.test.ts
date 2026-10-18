import assert from 'node:assert/strict';
import test from 'node:test';
import { fxAmountReadback,fxIntegerWords,fxRateReadback } from './readback';
import { rateFromDecimal } from './currency';
import { fxDocumentFactsFixture } from './document-facts-fixture';
import { parseFxEvidenceHistory,validateFxEvidenceResult } from './document-facts';
import { fxFixtureId as id } from './fixture';
test('currency read-back preserves zero, zero/three-decimal scales, signed values and large exact integers',()=>{
    assert.equal(fxAmountReadback(100000,'USD'),'USD 1000.00 (one thousand US dollars)');
    assert.equal(fxAmountReadback(1,'JPY'),'JPY 1 (one yen)');
    assert.equal(fxAmountReadback(1001,'KWD'),'KWD 1.001 (one Kuwaiti dinar and one fil)');
    assert.equal(fxAmountReadback(-1002,'KWD'),'KWD -1.002 (minus one Kuwaiti dinar and two fils)');
    assert.equal(fxAmountReadback(0,'GBP'),'GBP 0.00 (zero pounds)');
    assert.match(fxAmountReadback(999999999999,'JPY'),/nine hundred and ninety-nine billion/);
    assert.equal(fxIntegerWords('999999999999999999'),'nine hundred and ninety-nine quadrillion nine hundred and ninety-nine trillion nine hundred and ninety-nine billion nine hundred and ninety-nine million nine hundred and ninety-nine thousand nine hundred and ninety-nine');
    for(const n of ['1.0','01','1e4','-1','1000000000000000000'])assert.throws(()=>fxIntegerWords(n));
    assert.throws(()=>fxAmountReadback(1.2,'USD'));assert.throws(()=>fxAmountReadback(Number.MAX_SAFE_INTEGER,'USD'));
});
test('rate read-back retains exact normalized direction and fraction without floating point',()=>{
    assert.equal(fxRateReadback(rateFromDecimal('USD','GBP','0.79')),'79/100 GBP per 1 USD (seventy-nine divided by one hundred GBP for one USD)');
    assert.match(fxRateReadback({direction:'target_major_per_source_major',source_currency:'JPY',target_currency:'GBP',numerator:'999999999999999998',denominator:'999999999999999999'}),/quadrillion/);
});
test('history is owner-scoped, bounded, redacted and detached, with no claimed live source eligibility',()=>{
    const f=fxDocumentFactsFixture(),row={...f.invoice,user_id:f.owner,author:f.owner,created_at:'2026-10-17T10:00:00+00:00',rationale:'Source account 12345678',object_path:'PRIVATE'};
    const history=parseFxEvidenceHistory(f.owner,[row]);assert.equal(history[0].usable,false);assert.equal(history[0].source_current,false);assert.equal(history[0].author,f.owner);assert.ok(!JSON.stringify(history).includes('12345678'));assert.ok(!JSON.stringify(history).includes('PRIVATE'));
    const saved=JSON.stringify(history);(row.data as {original_total_minor:number}).original_total_minor=1;assert.equal(JSON.stringify(history),saved);
    for(const patch of [{user_id:id(99)},{author:id(99)},{created_at:'bad'},{rationale:null},{source_snapshot:null}])assert.throws(()=>parseFxEvidenceHistory(f.owner,[{...row,...patch}]));
    assert.throws(()=>parseFxEvidenceHistory(f.owner,[row,row]));assert.throws(()=>parseFxEvidenceHistory(f.owner,Array(22).fill(row)));
});
test('evidence result requires exact saved identity/state and zero financial effects',()=>{
    const f=fxDocumentFactsFixture(),result={family_id:f.intent.family_id,revision_id:id(90),ordinal:1,state:f.intent.state,kind:f.intent.kind,financial_action:'evidence_preparation_only',recognized_income_change_pence:0,recognized_expense_change_pence:0,canonical_invoice_change:0,settlement_change:0};
    assert.equal(validateFxEvidenceResult(result,f.intent).revision_id,id(90));
    for(const patch of [{family_id:id(99)},{ordinal:2},{state:'provisional'},{recognized_income_change_pence:1},{settlement_change:1},{extra:'PRIVATE'},{revision_id:'bad'}])assert.throws(()=>validateFxEvidenceResult({...result,...patch},f.intent));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { fxDocumentFactsFixture } from './document-facts-fixture';
import { fxFixtureId as id } from './fixture';
import { fxDocumentFactReadback, parseFxEvidenceCatalog, validateFxDocumentFactIntent, validateFxDocumentData } from './document-facts';
import { readFxEvidenceCatalog } from './document-facts-store';
import { rateFromDecimal } from './currency';

test('typed document facts require exact original amounts, supported proof and explicit human review',()=>{
    const f=fxDocumentFactsFixture();assert.deepEqual(validateFxDocumentFactIntent(f.intent),f.intent);
    for(const patch of [{extra:'PRIVATE'},{human_read_original:false},{kind:new String('invoice')},{expected_ordinal:null},{expected_stamp:f.intent.expected_stamp+'\n'},{document_id:null},{transaction_id:id(99)},{ruleset_id:'future'},{state:'approved'}])assert.throws(()=>validateFxDocumentFactIntent({...f.intent,...patch}));
    for(const patch of [{currency:'XYZ'},{original_total_minor:'100000'},{original_total_minor:0},{original_total_minor:1.1},{invoice_reference:'FX-100\n'},{invoice_date:'2026-02-30'},{raw_pdf:'PRIVATE'}])assert.throws(()=>validateFxDocumentData('invoice',{...f.intent.data,...patch}));
    const data=f.conversion.data as object;
    for(const patch of [{fee_mode:'withheld'},{rate:rateFromDecimal('GBP','USD','0.79')},{gbp_cash_portion_pence:78999},{invoice_portion_minor:0},{evidence_date:'2026-02-30'},{storage_path:'PRIVATE'}])assert.throws(()=>validateFxDocumentData('conversion',{...data,...patch}));
    const raw={...f.conversion,data:{...data,rate:{...rateFromDecimal('USD','GBP','0.79'),numerator:'158',denominator:'200'}},family_id:f.conversion.family_id.toUpperCase(),rationale:' Source account 12345678 '};
    const normalized=validateFxDocumentFactIntent(raw);assert.equal((normalized.data as {rate:{numerator:string}}).rate.numerator,'79');assert.ok(!normalized.rationale.includes('12345678'));
});
test('evidence read-back preserves invoice/cash dates and reserves or posts no money',()=>{
    const f=fxDocumentFactsFixture(),a=fxDocumentFactReadback(f.owner,f.intent,f.catalog);
    assert.equal(a.result.financial_action,'evidence_preparation_only');assert.equal(a.result.recognized_income_change_pence,0);
    f.catalog.facts.push(f.invoice);f.catalog.counts.facts=1;
    const c=fxDocumentFactReadback(f.owner,f.conversion,f.catalog);
    assert.equal(c.result.comparison!.target_minor,79000);assert.equal(c.result.receipt!.transaction_date,'2026-04-06');assert.equal((c.result.invoice!.data as {invoice_date:string}).invoice_date,'2026-04-05');
    const changed=structuredClone(f.catalog);changed.facts[0].usable=false;changed.facts[0].state='provisional';changed.facts[0].human_read_original=false;
    assert.throws(()=>fxDocumentFactReadback(f.owner,f.conversion,changed));
    for(const patch of [{decision_version:1},{import_status:'discarded'}]){const context=structuredClone(f.catalog);Object.assign(context.receipts[0],patch);assert.throws(()=>fxDocumentFactReadback(f.owner,f.conversion,context));}
    assert.throws(()=>fxDocumentFactReadback(f.owner,{...f.intent,family_id:id(99)},f.catalog),/existing reviewed invoice/);
});
test('withdrawal uses retained evidence even when its live source is unavailable',()=>{
    const f=fxDocumentFactsFixture();f.catalog.facts.push({...f.invoice,source_current:false,usable:false});f.catalog.counts.facts=1;f.catalog.documents[0].source.available=false;
    const undo={...f.intent,expected_ordinal:1,state:'withdrawn',document_id:null,data:null,human_read_original:false};
    const result=fxDocumentFactReadback(f.owner,undo,f.catalog);assert.deepEqual(result.result.retained_data,f.invoice.data);assert.equal(result.result.retained_source_current,false);
    assert.throws(()=>validateFxDocumentFactIntent({...undo,data:f.intent.data}));
    assert.throws(()=>fxDocumentFactReadback(f.owner,{...undo,expected_ordinal:0},f.catalog),/revision|context/);
});
test('safe catalog validates counts and ownership and detaches all projected source metadata',async()=>{
    const f=fxDocumentFactsFixture();f.catalog.facts.push(f.invoice);f.catalog.counts.facts=1;
    Object.assign(f.source.document,{object_path:'PRIVATE',key_id:'PRIVATE'});Object.assign(f.receipt,{description:'PRIVATE',raw_cells:['PRIVATE']});Object.assign(f.invoice,{rationale:'PRIVATE'});
    const safe=parseFxEvidenceCatalog(f.owner,f.catalog),saved=JSON.stringify(safe);assert.ok(!saved.includes('PRIVATE'));
    f.source.document.file_sha256='c'.repeat(64);f.receipt.signed_amount_pence=1;(f.invoice.data as {original_total_minor:number}).original_total_minor=1;assert.equal(JSON.stringify(safe),saved);
    for(const patch of [{counts:{documents:0,receipts:1,facts:1}},{owner_id:id(99)},{documents:[]},{facts:[...f.catalog.facts,...f.catalog.facts]}])assert.throws(()=>parseFxEvidenceCatalog(f.owner,{...f.catalog,...patch}));
    const fresh=fxDocumentFactsFixture();fresh.catalog.receipts[0].user_id=id(99);assert.throws(()=>parseFxEvidenceCatalog(fresh.owner,fresh.catalog));
    const calls:string[]=[];const db={rpc:async(name:string)=>{calls.push(name);return{data:fxDocumentFactsFixture().catalog,error:null};}};
    const read=await readFxEvidenceCatalog(db,f.owner);assert.equal(read.owner_id,f.owner);assert.deepEqual(calls,['read_fx_evidence_catalog']);
    await assert.rejects(readFxEvidenceCatalog({rpc:async()=>({data:f.catalog,error:{message:'PRIVATE'}})},f.owner),/unavailable/);
});

test('fresh invoice read-back rejects a general registration even when invoice scope exists',()=>{
    const f=fxDocumentFactsFixture();f.source.registration.purpose='employment';f.source.registration.tax_year_start=2024;
    assert.throws(()=>fxDocumentFactReadback(f.owner,f.intent,f.catalog),/source scope/);
});

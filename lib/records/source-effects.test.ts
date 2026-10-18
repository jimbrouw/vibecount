import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceLedger, sourceRecordEffects, type SourceExportRow, type SourceRefundPortion } from './source-export';
import { evidenceManifest } from './evidence-manifest';
import { readSourceCsv } from './source-csv';
import { attachSourceEffects } from './source-effect-store';
const meta={id:'import',file_hash:'a'.repeat(64),parser_version:'mapped-csv/1',account_id:'account',status:'review',created_at:'2026-10-17',coverage_start:null,coverage_end:null,account_label:'Synthetic bank',account_mask:'1234'};
function fixture():SourceExportRow{
    const portion=(id:string,amount:number,recognized:number,category:string,bps:number):SourceRefundPortion=>({id,original_transaction_id:'original-'+id,refund_transaction_id:'refund',amount_pence:amount,recognized_pence:recognized,record_type:'expense',business_use_bps:bps,category_id:category,request_id:'request',original:{id:'original-'+id,import_id:'original-import-'+id,source_row_id:'original-row-'+id,transaction_date:'2026-04-05'},reversals:[]});
    return {id:'refund',transaction_date:'2026-04-10',signed_amount_pence:50000,currency:'GBP',description:'Synthetic refund',reference:'',classification:'Refund',business_use_bps:0,dedupe_status:'clear',decision_version:2,active_refund_id:'a',source_row_id:'row',tax_year_start:2026,source_rows:{row_number:2,row_hash:'b'.repeat(64)},
        record:[{id:'old',amount:'500.00',record_type:'income',effect_sign:1,status:'excluded',bank_transaction_id:'refund'},
            {id:'child-a',amount:'90.00',record_type:'expense',effect_sign:-1,status:'approved',bank_transaction_id:'refund',refund_link_id:'a',category_id:'cat-a',project_id:'project-a'},
            {id:'child-b',amount:'90.00',record_type:'expense',effect_sign:-1,status:'approved',bank_transaction_id:'refund',refund_link_id:'b',category_id:'cat-b',project_id:'project-b'}],
        refund_portions:[portion('a',30000,9000,'cat-a',3000),portion('b',20000,9000,'cat-b',4500)]};
}
test('source exports count refund cash once while retaining every effect, category/project and source chain',()=>{
    const row=fixture(),before=JSON.stringify(row),ledger=evidenceLedger(meta,[row]),csv=readSourceCsv(ledger.csv),header=csv[0],data=csv[1];
    assert.equal(csv.length,2);assert.equal(data[header.indexOf('signed_amount_pence')],'50000');assert.equal(data[header.indexOf('recognized_pence')],'-18000');assert.equal(ledger.expensePence,-18000);assert.equal(ledger.incomePence,0);
    assert.equal(data[header.indexOf('financial_record_id')],'');assert.equal(JSON.parse(data[header.indexOf('financial_records_json')]).length,3);assert.equal(data[header.indexOf('financial_record_count')],'3');
    const manifest=evidenceManifest(meta,{label:'Synthetic bank',masked_identifier:'1234'},[row]);
    assert.equal(manifest.schema_version,'vibecount.evidence-manifest/2');assert.equal(manifest.snapshot.transaction_count,1);assert.equal(manifest.snapshot.recognized_expense_pence,'-18000');
    assert.deepEqual(manifest.snapshot.transactions[0].financial_records.map(r=>r.id),['child-a','child-b','old']);assert.deepEqual(manifest.snapshot.transactions[0].refund_portions.map(p=>p.original_source.source_row_id),['original-row-a','original-row-b']);
    assert.equal(JSON.stringify(row),before);
    const reversed=structuredClone(row);(reversed.record as unknown[]).reverse();reversed.refund_portions!.reverse();assert.deepEqual(evidenceManifest(meta,{label:'Synthetic bank',masked_identifier:'1234'},[reversed]),manifest);
    Object.assign((row.record as object[])[0],{raw_encrypted:'PRIVATE',object_path:'PRIVATE'});Object.assign(row.refund_portions![0],{raw_bank_pdf:'PRIVATE'});assert.ok(!JSON.stringify(evidenceManifest(meta,{label:'Synthetic bank',masked_identifier:'1234'},[row])).includes('PRIVATE'));
});
test('zero-recognised portions retain cash provenance; clipped links or child effects reject rather than understate totals',()=>{
    const row=fixture();row.signed_amount_pence=2;const portions=row.refund_portions!;Object.assign(portions[0],{amount_pence:1,recognized_pence:0});Object.assign(portions[1],{amount_pence:1,recognized_pence:1});
    row.record=[{id:'child-b',amount:'0.01',record_type:'expense',effect_sign:-1,status:'approved',bank_transaction_id:'refund',refund_link_id:'b',category_id:'cat-b'}];
    const effects=sourceRecordEffects(row);assert.equal(effects.expensePence,-1);assert.equal(effects.refundPortions.length,2);assert.equal(effects.refundPortions[0].recognized_pence,0);
    const missing=structuredClone(row);missing.record=[];assert.throws(()=>sourceRecordEffects(missing),/approved refund portion effects/);
    const clipped=structuredClone(row);clipped.refund_portions!.pop();assert.throws(()=>sourceRecordEffects(clipped),/refund cash allocation/);
});
test('reversed portions retain immutable cash and effect history while current recognition remains zero',()=>{
    const row=fixture();row.classification='Unknown';row.active_refund_id=null;for(const r of row.record as {status:string}[])r.status='excluded';
    row.refund_portions![0].reversals={id:'reversal-a'};row.refund_portions![1].reversals=[{id:'reversal-b'}];
    const e=sourceRecordEffects(row);assert.equal(e.expensePence,0);assert.equal(e.incomePence,0);assert.equal(e.refundPortions.length,2);assert.ok(e.refundPortions.every(p=>!p.active));assert.equal(e.records.length,3);
});
test('duplicate/cross-source records, wrong buckets and malformed active effects cannot produce a source export',()=>{
    for(const change of [
        (r:SourceExportRow)=>{(r.record as object[]).push((r.record as object[])[0]);},
        (r:SourceExportRow)=>{Object.assign((r.record as object[])[1],{bank_transaction_id:'another'});},
        (r:SourceExportRow)=>{Object.assign((r.record as object[])[1],{record_type:'income'});},
        (r:SourceExportRow)=>{Object.assign((r.record as object[])[0],{status:'approved'});},
        (r:SourceExportRow)=>{r.refund_portions![0].original=null;},
        (r:SourceExportRow)=>{r.refund_portions!.push(r.refund_portions![0]);},
    ]){const row=fixture();change(row);assert.throws(()=>sourceRecordEffects(row));}
    const row=fixture();assert.throws(()=>evidenceLedger(meta,[row,row]),/Duplicate source/);
});
test('source effect loader pages both child tables independently beyond server caps with explicit owner and import joins',async()=>{
    const row=fixture(),records=Array.from({length:1003},(_,i)=>({id:String(i).padStart(6,'0'),bank_transaction_id:'refund',status:'excluded',amount:'1.00'})),portions=Array.from({length:1002},(_,i)=>({...row.refund_portions![0],id:String(i).padStart(6,'0')}));
    const calls:{table:string;columns:string;filters:[string,unknown][];cursor:string|null}[]=[];let fail=false,foreign=false;
    const db={from(table:string){let cursor:string|null=null,columns='';const filters:[string,unknown][]=[];const q={select(s:string){columns=s;return q},eq(k:string,v:unknown){filters.push([k,v]);return q},order(){return q},limit(){return q},gt(k:string,v:string){cursor=v;return q},then(resolve:(r:unknown)=>unknown){calls.push({table,columns,filters,cursor});let rows: {id:string}[]=table==='financial_records'?records:portions;rows=rows.filter(r=>!cursor||r.id>cursor).slice(0,137);return Promise.resolve({data:foreign&&table==='financial_records'?rows.map(r=>({...r,bank_transaction_id:'foreign'})):rows,error:fail&&cursor?{}:null}).then(resolve)}};return q}} as unknown as Parameters<typeof attachSourceEffects>[0];
    const result=await attachSourceEffects(db,'owner','import',[row]);assert.equal((result[0].record as object[]).length,1003);assert.equal(result[0].refund_portions!.length,1002);assert.ok(calls.length>16);
    for(const c of calls){assert.ok(c.filters.some(([k,v])=>k==='user_id'&&v==='owner'));assert.ok(c.filters.some(([k,v])=>k.endsWith('.import_id')&&v==='import'));assert.ok(c.columns.includes('!inner(import_id)'));}
    fail=true;await assert.rejects(attachSourceEffects(db,'owner','import',[row]),/complete export/);fail=false;foreign=true;await assert.rejects(attachSourceEffects(db,'owner','import',[row]),/outside the complete owned import/);
});

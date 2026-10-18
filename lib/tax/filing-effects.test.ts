import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { packFixture, reviewFixture } from './filing-pack-fixture';
import { buildFilingPack, buildFilingReview, verifyFilingPack, type SavedFilingPack } from './filing-pack';
import { prepareCalculation, sha256 } from './snapshot';
import { readSourceCsv } from '../records/source-csv';

test('frozen predecessor v1 pack still verifies and returns its original seven artifact bytes',async()=>{
    const row=JSON.parse(await readFile(new URL('../../fixtures/legacy-filing-pack-v1.json',import.meta.url),'utf8')) as SavedFilingPack;
    assert.equal(row.bundle.schema_version,'draft-filing-pack/1');const old=JSON.stringify(row.bundle.artifacts);
    assert.equal(verifyFilingPack(row),row.bundle);assert.equal(JSON.stringify(row.bundle.artifacts),old);
    for(const artifact of row.bundle.artifacts)assert.equal(sha256(artifact.body),artifact.sha256);
    assert.ok(!row.bundle.artifacts.find(a=>a.name==='normalized-ledger.csv')!.body.includes('year_financial_records'));
});
test('current-year postings retain their effect when the cash source is outside the year, with a blocking timing exception',()=>{
    const input=packFixture(),c=input.calculation.input;c.records[1].bank_transaction_id='prior-year-cash';c.records[1].source_type='csv';
    input.observations.push({id:'prior-year-cash',source_row_id:'prior-row',import_id:'prior-import',account_id:'account',masked_identifier:'1234',row_number:2,file_hash:'a'.repeat(64),row_hash:'b'.repeat(64),transaction_date:'2025-04-05',signed_amount_pence:-63029,in_tax_year:false,record_type:'expense'});
    const p=prepareCalculation(c);Object.assign(input.calculation,{result:p.result,input_canonical_json:p.inputJson,result_canonical_json:p.resultJson,input_sha256:p.inputHash,result_sha256:p.resultHash});
    const history=reviewFixture(input),review=buildFilingReview(input,history);assert.ok(review.issues.some(i=>i.code==='posting_source_date'&&i.blocking));assert.equal(review.canAttest,false);
    const csv=readSourceCsv(buildFilingPack(input,history,'timing-exception',false).artifacts.find(a=>a.name==='normalized-ledger.csv')!.body),header=csv[0],row=csv.find(r=>r[header.indexOf('id')]==='prior-year-cash')!;
    assert.equal(row[header.indexOf('year_expense_pence')],'18909');assert.equal(row[header.indexOf('context_only')],'false');assert.equal(row[header.indexOf('in_tax_year')],'false');
    input.observations=[];assert.throws(()=>buildFilingReview(input,history),/financial-record source closure/);
});
test('new filing ledger counts cash once, sums every approved child and retains excluded link/project provenance',()=>{
    const input=packFixture(),c=input.calculation.input;
    const base={...c.records[1],bank_transaction_id:'shared-refund',source_type:'csv'};
    c.records.push({...base,id:'child-a',amount_pence:9000,effect_sign:-1,refund_link_id:'link-a',project_id:'project-a',original_bank_transaction_id:'prior-original-a'},
        {...base,id:'child-b',amount_pence:9000,effect_sign:-1,refund_link_id:'link-b',project_id:'project-b',original_bank_transaction_id:'prior-original-b'},
        {...base,id:'retained-old-child',amount_pence:5000,effect_sign:-1,status:'excluded',refund_link_id:'retained-reversed-link',original_bank_transaction_id:'prior-original-a'});
    const o={id:'shared-refund',account_id:'account',account:{id:'account',provider:'starling',account_type:'bank',masked_identifier:'1234'},import_id:'import',source_row_id:'source-row',file_hash:'a'.repeat(64),row_hash:'b'.repeat(64),row_number:2,transaction_date:'2025-08-01',signed_amount_pence:50000,currency:'GBP',classification:'Refund',decision_version:1,business_use_bps:0,dedupe_status:'clear',import_status:'review',recognized_pence:-18000,has_financial_dependencies:true};
    c.observations.push(o);input.observations.push({...o,in_tax_year:true,record_type:'expense',masked_identifier:'1234'});
    const prepared=prepareCalculation(c);Object.assign(input.calculation,{result:prepared.result,input_canonical_json:prepared.inputJson,result_canonical_json:prepared.resultJson,input_sha256:prepared.inputHash,result_sha256:prepared.resultHash});
    const bundle=buildFilingPack(input,reviewFixture(input),'shared-cash-request',false);assert.equal(bundle.schema_version,'draft-filing-pack/2');
    const csv=readSourceCsv(bundle.artifacts.find(a=>a.name==='normalized-ledger.csv')!.body),header=csv[0],rows=csv.slice(1),bank=rows.filter(r=>r[header.indexOf('row_kind')]==='bank_observation');
    assert.equal(bank.length,1);const row=bank[0];assert.equal(row[header.indexOf('signed_amount_pence')],'50000');assert.equal(row[header.indexOf('year_expense_pence')],'-18000');assert.equal(row[header.indexOf('year_profit_effect_pence')],'18000');
    const records=JSON.parse(row[header.indexOf('year_financial_records')]);assert.equal(records.length,3);assert.deepEqual(records.map((r:{refund_link_id:string})=>r.refund_link_id),['link-a','link-b','retained-reversed-link']);assert.equal(records[0].project_id,'project-a');
    assert.equal(rows.reduce((s,r)=>s+Number(r[header.indexOf('year_profit_effect_pence')]),0),202500-18909+18000);
});

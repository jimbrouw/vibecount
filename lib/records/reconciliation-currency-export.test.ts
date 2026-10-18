import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { currencyReconciliationExport, RECONCILIATION_SCHEMA, type CurrencyReconciliationInput } from './reconciliation-currency-export';
import { reconciliationExport } from './reconciliation-export';
import { readSourceCsv } from './source-csv';
import { currencyExportFixture } from './reconciliation-currency-fixture';
import { fxFixtureId as id } from '../fx/fixture';
const frozen=JSON.parse(readFileSync(new URL('../../fixtures/reconciliation-v2-frozen.json',import.meta.url),'utf8'));

function mapped(csv:string){const [h,...rows]=readSourceCsv(csv);return rows.map(row=>Object.fromEntries(h.map((key,i)=>[key,row[i]])));}
test('retained V2 output is byte-identical after extracting raw table assembly',()=>{
 const result=reconciliationExport(...frozen.args as Parameters<typeof reconciliationExport>);assert.equal(result.csv,frozen.csv);assert.equal(result.count,frozen.count);assert.equal(createHash('sha256').update(result.csv).digest('hex'),frozen.sha256);
});
test('V3 retains native financial columns and emits once-only original document units without foreign cash',()=>{
 const f=currencyExportFixture(),before=JSON.stringify(f),result=currencyReconciliationExport(f),rows=mapped(result.csv);
 assert.equal(result.count,5);assert.ok(rows.every(r=>r.reconciliation_schema_version===RECONCILIATION_SCHEMA));assert.equal(JSON.stringify(f),before);
 const nativeBalance=rows.find(r=>r.row_kind==='invoice_balance')!;assert.equal(nativeBalance.amount_pence,'150000');assert.equal(nativeBalance.value_currency,'GBP');assert.equal(nativeBalance.invoice_original_total_minor,'');
 const external=rows.find(r=>r.row_kind==='invoice_document'&&r.invoice_id==='external')!;
 assert.equal(external.invoice_original_currency,'USD');assert.equal(external.invoice_original_total_minor,'100000');assert.match(external.invoice_original_amount_readback,/USD 1000.00/);assert.equal(external.invoice_source_file_sha256,'b'.repeat(64));assert.match(external.invoice_balance_coverage,/unavailable/);
 for(const [key,value] of Object.entries(external))if(key.endsWith('_pence'))assert.equal(value,'',key);
 assert.equal(external.value_currency,'');assert.equal(rows.filter(r=>r.invoice_original_total_minor!=='').length,2);assert.ok(rows.filter(r=>r.row_kind!=='invoice_document').every(r=>r.value_currency==='GBP'));
 assert.match(result.csv,/"'=SUM\(1,2\)\r\nReviewed ""source"""/);assert.equal(rows[0].invoice_number,"'=INV,1500");assert.doesNotMatch(result.csv,/PRIVATE_OBJECT|PRIVATE_RAW/);
});
test('external GBP, JPY and KWD preserve their own scale and retained source ancestry',()=>{
 for(const [currency,amount,figure] of [['GBP',12345,'GBP 123.45'],['JPY',12345,'JPY 12345'],['KWD',12345,'KWD 12.345']] as const){
  const f=currencyExportFixture();Object.assign(f.documents[1],{currency,original_total_minor:amount});Object.assign(f.facts[0].data as object,{currency,original_total_minor:amount});
  const row=mapped(currencyReconciliationExport(f).csv).find(r=>r.invoice_id==='external')!;assert.match(row.invoice_original_amount_readback,new RegExp(figure));assert.equal(row.amount_pence,'');assert.equal(row.invoice_source_fact_family_id,f.documents[1].source_fact_family_id);
 }
});
test('V3 rejects incomplete identities, native balance coverage, source provenance and external financial history',()=>{
 const mutations:((f:CurrencyReconciliationInput)=>void)[]=[
  f=>{f.documents.push(f.documents[0])},f=>{f.documents[0].status='draft'},f=>{f.legacy[2]=[]},f=>{f.legacy[2].push(f.legacy[2][0])},f=>{f.legacy[2][0].currency='USD'},f=>{f.legacy[2][0].invoice_pence=1},
  f=>{f.legacy[0][0].invoice_id='external'},f=>{f.legacy[0][0].invoice_snapshot.currency='USD'},f=>{f.facts=[]},f=>{f.facts.push(f.facts[0])},f=>{f.facts[0].family_id=id(99)},f=>{f.facts[0].user_id=id(99)},f=>{f.facts[0].state='provisional'},f=>{f.facts[0].human_read_original=false},
  f=>{(f.facts[0].data as {original_total_minor:number}).original_total_minor=1},f=>{f.documents[1].invoice_date='2026-04-06'},f=>{f.documents[0].invoice_date='2026-02-30'},
  f=>{f.legacy[7]=[{invoice_id:'external'} as never]},f=>{f.legacy[9]=[{invoice_id:'external'} as never]},
 ];
 for(const mutate of mutations){const f=currencyExportFixture();mutate(f);assert.throws(()=>currencyReconciliationExport(f));}
 // A later source-access loss does not rewrite the captured historical proof or fabricate current availability.
 const retained=currencyExportFixture();((retained.facts[0].source_snapshot as {document_source:{available:boolean}}).document_source).available=false;assert.match(currencyReconciliationExport(retained).csv,/current access not asserted/);
});
test('document originals do not overwrite retained event snapshot amounts or shared refund cash semantics',()=>{
 const f=currencyExportFixture();f.documents[0].amount='2000.00';f.legacy[2][0].invoice_pence=200000;f.legacy[2][0].outstanding_pence=200000;
 const rows=mapped(currencyReconciliationExport(f).csv);assert.equal(rows.find(r=>r.row_kind==='settlement_event')!.amount_pence,'150000');assert.equal(rows.find(r=>r.row_kind==='settlement_event')!.retained_settlement_invoice_gross_pence,'150000');assert.equal(rows.find(r=>r.row_kind==='invoice_document')!.invoice_original_total_minor,'200000');
 assert.ok(rows.filter(r=>r.row_kind==='invoice_document').every(r=>r.refund_observed_signed_cash_once_pence===''));
});
test('shared refund cash-once semantics survive V3 while document-only rows contribute no cash',()=>{
 const f=currencyExportFixture();
 const source=(key:string,cash:number)=>({id:key,signed_amount_pence:cash,source_row_id:key+'-row',source_rows:{row_number:2,row_hash:'c'.repeat(64)},record_imports:{file_hash:'d'.repeat(64)},financial_accounts:{label:'Synthetic bank',masked_identifier:'1234'}});
 const link=(key:string,amount:number)=>({id:key,original_transaction_id:'original-'+key,refund_transaction_id:'refund',amount_pence:amount,recognized_pence:amount,record_type:'income',business_use_bps:10000,author:f.owner,rationale:'Synthetic reviewed portion',request_id:key,created_at:'2026-04-06',original_snapshot:{date:'2026-04-05'},refund_snapshot:{date:'2026-04-06'},original:source('original-'+key,50000),refund:source('refund',-50000)});
 f.legacy[5]=[link('a',30000),link('b',20000)];
 const rows=mapped(currencyReconciliationExport(f).csv),refunds=rows.filter(r=>r.row_kind==='refund_event');
 assert.equal(refunds.reduce((total,r)=>total+Number(r.refund_observed_signed_cash_once_pence),0),-50000);assert.equal(refunds.reduce((total,r)=>total+Number(r.refund_active_cash_portion_pence),0),50000);
 assert.ok(rows.filter(r=>r.row_kind==='invoice_document').every(r=>r.refund_observed_signed_cash_once_pence===''));
 f.legacy[6]=['a','b'].map(key=>({id:'reverse-'+key,refund_id:key,author:f.owner,rationale:'Synthetic reverse',request_id:'reverse-'+key,created_at:'2026-04-07'}));
 const reversed=mapped(currencyReconciliationExport(f).csv).filter(r=>r.row_kind==='refund_event');assert.equal(reversed.reduce((total,r)=>total+Number(r.refund_observed_signed_cash_once_pence),0),-50000);assert.equal(reversed.reduce((total,r)=>total+Number(r.refund_active_cash_portion_pence),0),0);
});
test('oversized complete exports fail explicitly instead of returning a platform-truncated artifact',()=>{
 const f=currencyExportFixture(),native=f.documents[0],balance=f.legacy[2][0];
 for(let n=0;n<5500;n++){const key='large-'+n;f.documents.push({...native,id:key,number:'x'.repeat(500)});f.legacy[2].push({...balance,id:key,number:'x'.repeat(500)})}
 assert.throws(()=>currencyReconciliationExport(f),/exceeds direct download capacity/);
 const duplicate=currencyExportFixture();duplicate.documents.push({...duplicate.documents[1],id:'second-canonical'});assert.throws(()=>currencyReconciliationExport(duplicate),/Duplicate canonical/);
});

test('retained prior-checkpoint V3 artifact stays byte-identical after raw table extraction',()=>{
 const frozen=JSON.parse(readFileSync(new URL('../../fixtures/reconciliation-v3-frozen.json',import.meta.url),'utf8')),result=currencyReconciliationExport(currencyExportFixture());assert.equal(result.csv,frozen.csv);assert.equal(result.count,frozen.count);assert.equal(createHash('sha256').update(result.csv).digest('hex'),frozen.sha256);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { dimensionedExportFixture } from './reconciliation-dimensioned-fixture';
import { dimensionedReconciliationExport, type DimensionedReconciliationInput } from './reconciliation-dimensioned-export';
import { readSourceCsv } from './source-csv';
import { fxHistoryFixture } from '../fx/history-fixture';
const rows=(csv:string)=>{const[h,...rows]=readSourceCsv(csv);return rows.map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]])));};
test('V4 exports independent original/cash events, complete receipt splits, once-only documents and retained evidence',()=>{
 const f=dimensionedExportFixture(),before=JSON.stringify(f),result=dimensionedReconciliationExport(f),data=rows(result.csv);assert.equal(JSON.stringify(f),before);assert.ok(data.every(r=>r.reconciliation_schema_version==='vibecount.reconciliation/4'));
 const events=data.filter(r=>r.row_kind==='fx_settlement_event');assert.equal(events.length,3);assert.equal(events[2].original_portion_minor,'1');assert.equal(events[2].actual_cash_pence,'0');assert.equal(events[2].original_portion_currency,'KWD');assert.match(events[2].original_portion_readback,/KWD 0.001/);assert.equal(events[2].fx_event_active,'true');assert.equal(events[0].recognized_income_change_pence,'0');assert.ok(events[0].retained_fx_snapshot_json.includes('rounding_delta_numerator'));assert.ok(events[0].retained_invoice_snapshot_json.includes('preserved-external-invoice/1'));
 const receipt=data.find(r=>r.row_kind==='receipt_balance'&&r.receipt_fx_allocated_pence==='2500')!;assert.equal(receipt.receipt_native_allocated_pence,'1');assert.equal(receipt.receipt_combined_allocated_pence,'2501');assert.equal(receipt.unallocated_or_outstanding_pence,'0');
 const balance=data.find(r=>r.row_kind==='external_invoice_balance')!;assert.equal(balance.external_original_allocated_minor,'10001');assert.equal(balance.external_original_outstanding_minor,'0');assert.equal(balance.actual_cash_pence,'2500');assert.equal(balance.amount_pence,'');
 assert.equal(data.filter(r=>r.invoice_original_total_minor!=='').length,2);assert.match(result.csv,/'=SUM/);assert.doesNotMatch(result.csv,/PRIVATE_OBJECT|PRIVATE_RAW/);
});
test('V4 rejects partial histories, forged tranches, source/balance drift and unknown financial kinds',()=>{
 const mutations:((f:DimensionedReconciliationInput)=>void)[]=[f=>{f.fx_lots=[]},f=>{f.events.pop()},f=>{f.events.push(f.events[0])},f=>{f.events.at(-1)!.amount_pence=1},f=>{f.events.at(-1)!.user_id='foreign'},f=>{f.events[0].settlement_kind='guess'},f=>{f.external_balances=[]},f=>{f.external_balances[0].allocated_original_minor=1},f=>{f.external_balances[0].invoice_revision_id='changed'},f=>{f.legacy[1][1].allocated_pence=2500},f=>{f.legacy[1][1].unallocated_pence=1},f=>{f.legacy[2][0].allocated_pence=0},f=>{f.legacy[1].pop()},f=>{f.legacy[1][1].source_row_id='changed'},f=>{f.legacy[1][1].source_rows=null}];
 for(const mutate of mutations){const f=dimensionedExportFixture();mutate(f);assert.throws(()=>dimensionedReconciliationExport(f));}
});
test('V4 full reversal and reuse preserve old event snapshots and source-loss history',()=>{
 const f=dimensionedExportFixture(),x=fxHistoryFixture(),originals=f.events.filter(e=>e.settlement_kind==='fx_gbp_cash'),source=originals[0].transaction;
 for(const [n,e]of [...originals].reverse().entries())f.events.push({...e,id:'00000000-0000-4000-8000-'+String(4000+n).padStart(12,'0'),event_kind:'reversal',reverses_id:e.id,lot_event_ordinal:4+n,transaction:source});
 f.legacy[1][1].allocated_pence=1;f.legacy[1][1].unallocated_pence=2500;Object.assign(f.external_balances[0],{allocated_original_minor:0,outstanding_original_minor:10001,allocated_cash_pence:0,settlement_state:'unpaid'});
 const l=f.fx_lots[0] as typeof x.lot;l.invoice_fact.source_snapshot.document_source.available=false;l.conversion_fact.source_snapshot.document_source.available=false;
 let data=rows(dimensionedReconciliationExport(f).csv);assert.equal(data.filter(r=>r.row_kind==='fx_settlement_event').length,6);assert.equal(data.find(r=>r.row_kind==='fx_lot_balance')!.fx_lot_version,'6');assert.equal(data.find(r=>r.row_kind==='fx_lot_balance')!.fx_active_portion_count,'0');
 const again={...x.allocation(5000,0,0,7),transaction:source};f.events.push(again as unknown as typeof f.events[number]);f.legacy[1][1].allocated_pence=1251;f.legacy[1][1].unallocated_pence=1250;Object.assign(f.external_balances[0],{allocated_original_minor:5000,outstanding_original_minor:5001,allocated_cash_pence:1250,settlement_state:'part_paid'});data=rows(dimensionedReconciliationExport(f).csv);assert.equal(data.find(r=>r.fx_lot_event_ordinal==='7')!.fx_event_active,'true');assert.match(data.find(r=>r.row_kind==='fx_lot_balance')!.row_semantics,/not current availability/);
});

function withReturnedCash(){
 const f=dimensionedExportFixture(),receipt=f.legacy[1][1],allocation=f.events.find(e=>e.id==='native-penny')!;
 const source=(id:string,signed:number)=>({id,source_row_id:id+'-row',signed_amount_pence:signed,source_rows:{row_number:2,row_hash:'e'.repeat(64)},record_imports:{file_hash:'f'.repeat(64)},financial_accounts:{label:'Synthetic bank',masked_identifier:'1234'}});
 f.legacy[5]=[{id:'refund',original_transaction_id:receipt.id,refund_transaction_id:'returned',amount_pence:1,recognized_pence:1,record_type:'income',business_use_bps:10000,author:f.owner,rationale:'Synthetic customer return',request_id:'refund-request',created_at:'2026-04-07',original_snapshot:{date:receipt.transaction_date},refund_snapshot:{date:'2026-04-07'},original:source(receipt.id,2501),refund:source('returned',-1)}];
 receipt.refunded_pence=1;
 f.legacy[7]=[{id:'credit',invoice_id:allocation.invoice_id,number:'CN-1',credit_date:'2026-04-07',gross_pence:1,net_pence:1,vat_pence:0,tax_status:'invoice_snapshot',pdf_sha256:'a'.repeat(64),invoice_snapshot:{number:'INV-1'},author:f.owner,rationale:'Synthetic commercial credit',request_id:'credit-request',created_at:'2026-04-07'}];
 f.legacy[9]=[{id:'assignment',invoice_id:allocation.invoice_id,allocation_id:allocation.id,credit_id:'credit',refund_id:'refund',amount_pence:1,invoice_snapshot:{number:'INV-1'},credit_snapshot:{pdf_sha256:'a'.repeat(64)},author:f.owner,rationale:'Synthetic recorded return match',request_id:'assignment-request',created_at:'2026-04-07'}];
 Object.assign(f.legacy[2][0],{credited_pence:1,returned_pence:1,entitlement_pence:149999,retained_cash_pence:0,refund_due_pence:0,outstanding_pence:149999});
 return f;
}
test('V4 derives receipt refund totals and validates active native assignment parents without hiding retained history',()=>{
 const f=withReturnedCash();
 // Existing predecessor combinations stay exportable; export is not fresh FX eligibility.
 assert.equal(rows(dimensionedReconciliationExport(f).csv).filter(r=>r.row_kind==='refund_assignment_event').length,1);
 const mutations:((v:DimensionedReconciliationInput)=>void)[]=[
  v=>{v.legacy[1][1].refunded_pence=123},v=>{v.legacy[1][1].active_refund_id='missing-link'},
  v=>{v.legacy[5]=[]},v=>{v.legacy[7]![0].invoice_id=v.documents[1].id},
  v=>{v.legacy[5]![0].original_transaction_id='unrelated'},v=>{v.legacy[5]![0].record_type='expense'},
  v=>{v.legacy[5]![0].business_use_bps=5000},v=>{v.legacy[9]![0].credit_snapshot.pdf_sha256='b'.repeat(64)},
  v=>{v.legacy[8]=[{id:'undo-credit',credit_id:'credit',author:v.owner,rationale:'Reverse',request_id:'undo',created_at:'2026-04-08'}]},
  v=>{v.legacy[6]=[{id:'undo-refund',refund_id:'refund',author:v.owner,rationale:'Reverse',request_id:'undo',created_at:'2026-04-08'}]},
  v=>{v.legacy[9]!.push({...v.legacy[9]![0],id:'another-assignment'})},
 ];
 for(const mutate of mutations){const v=withReturnedCash();mutate(v);assert.throws(()=>dimensionedReconciliationExport(v));}
 // Reverse the assignment, then its credit/refund/allocation parents. Retain every reference.
 f.legacy[10]=[{id:'undo-assignment',assignment_id:'assignment',author:f.owner,rationale:'Reverse',request_id:'undo',created_at:'2026-04-08'}];
 f.legacy[8]=[{id:'undo-credit',credit_id:'credit',author:f.owner,rationale:'Reverse',request_id:'undo',created_at:'2026-04-08'}];
 f.legacy[6]=[{id:'undo-refund',refund_id:'refund',author:f.owner,rationale:'Reverse',request_id:'undo',created_at:'2026-04-08'}];
 const a=f.events.find(e=>e.id==='native-penny')!;f.events.push({...a,id:'undo-native-penny',event_kind:'reversal',reverses_id:a.id});
 Object.assign(f.legacy[2][0],{allocated_pence:0,credited_pence:0,returned_pence:0,entitlement_pence:150000,retained_cash_pence:0,outstanding_pence:150000});
 Object.assign(f.legacy[1][1],{allocated_pence:2500,unallocated_pence:1,refunded_pence:0});
 assert.equal(rows(dimensionedReconciliationExport(f).csv).filter(r=>r.row_kind==='refund_assignment_event').length,2);
});
test('V4 requires retained receipt provenance even for a bound lot without settlement events',()=>{
 const f=dimensionedExportFixture();f.events=f.events.filter(e=>e.transaction_id==='tx');f.legacy[1]=f.legacy[1].filter(r=>r.id==='tx');
 Object.assign(f.legacy[2][0],{allocated_pence:0,outstanding_pence:150000});
 Object.assign(f.external_balances[0],{allocated_original_minor:0,outstanding_original_minor:10001,allocated_cash_pence:0,settlement_state:'unpaid',has_reconciliation_history:false});
 assert.throws(()=>dimensionedReconciliationExport(f),/lot receipt/);
});

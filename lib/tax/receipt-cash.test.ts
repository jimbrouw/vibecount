import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptCashEffect,type ReceiptDimensions} from './receipt-cash';
import {accountingTaxPackFixture} from './bank-source-fixture';
import {prepareCalculation,verifySavedCalculation,canonicalJson,sha256} from './snapshot';
import {buildFilingReview} from './filing-pack';

const paid:ReceiptDimensions={currency:'GBP',payment_status:'paid',expense_kind:'expense',payment_date:'2025-08-01',document_date:'2025-08-01',refund_of:null};
test('receipt cash recognition excludes unpaid/foreign/draft records and never doubles refund signs',()=>{
 const r={amount_pence:500,effect_sign:1 as const,status:'approved',receipt_dimensions:paid};
 assert.equal(receiptCashEffect(r),500);
 assert.equal(receiptCashEffect({...r,receipt_dimensions:{...paid,payment_status:'unpaid'}}),null);
 assert.equal(receiptCashEffect({...r,receipt_dimensions:{...paid,currency:'EUR'}}),null);
 assert.equal(receiptCashEffect({...r,status:'draft'}),null);
 assert.equal(receiptCashEffect({...r,effect_sign:-1,receipt_dimensions:null}),-500);
 for(const effect_sign of [1,-1] as const)assert.equal(receiptCashEffect({...r,effect_sign,receipt_dimensions:{...paid,expense_kind:'refund'}}),-500);
 assert.throws(()=>receiptCashEffect({amount_pence:500,effect_sign:1,status:'approved'}),/missing/);
 assert.throws(()=>receiptCashEffect({...r,receipt_dimensions:{...paid,payment_date:undefined} as unknown as ReceiptDimensions}),/Invalid/);
 assert.throws(()=>receiptCashEffect({...r,amount_pence:Number.MAX_SAFE_INTEGER+1}),/Invalid/);
});

test('V5 computes cash candidates without changing V4 replay and saved result tampering is rejected',()=>{
 const pack=accountingTaxPackFixture(),base=pack.calculation.input;
 if(base.schema_version!=='tax-calculation-input/4')throw new Error('Accounting fixture required');
 const record={id:'paid',record_type:'expense' as const,record_date:'2025-08-01',amount_pence:1000,effect_sign:1 as const,status:'approved',category:{id:'cost',name:'Synthetic cost',record_type:'expense',sa103_box:'20',valid:true},bank_transaction_id:null,original_bank_transaction_id:null,source_type:'manual',receipt_dimensions:paid};
 const records=[record,{...record,id:'unpaid',amount_pence:2000,receipt_dimensions:{...paid,payment_status:'unpaid' as const}},{...record,id:'refund',amount_pence:500,receipt_dimensions:{...paid,expense_kind:'refund' as const,refund_of:'paid'}}];
 const old=prepareCalculation({...base,records}),current=prepareCalculation({...base,schema_version:'tax-calculation-input/5',records});
 assert.equal(old.result.totals.ledger_expenses,3500);
 assert.equal(current.result.totals.ledger_expenses,500);
 const saved={...pack.calculation,input:current.input,result:current.result,input_canonical_json:current.inputJson,result_canonical_json:current.resultJson,input_sha256:current.inputHash,result_sha256:current.resultHash};
 assert.equal(verifySavedCalculation(saved,pack.rules).result.totals.ledger_expenses,500);
 const wrong={...saved.result,totals:{...saved.result.totals,ledger_expenses:3500}},wrongJson=canonicalJson(wrong);
 assert.throws(()=>verifySavedCalculation({...saved,result:wrong,result_canonical_json:wrongJson,result_sha256:sha256(wrongJson)},pack.rules),/receipt cash calculation/);
 const filing={...pack,schema_version:'filing-pack-input/6' as const,documents:pack.documents.map(d=>({...d,source_available:true})),calculation:saved};
 assert.doesNotThrow(()=>buildFilingReview(filing,[]));
 const foreign=prepareCalculation({...base,schema_version:'tax-calculation-input/5',records:[{...record,receipt_dimensions:{...paid,currency:'EUR'}}]});
 assert.equal(foreign.result.totals.ledger_expenses,0);
 assert.equal(foreign.result.totals.taxable_trade_profit,null);
 assert.ok(foreign.result.issues.some(i=>i.code==='receipt_currency'));
});

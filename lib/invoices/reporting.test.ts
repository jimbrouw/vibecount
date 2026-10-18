import assert from 'node:assert/strict';
import test from 'node:test';
import { FX_CURRENCY_RULESET } from '../fx/currency.ts';
import { fxAmountReadback, fxAggregateReadback } from '../fx/readback.ts';
import { invoiceOriginalAmount, groupInvoiceOriginals, invoiceReportingSummary, type InvoiceReportingRow } from './reporting.ts';
import type { InvoiceBalanceRow } from './balances.ts';
const native: InvoiceReportingRow = { id:'native',status:'finalised',origin:'native_gbp',currency:'GBP',amount:'120.00',original_total_minor:null,currency_ruleset_id:null,source_fact_revision_id:null,source_fact_family_id:null };
const foreign: InvoiceReportingRow = { ...native,id:'external',origin:'preserved_external',currency:'USD',amount:null,original_total_minor:'12345',currency_ruleset_id:FX_CURRENCY_RULESET,source_fact_revision_id:'11111111-1111-4111-8111-111111111111',source_fact_family_id:'22222222-2222-4222-8222-222222222222' };
const balance: InvoiceBalanceRow = {id:'native',status:'finalised',currency:'GBP',updated_at:'now',invoice_pence:'12000',allocated_pence:3000,credited_pence:0,outstanding_pence:9000,refund_due_pence:0,returned_pence:0,settlement_state:'part_paid',has_reconciliation_history:true,paid_at:null,delivery_status:'sent'};
test('original invoice totals group native/external GBP and 0/2/3 decimal currencies without FX or cash inference',()=>{
 const rows=[native,foreign,{...foreign,id:'gbp',currency:'GBP',original_total_minor:100},{...foreign,id:'jpy',currency:'JPY',original_total_minor:123},{...foreign,id:'kwd',currency:'KWD',original_total_minor:12345},{...native,id:'draft',status:'draft',amount:'0.01'}];
 assert.deepEqual(groupInvoiceOriginals(rows),[
  {currency:'GBP',finalised_minor:12100,draft_minor:1,count:3},{currency:'JPY',finalised_minor:123,draft_minor:0,count:1},{currency:'KWD',finalised_minor:12345,draft_minor:0,count:1},{currency:'USD',finalised_minor:12345,draft_minor:0,count:1}]);
 assert.match(fxAmountReadback(invoiceOriginalAmount(rows[3]).minor,'JPY'),/JPY 123 \(one hundred and twenty-three yen\)/);
 assert.match(fxAmountReadback(invoiceOriginalAmount(rows[4]).minor,'KWD'),/KWD 12.345/);
 const summary=invoiceReportingSummary([native,foreign],[balance]);assert.equal(summary.native.invoiced,12000);assert.equal(summary.native.receipts,3000);assert.equal(summary.external_count,1);
});
test('incomplete, ambiguous or stale invoice metadata never becomes a zero or GBP total',()=>{
 for(const patch of [{currency:undefined},{currency:'CAD'},{origin:undefined},{amount:null},{original_total_minor:12000}])assert.throws(()=>invoiceOriginalAmount({...native,...patch} as InvoiceReportingRow));
 for(const patch of [{amount:'123.45'},{original_total_minor:null},{original_total_minor:'0'},{original_total_minor:'01'},{original_total_minor:'123\n'},{source_fact_revision_id:foreign.source_fact_revision_id+'\n'},{original_total_minor:'1.00'},{original_total_minor:1.1},{original_total_minor:'9999999999999'},{source_fact_family_id:null},{source_fact_revision_id:'invalid'},{currency_ruleset_id:'unknown'}])assert.throws(()=>invoiceOriginalAmount({...foreign,...patch}));
 assert.throws(()=>groupInvoiceOriginals([native,native]));assert.throws(()=>groupInvoiceOriginals([{...native,status:'unknown'}]));
 const larger=groupInvoiceOriginals([{...foreign,original_total_minor:999999999999},{...foreign,id:'more',original_total_minor:1}]);assert.equal(larger[0].finalised_minor,1000000000000);assert.match(fxAggregateReadback(larger[0].finalised_minor,'USD'),/^USD 10000000000.00/);
 assert.match(fxAggregateReadback(Number.MAX_SAFE_INTEGER,'KWD'),/^KWD 9007199254740.991/);assert.throws(()=>fxAggregateReadback(Number.MAX_SAFE_INTEGER+1,'GBP'));assert.throws(()=>fxAmountReadback(1000000000000,'USD'));
 for(const balances of [[],[balance,balance],[{...balance,id:'other'}],[{...balance,currency:'USD'}],[{...balance,invoice_pence:0}],[{...balance,status:'draft'}]])assert.throws(()=>invoiceReportingSummary([native],balances));
 assert.throws(()=>invoiceReportingSummary([native,foreign],[balance,{...balance,id:'external'}]));
});

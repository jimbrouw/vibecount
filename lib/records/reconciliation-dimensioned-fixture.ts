import { currencyExportFixture } from './reconciliation-currency-fixture';
import { fxHistoryFixture } from '../fx/history-fixture';
import { fxFixtureId as id } from '../fx/fixture';
import type { DimensionedReconciliationInput, DimensionedSettlementExportRow } from './reconciliation-dimensioned-export';
/** Complete safe synthetic source projections. Retained V2/V3 fixtures stay unchanged. */
export function dimensionedExportFixture():DimensionedReconciliationInput{
 const input=currencyExportFixture(),f=fxHistoryFixture(),a=f.allocation(5000),b=f.allocation(5000,5000,1250,2),z=f.allocation(1,10000,2500,3);
 input.documents[1]={...input.documents[1],id:f.lot.invoice_id,currency:'KWD',original_total_minor:10001,source_fact_revision_id:f.lot.invoice_fact_revision_id,source_fact_family_id:f.lot.invoice_fact.family_id,number:f.lot.invoice_snapshot.number,invoice_date:f.lot.invoice_snapshot.invoice_date};input.facts=[f.lot.invoice_fact];
 const source={row_number:2,row_hash:'c'.repeat(64)},file={file_hash:'d'.repeat(64),parser_version:'mapped-csv/1'};
 const receipt=(key:string,importId:string,row:string,cash:number,allocated:number)=>({id:key,import_id:importId,transaction_date:'2026-04-06',signed_amount_pence:cash,allocated_pence:allocated,unallocated_pence:cash-allocated,classification:'Business',record_status:'approved',active_transfer_id:null,active_refund_id:null,refunded_pence:0,source_row_id:row,source_rows:source,record_imports:file});
 const originalEvents=input.legacy[0].map(e=>({...e,user_id:input.owner,author:input.owner,settlement_kind:'native_gbp',invoice_minor:null,invoice_currency:null,invoice_revision_id:null,conversion_lot_id:null,lot_event_ordinal:null,fx_snapshot:null,created_at:'2026-10-18T00:00:00Z',transaction:{...e.transaction as object,id:'tx',transaction_date:'2026-04-06',source_row_id:'row',source_rows:source,record_imports:file}}));
 // One native penny shares the FX receipt. Native gross/balance remains independent.
 const penny={...originalEvents[0],id:'native-penny',transaction_id:id(20),amount_pence:1,transaction:{id:id(20),transaction_date:'2026-04-06',source_row_id:id(22),source_rows:source,record_imports:file}};
 input.legacy[0]=[];input.legacy[1]=[receipt('tx','native-import','row',150000,0),receipt(id(20),id(21),id(22),2501,2501)];input.legacy[2][0].allocated_pence=1;input.legacy[2][0].outstanding_pence=149999;
 const events=[...originalEvents,penny,...[a,b,z].map(e=>({...e,transaction:{id:id(20),transaction_date:'2026-04-06',source_row_id:id(22),source_rows:source,record_imports:file}}))] as unknown as DimensionedSettlementExportRow[];
 return{...input,events,fx_lots:[f.lot],external_balances:[{id:f.lot.invoice_id,user_id:input.owner,invoice_revision_id:f.lot.invoice_revision_id,currency:'KWD',original_total_minor:10001,allocated_original_minor:10001,outstanding_original_minor:0,allocated_cash_currency:'GBP',allocated_cash_pence:2500,settlement_state:'settled',has_reconciliation_history:true}]};
}

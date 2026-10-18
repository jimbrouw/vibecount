import { currencyReconciliationExportTable, MAX_RECONCILIATION_BYTES, type CurrencyReconciliationInput } from './reconciliation-currency-export';
import type { SettlementExportRow } from './reconciliation-export';
import { minorPence } from './allocations';
import { escapeCsv } from './export-csv';
import { sumPence } from '../money';
import { isNativeReportingInvoice, invoiceOriginalAmount } from '../invoices/reporting';
import { currencyMinor } from '../fx/currency';
import { fxAmountReadback } from '../fx/readback';
import { fxHistoryEqual, validateFxSettlementHistory } from '../fx/settlement-history';
export const DIMENSIONED_RECONCILIATION_SCHEMA='vibecount.reconciliation/4';
export type DimensionedSettlementExportRow=SettlementExportRow&{
 user_id:string;settlement_kind:string;invoice_minor:number|null;invoice_currency:string|null;invoice_revision_id:string|null;conversion_lot_id:string|null;lot_event_ordinal:number|null;fx_snapshot:unknown;
};
export type ExternalSettlementBalance={id:string;user_id:string;invoice_revision_id:string;currency:string;original_total_minor:number;allocated_original_minor:number;outstanding_original_minor:number;allocated_cash_currency:string;allocated_cash_pence:number;settlement_state:string;has_reconciliation_history:boolean};
export type DimensionedReconciliationInput=Omit<CurrencyReconciliationInput,'legacy'>&{
 legacy:CurrencyReconciliationInput['legacy'];events:DimensionedSettlementExportRow[];fx_lots:unknown[];external_balances:ExternalSettlementBalance[];
};
const one=<T>(v:T|T[]|null)=>{if(Array.isArray(v)){if(v.length!==1)throw new Error('Complete unique source relationship unavailable.');return v[0];}if(!v)throw new Error('Complete source relationship unavailable.');return v;};
const amount=(v:number|string,min=0)=>{const n=minorPence(v);if(n<min||n>999999999999)throw new Error('Exact reconciliation amount unavailable.');return n;};
function unique<T extends{id:string}>(rows:T[]){const map=new Map(rows.map(r=>[r.id,r]));if(map.size!==rows.length||rows.some(r=>typeof r.id!=='string'||!r.id))throw new Error('Complete unique reconciliation history required.');return map;}
const columns=['settlement_kind','original_portion_currency','original_portion_minor','original_portion_readback','actual_cash_currency','actual_cash_pence','actual_cash_readback','fx_lot_id','fx_lot_event_ordinal','fx_lot_version','fx_active_portion_count','fx_active_original_minor','fx_active_cash_pence','receipt_native_allocated_pence','receipt_fx_allocated_pence','receipt_combined_allocated_pence','external_original_allocated_minor','external_original_outstanding_minor','fx_documented_original_limit_minor','fx_documented_cash_limit_pence','fx_rate_json','fx_conversion_date','fx_evidence_date','fx_invoice_revision_id','fx_invoice_fact_revision_id','fx_invoice_fact_family_id','fx_conversion_fact_revision_id','fx_conversion_fact_family_id','fx_event_active','fx_receipt_decision_version','fx_receipt_record_id','fx_invoice_document_id','fx_invoice_file_sha256','fx_conversion_document_id','fx_conversion_file_sha256','retained_fx_snapshot_json','retained_invoice_snapshot_json','recognized_income_change_pence','recognized_expense_change_pence'];
/** Complete relationship artifact. Document values, original entitlements and cash are distinct rows/columns. */
export function dimensionedReconciliationExportTable(input:DimensionedReconciliationInput){
 if(input.legacy[0].length)throw new Error('Supply settlement history once through the dimensioned events contract.');
 const all=unique(input.events),receipts=unique(input.legacy[1]),documents=unique(input.documents),external=unique(input.external_balances);
 const native:DimensionedSettlementExportRow[]=[],foreign:DimensionedSettlementExportRow[]=[];
 for(const e of input.events){
  if(e.user_id!==input.owner||e.author!==input.owner||!['allocation','reversal'].includes(e.event_kind))throw new Error('Owned complete settlement event unavailable.');
  if(e.settlement_kind==='native_gbp'){if([e.invoice_minor,e.invoice_currency,e.invoice_revision_id,e.conversion_lot_id,e.lot_event_ordinal,e.fx_snapshot].some(v=>v!==null))throw new Error('Native settlement contains foreign dimensions.');native.push(e);}
  else if(e.settlement_kind==='fx_gbp_cash')foreign.push(e);else throw new Error('Unsupported settlement dimensions.');
 }
 const fx=validateFxSettlementHistory(input.owner,input.fx_lots,foreign),fxByEvent=new Map(fx.events.map(e=>[e.id,e])),fxByLot=new Map(fx.lots.map(l=>[l.lot.id,l]));
 const reversedNative=new Set<string>();
 for(const e of native){amount(e.amount_pence,1);if(e.event_kind==='allocation'){if(e.reverses_id!==null)throw new Error('Invalid native allocation reversal pointer.');}
  else{const original=e.reverses_id?all.get(e.reverses_id):null;if(!original||original.settlement_kind!=='native_gbp'||original.event_kind!=='allocation'||original.invoice_id!==e.invoice_id||original.transaction_id!==e.transaction_id||amount(original.amount_pence)!==amount(e.amount_pence)||!fxHistoryEqual(original.invoice_snapshot,e.invoice_snapshot)||reversedNative.has(original.id))throw new Error('Incomplete native reversal ancestry.');reversedNative.add(original.id);}
 }
 const activeNative=native.filter(e=>e.event_kind==='allocation'&&!reversedNative.has(e.id));
 const refunds=unique(input.legacy[5]??[]),refundReversals=input.legacy[6]??[];
 unique(refundReversals);const undoneRefunds=new Set(refundReversals.map(r=>r.refund_id));
 if(undoneRefunds.size!==refundReversals.length||refundReversals.some(r=>!refunds.has(r.refund_id)))throw new Error('Complete refund reversal ancestry unavailable.');
 const activeRefunds=[...refunds.values()].filter(r=>!undoneRefunds.has(r.id));
 const activeFx=fx.lots.flatMap(l=>l.events.filter(e=>l.active_ids.includes(e.id)));
 const nativeCash=new Map<string,number>(),fxCash=new Map<string,number>(),nativeInvoice=new Map<string,number>(),fxInvoice=new Map<string,number>(),fxInvoiceCash=new Map<string,number>();
 const add=(map:Map<string,number>,key:string,value:number)=>map.set(key,currencyMinor((map.get(key)??0)+value));
 for(const e of activeNative){add(nativeCash,e.transaction_id,amount(e.amount_pence));add(nativeInvoice,e.invoice_id,amount(e.amount_pence));}
 for(const e of activeFx){add(fxCash,e.transaction_id,e.amount_pence);add(fxInvoice,e.invoice_id,e.invoice_minor);add(fxInvoiceCash,e.invoice_id,e.amount_pence);}
 const hash=(v:string)=>{if(typeof v!=='string'||v.length!==64||!/^[a-f0-9]{64}$/.test(v))throw new Error('Retained bank source hash unavailable.');return v;};
 for(const r of receipts.values()){
  const source=one(r.source_rows),file=one(r.record_imports);hash(source.row_hash);hash(file.file_hash);if(!Number.isSafeInteger(source.row_number)||source.row_number<2)throw new Error('Retained bank source row unavailable.');
  const combined=sumPence([nativeCash.get(r.id)??0,fxCash.get(r.id)??0]);if(amount(r.allocated_pence)!==combined||amount(r.signed_amount_pence,1)-combined!==amount(r.unallocated_pence))throw new Error('Complete native/FX receipt cash closure disagrees.');
  const returned=sumPence(activeRefunds.filter(l=>l.original_transaction_id===r.id).map(l=>amount(l.amount_pence,1))),incoming=activeRefunds.filter(l=>l.refund_transaction_id===r.id);
  if(amount(r.refunded_pence??0)!==returned||returned>amount(r.signed_amount_pence,1)||(incoming.length?!incoming.some(l=>l.id===r.active_refund_id):r.active_refund_id!=null))throw new Error('Complete receipt/refund history closure disagrees.');
 }
 for(const event of input.events){
  const r=receipts.get(event.transaction_id),tx=one(event.transaction),s=one(tx.source_rows),f=one(tx.record_imports);
  if(!r||tx.id!==event.transaction_id||tx.source_row_id!==r.source_row_id||tx.transaction_date!==r.transaction_date||s.row_hash!==one(r.source_rows).row_hash||s.row_number!==one(r.source_rows).row_number||f.file_hash!==one(r.record_imports).file_hash||typeof f.parser_version!=='string'||!f.parser_version)throw new Error('Complete settlement/bank source ancestry unavailable.');
  const e=fxByEvent.get(event.id);if(e&&(e.fx_snapshot.source_row_id!==r.source_row_id||e.fx_snapshot.import_id!==r.import_id||e.fx_snapshot.cash_date!==r.transaction_date||e.fx_snapshot.observed_cash_pence!==amount(r.signed_amount_pence,1)))throw new Error('Retained FX receipt/source units changed.');
 }
 const credits=unique(input.legacy[7]??[]),creditReversals=input.legacy[8]??[],assignments=unique(input.legacy[9]??[]),assignmentReversals=input.legacy[10]??[];
 unique(creditReversals);unique(assignmentReversals);const undoneCredits=new Set(creditReversals.map(r=>r.credit_id)),undoneAssignments=new Set(assignmentReversals.map(r=>r.assignment_id));
 if(undoneCredits.size!==creditReversals.length||undoneAssignments.size!==assignmentReversals.length||creditReversals.some(r=>!credits.has(r.credit_id))||assignmentReversals.some(r=>!assignments.has(r.assignment_id)))throw new Error('Complete credit/returned-cash reversal ancestry unavailable.');
 const assignedByCredit=new Map<string,number>(),assignedByAllocation=new Map<string,number>(),assignedByRefund=new Map<string,number>();
 for(const a of assignments.values()){
  const allocation=all.get(a.allocation_id),credit=credits.get(a.credit_id),refund=refunds.get(a.refund_id),cash=amount(a.amount_pence,1);
  if(!allocation||allocation.settlement_kind!=='native_gbp'||allocation.event_kind!=='allocation'||allocation.invoice_id!==a.invoice_id||!credit||credit.invoice_id!==a.invoice_id||!refund||refund.original_transaction_id!==allocation.transaction_id||refund.record_type!=='income'||refund.business_use_bps!==10000||cash>amount(allocation.amount_pence)||cash>amount(credit.gross_pence)||cash>amount(refund.amount_pence)||a.credit_snapshot.pdf_sha256!==credit.pdf_sha256)throw new Error('Native returned-cash assignment ancestry unavailable.');
  if(!undoneAssignments.has(a.id)){
   if(reversedNative.has(allocation.id)||undoneCredits.has(credit.id)||undoneRefunds.has(refund.id))throw new Error('Active returned-cash assignment has an inactive parent.');
   add(assignedByCredit,credit.id,cash);add(assignedByAllocation,allocation.id,cash);add(assignedByRefund,refund.id,cash);
  }
 }
 if([...assignedByCredit].some(([id,cash])=>cash>amount(credits.get(id)!.gross_pence))||[...assignedByAllocation].some(([id,cash])=>cash>amount(all.get(id)!.amount_pence))||[...assignedByRefund].some(([id,cash])=>cash>amount(refunds.get(id)!.amount_pence)))throw new Error('Complete returned-cash parent capacities disagree.');
 for(const b of input.legacy[2]){
  const allocated=nativeInvoice.get(b.id)??0,credited=sumPence([...credits.values()].filter(c=>c.invoice_id===b.id&&!undoneCredits.has(c.id)).map(c=>amount(c.gross_pence,1))),returned=sumPence([...assignments.values()].filter(a=>a.invoice_id===b.id&&!undoneAssignments.has(a.id)).map(a=>amount(a.amount_pence,1))),gross=amount(b.invoice_pence),entitlement=gross-credited,retained=allocated-returned;
  if(allocated>gross||credited>gross||returned>allocated||amount(b.allocated_pence)!==allocated||amount(b.credited_pence??0)!==credited||amount(b.returned_pence??0)!==returned||amount(b.entitlement_pence??b.invoice_pence)!==entitlement||amount(b.retained_cash_pence??b.allocated_pence)!==retained||amount(b.outstanding_pence)!==Math.max(entitlement-retained,0)||amount(b.refund_due_pence??0)!==Math.max(retained-entitlement,0))throw new Error('Complete native invoice relationship balances disagree.');
 }
 for(const d of documents.values())if(!isNativeReportingInvoice(d)){
  const b=external.get(d.id),units=invoiceOriginalAmount(d),allocated=fxInvoice.get(d.id)??0,cash=fxInvoiceCash.get(d.id)??0;
  if(!b||allocated>units.minor||b.user_id!==input.owner||b.currency!==units.currency||b.original_total_minor!==units.minor||b.allocated_original_minor!==allocated||b.outstanding_original_minor!==units.minor-allocated||b.allocated_cash_currency!=='GBP'||b.allocated_cash_pence!==cash||b.settlement_state!==(allocated===units.minor?'settled':allocated?'part_paid':'unpaid')||b.has_reconciliation_history!==foreign.some(e=>e.invoice_id===d.id))throw new Error('Complete external original/cash balances disagree.');
 }
 if([...external.keys()].some(id=>!documents.has(id)||isNativeReportingInvoice(documents.get(id)!)))throw new Error('Unexpected external invoice balance.');
 for(const l of fx.lots){const d=documents.get(l.lot.invoice_id),b=external.get(l.lot.invoice_id),r=receipts.get(l.lot.receipt_id),retained=l.lot.conversion_fact.source_snapshot.receipt!;if(!d||isNativeReportingInvoice(d)||!b)throw new Error('FX lot lacks canonical external document/balance.');if(!r||r.source_row_id!==retained.source_row_id||r.import_id!==retained.import_id||r.transaction_date!==retained.transaction_date||amount(r.signed_amount_pence,1)!==retained.signed_amount_pence)throw new Error('Retained FX lot receipt/source closure unavailable.');if(l.version>0&&(b.invoice_revision_id!==l.lot.invoice_revision_id||d.currency!==l.lot.invoice_currency||d.source_fact_revision_id!==l.lot.invoice_fact_revision_id))throw new Error('Retained FX canonical revision changed.');}
 const nativeLegacy:CurrencyReconciliationInput['legacy']=[...input.legacy];nativeLegacy[0]=native;
 const base=currencyReconciliationExportTable({...input,legacy:nativeLegacy});
 const header=base.header.concat(columns),index=new Map(header.map((h,i)=>[h,i])),rows=base.rows.map(row=>{while(row.length<header.length)row.push('');row[index.get('reconciliation_schema_version')!]=DIMENSIONED_RECONCILIATION_SCHEMA;return row;});
 const set=(row:string[],values:Record<string,string|number>)=>{for(const[k,v]of Object.entries(values)){const i=index.get(k);if(i===undefined)throw new Error('Unknown dimensioned export column.');row[i]=String(v);}};
 for(const row of rows){if(row[1]==='receipt_balance'){const r=receipts.get(row[4])!;set(row,{receipt_native_allocated_pence:nativeCash.get(r.id)??0,receipt_fx_allocated_pence:fxCash.get(r.id)??0,receipt_combined_allocated_pence:amount(r.allocated_pence),row_semantics:'observed_gbp_cash_once; allocated cash includes native and FX'});}else if(row[1]==='invoice_document'&&external.has(row[2]))set(row,{invoice_balance_coverage:'original_balance_and_actual_gbp_cash_in_external_balance_row; no GBP invoice valuation'});else if(row[1]==='settlement_event')set(row,{settlement_kind:'native_gbp'});}
 const blank=(kind:string)=>{const row=Array<string>(header.length).fill('');set(row,{document_status:'Draft — not submitted to HMRC',row_kind:kind,reconciliation_schema_version:DIMENSIONED_RECONCILIATION_SCHEMA});return row;};
 const lotFields=(l:typeof fx.lots[number])=>({fx_lot_id:l.lot.id,fx_lot_version:l.version,fx_active_portion_count:l.active_count,fx_active_original_minor:l.original_minor,fx_active_cash_pence:l.cash_pence,fx_documented_original_limit_minor:l.lot.invoice_limit_minor,fx_documented_cash_limit_pence:l.lot.cash_limit_minor,fx_rate_json:JSON.stringify(l.lot.rate),fx_conversion_date:l.lot.conversion_date,fx_evidence_date:l.lot.evidence_date,fx_invoice_revision_id:l.lot.invoice_revision_id,fx_invoice_fact_revision_id:l.lot.invoice_fact_revision_id,fx_invoice_fact_family_id:l.lot.invoice_fact.family_id,fx_conversion_fact_revision_id:l.lot.conversion_fact_revision_id,fx_conversion_fact_family_id:l.lot.conversion_family_id,fx_receipt_decision_version:l.lot.receipt_version,fx_invoice_document_id:l.lot.invoice_fact.document_id,fx_invoice_file_sha256:l.lot.invoice_fact.source_snapshot.document_source.document.file_sha256,fx_conversion_document_id:l.lot.conversion_document_id,fx_conversion_file_sha256:l.lot.conversion_fact.source_snapshot.document_source.document.file_sha256});
 for(const e of fx.events){const l=fxByLot.get(e.conversion_lot_id)!,r=receipts.get(e.transaction_id)!,source=one(r.source_rows),row=blank('fx_settlement_event');set(row,{...lotFields(l),invoice_id:e.invoice_id,invoice_number:e.invoice_snapshot.number,transaction_id:e.transaction_id,decision_event_id:e.id,event_kind:e.event_kind,reverses_id:e.reverses_id??'',amount_pence:e.amount_pence,source_row_id:r.source_row_id,source_row_number:source.row_number,source_row_sha256:source.row_hash,file_sha256:one(r.record_imports).file_hash,date:e.created_at,author:e.author,rationale:e.rationale,request_id:e.request_id,value_currency:'GBP',settlement_kind:'fx_gbp_cash',original_portion_currency:e.invoice_currency,original_portion_minor:e.invoice_minor,original_portion_readback:fxAmountReadback(e.invoice_minor,e.invoice_currency),actual_cash_currency:'GBP',actual_cash_pence:e.amount_pence,actual_cash_readback:fxAmountReadback(e.amount_pence,'GBP'),fx_lot_event_ordinal:e.lot_event_ordinal,fx_event_active:l.active_ids.includes(e.id)?'true':'false',fx_receipt_record_id:e.fx_snapshot.receipt_record_id,retained_fx_snapshot_json:JSON.stringify(e.fx_snapshot),retained_invoice_snapshot_json:JSON.stringify(e.invoice_snapshot),recognized_income_change_pence:0,recognized_expense_change_pence:0,row_semantics:'immutable FX relationship event; allocation/reversal is not new income; quantities are unsigned retained portions'});rows.push(row);}
 for(const l of fx.lots){const row=blank('fx_lot_balance');set(row,{...lotFields(l),invoice_id:l.lot.invoice_id,transaction_id:l.lot.receipt_id,invoice_origin:'preserved_external',original_portion_currency:l.lot.invoice_currency,actual_cash_currency:'GBP',recognized_income_change_pence:0,recognized_expense_change_pence:0,row_semantics:'retained lot history/capacity; not additional cash or income; document hashes are retained references, not current availability'});rows.push(row);}
 for(const b of external.values()){const row=blank('external_invoice_balance');set(row,{invoice_id:b.id,invoice_origin:'preserved_external',original_portion_currency:b.currency,external_original_allocated_minor:b.allocated_original_minor,external_original_outstanding_minor:b.outstanding_original_minor,actual_cash_currency:'GBP',actual_cash_pence:b.allocated_cash_pence,actual_cash_readback:fxAmountReadback(b.allocated_cash_pence,'GBP'),fx_invoice_revision_id:b.invoice_revision_id,classification_or_status:b.settlement_state,recognized_income_change_pence:0,recognized_expense_change_pence:0,row_semantics:'original entitlement balance and allocated actual GBP cash; no GBP invoice valuation or additional income'});rows.push(row);}
 return {header,rows};
}
export function dimensionedReconciliationExport(input:DimensionedReconciliationInput){
 const {header,rows}=dimensionedReconciliationExportTable(input);
 const csv=[header,...rows].map(row=>row.map(escapeCsv).join(',')).join('\r\n');if(new TextEncoder().encode(csv).length>MAX_RECONCILIATION_BYTES)throw new Error('Complete reconciliation exceeds direct download capacity.');
 return{csv,count:rows.length,schema_version:DIMENSIONED_RECONCILIATION_SCHEMA};
}

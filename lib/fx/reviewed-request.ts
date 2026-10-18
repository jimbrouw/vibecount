import { currencyCode, currencyMinor, convertCurrencyTranche, exactObject } from './currency';
import { fxEvidenceId } from './document-facts';
import { fxCount, fxHistoryEqual, fxObject, parseFxLotPortions } from './settlement-history';
import { validateFxSettlementIntent } from './settlement';
import { validateFxLotReversalIntent } from './reversal-review';
import { sourcesForIntent } from './settlement-source';
export type FxRequestKind='allocate'|'reverse';
export function fxRequestIntent(kind: FxRequestKind,value:unknown){return kind==='allocate'?validateFxSettlementIntent(value):validateFxLotReversalIntent(value)}
function amount(v:unknown,positive=false){const n=currencyMinor(v);if(n<(positive?1:0))throw new Error('Exact saved FX amount unavailable.');return n}
function day(v:unknown){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw new Error('Saved FX date unavailable.');return v}
function time(v:unknown){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(v)||!Number.isFinite(Date.parse(v)))throw new Error('Saved FX timestamp unavailable.');return v}
export function parseFxReviewedSnapshot(owner:string,kind:FxRequestKind,value:unknown,rawIntent:unknown){
 const intent=fxRequestIntent(kind,rawIntent),p=fxObject(value),r=fxObject(p.receipt);
 if(p.schema_version!=='fx-reviewed-snapshot/1'||p.owner_id!==owner||p.kind!==kind||p.financial_stamp!==intent.expected_stamp||p.financial_action!=='review_only'||new TextEncoder().encode(JSON.stringify(value)).length>2200000)throw new Error('Complete owned saved FX review unavailable.');
 const receipt={id:fxEvidenceId(r.id),import_id:fxEvidenceId(r.import_id),source_row_id:fxEvidenceId(r.source_row_id),cash_date:day(r.cash_date),signed_cash_pence:amount(r.signed_cash_pence,true),allocated_cash_pence:amount(r.allocated_cash_pence),record_id:r.record_id===null?null:fxEvidenceId(r.record_id)};
 if(receipt.allocated_cash_pence>receipt.signed_cash_pence)throw new Error('Saved receipt capacity disagrees.');
 if(kind==='allocate'){
  const i=validateFxSettlementIntent(intent),sources=sourcesForIntent(p.sources,i);
  if(receipt.id!==i.receipt_id||!receipt.record_id||p.portion_review!==null||p.invoice!==null||!Array.isArray(p.rows)||p.rows.length!==i.allocations.length)throw new Error('Complete saved allocation review unavailable.');
  const rows=p.rows.map(v=>{const row=fxObject(v),a=i.allocations.find(a=>a.invoice_id===row.invoice_id);if(!a)throw new Error('Unexpected saved FX invoice.');
   const raw=fxObject(row.tranche),before=fxObject(raw.before),tranche=convertCurrencyTranche(a.rate,amount(before.source_minor),amount(before.target_minor),a.invoice_minor);
   const invoice_currency=currencyCode(row.invoice_currency),outstanding=amount(row.invoice_outstanding_before_minor),invoice_limit_minor=amount(row.invoice_limit_minor,true),cash_limit_pence=amount(row.cash_limit_pence);
   if(a.rate.source_currency!==invoice_currency||a.rate.target_currency!=='GBP'||!fxHistoryEqual(raw,tranche)||tranche.portion_target_minor!==a.cash_minor||tranche.after.source_minor>invoice_limit_minor||tranche.after.target_minor>cash_limit_pence||invoice_limit_minor<1||cash_limit_pence>receipt.signed_cash_pence||row.invoice_revision_id!==a.invoice_revision_id||row.invoice_minor!==a.invoice_minor||row.cash_minor!==a.cash_minor||row.conversion_lot_id!==a.conversion_lot_id||row.conversion_lot_version!==a.conversion_lot_version||outstanding<a.invoice_minor||row.invoice_outstanding_after_minor!==outstanding-a.invoice_minor||row.conversion_date!==a.conversion_date)throw new Error('Saved FX arithmetic or identity differs.');
   return{invoice_id:a.invoice_id,invoice_revision_id:a.invoice_revision_id,invoice_currency,invoice_minor:a.invoice_minor,cash_minor:a.cash_minor,invoice_outstanding_before_minor:outstanding,invoice_outstanding_after_minor:outstanding-a.invoice_minor,conversion_lot_id:a.conversion_lot_id,conversion_lot_version:a.conversion_lot_version,tranche,conversion_date:a.conversion_date,evidence_date:day(row.evidence_date),invoice_limit_minor,cash_limit_pence};});
  if(new Set(rows.map(r=>r.invoice_id)).size!==rows.length||amount(rows.reduce((s,r)=>s+r.cash_minor,0))>receipt.signed_cash_pence-receipt.allocated_cash_pence)throw new Error('Complete saved invoice/cash capacity disagrees.');
  for(const s of sources){const cash=s.source_snapshot.receipt;if(cash&&(cash.id!==receipt.id||cash.import_id!==receipt.import_id||cash.source_row_id!==receipt.source_row_id||cash.transaction_date!==receipt.cash_date||cash.signed_amount_pence!==receipt.signed_cash_pence))throw new Error('Saved receipt and retained conversion source disagree.');}
  return{kind:'allocate' as const,intent:i,receipt,rows,sources,financial_stamp:i.expected_stamp};
 }
 const i=validateFxLotReversalIntent(intent),parts=parseFxLotPortions(owner,p.portion_review),invoice=fxObject(p.invoice),lot=parts.lot;
 if(!Array.isArray(p.rows)||p.rows.length||!Array.isArray(p.sources)||p.sources.length||parts.financial_stamp!==i.expected_stamp||parts.version!==i.lot_version||parts.lot.id!==i.lot_id||!parts.active_count||lot.receipt_id!==receipt.id||invoice.user_id!==owner||invoice.id!==lot.invoice_id||invoice.revision_id!==lot.invoice_revision_id||invoice.currency!==lot.invoice_currency)throw new Error('Complete saved reversal source differs.');
 const total=amount(invoice.invoice_minor,true),allocated=amount(invoice.allocated_minor),source=lot.conversion_fact.source_snapshot.receipt!;
 if(allocated>total||parts.original_minor>allocated||parts.cash_pence>receipt.allocated_cash_pence||source.import_id!==receipt.import_id||source.source_row_id!==receipt.source_row_id||source.transaction_date!==receipt.cash_date||source.signed_amount_pence!==receipt.signed_cash_pence)throw new Error('Saved complete reversal balances disagree.');
 return{kind:'reverse' as const,intent:i,receipt,parts,invoice:{id:lot.invoice_id,currency:lot.invoice_currency,total_minor:total,allocated_minor:allocated},financial_stamp:i.expected_stamp};
}
export type FxSavedReview=ReturnType<typeof parseFxReviewedSnapshot>;
export function parseFxReviewedResult(value:unknown,review:FxSavedReview){
 const p=fxObject(value);if(p.recognized_income_change_pence!==0||p.recognized_expense_change_pence!==0)throw new Error('FX matching cannot create recognised postings.');
 if(review.kind==='allocate'){
  exactObject(p,['schema_version','allocation_ids','rows','allocated_cash_pence','recognized_income_change_pence','recognized_expense_change_pence']);
  if(p.schema_version!=='fx-settlement-result/1'||!Array.isArray(p.rows)||p.rows.length!==review.rows.length||!Array.isArray(p.allocation_ids)||p.allocation_ids.length!==p.rows.length)throw new Error('Complete saved FX result unavailable.');
  const ids=p.allocation_ids.map(fxEvidenceId),rows=p.rows.map((v,index)=>{const r=exactObject(v,['allocation_id','invoice_id','invoice_currency','invoice_minor','cash_currency','cash_minor','lot_id','lot_version','snapshot']),a=review.intent.allocations.find(a=>a.invoice_id===r.invoice_id),row=review.rows.find(a=>a.invoice_id===r.invoice_id);if(!a||!row||r.allocation_id!==ids[index]||r.invoice_currency!==row.invoice_currency||r.invoice_minor!==a.invoice_minor||r.cash_currency!=='GBP'||r.cash_minor!==a.cash_minor||r.lot_id!==a.conversion_lot_id||r.lot_version!==a.conversion_lot_version+1)throw new Error('Saved allocation result differs from its exact request.');
   const expected={schema_version:'fx-allocation-snapshot/1',lot_id:a.conversion_lot_id,invoice_revision_id:a.invoice_revision_id,invoice_fact_revision_id:a.invoice_evidence_revision_id,conversion_fact_revision_id:a.conversion_evidence_revision_id,receipt_version:review.intent.receipt_version,receipt_record_id:review.receipt.record_id,source_row_id:review.receipt.source_row_id,import_id:review.receipt.import_id,cash_date:review.receipt.cash_date,value_date:review.receipt.cash_date,observed_cash_pence:review.receipt.signed_cash_pence,receipt_recognized_gbp_pence:review.receipt.signed_cash_pence,ruleset_id:review.intent.ruleset_id,invoice_currency:row.invoice_currency,cash_currency:'GBP',rate:a.rate,conversion_date:a.conversion_date,evidence_date:row.evidence_date,documented_invoice_limit_minor:row.invoice_limit_minor,documented_cash_limit_minor:row.cash_limit_pence,tranche:row.tranche};
   if(!fxHistoryEqual(r.snapshot,expected))throw new Error('Saved FX source snapshot differs.');return{allocation_id:ids[index],invoice_id:a.invoice_id,invoice_currency:row.invoice_currency,invoice_minor:a.invoice_minor,cash_currency:'GBP' as const,cash_minor:a.cash_minor,lot_id:a.conversion_lot_id,lot_version:a.conversion_lot_version+1,snapshot:expected};});
  if(new Set(ids).size!==ids.length||new Set(rows.map(r=>r.invoice_id)).size!==rows.length||p.allocated_cash_pence!==rows.reduce((s,r)=>s+r.cash_minor,0))throw new Error('Saved FX totals disagree.');
  return{schema_version:'fx-settlement-result/1' as const,allocation_ids:ids,rows,allocated_cash_pence:p.allocated_cash_pence as number,recognized_income_change_pence:0,recognized_expense_change_pence:0};
 }
 exactObject(p,['schema_version','lot_id','reversal_ids','released_invoice_currency','released_invoice_minor','released_cash_currency','released_cash_pence','lot_version','recognized_income_change_pence','recognized_expense_change_pence']);
 if(p.schema_version!=='fx-lot-reversal-result/1'||p.lot_id!==review.intent.lot_id||!Array.isArray(p.reversal_ids)||p.reversal_ids.length!==review.parts.active_count||p.released_invoice_currency!==review.parts.lot.invoice_currency||p.released_invoice_minor!==review.parts.original_minor||p.released_cash_currency!=='GBP'||p.released_cash_pence!==review.parts.cash_pence||p.lot_version!==review.parts.version+review.parts.active_count)throw new Error('Complete saved reversal result differs.');
 const ids=p.reversal_ids.map(fxEvidenceId);if(new Set(ids).size!==ids.length)throw new Error('Unique saved reversal events required.');
 return{schema_version:'fx-lot-reversal-result/1' as const,lot_id:review.intent.lot_id,reversal_ids:ids,released_invoice_currency:review.parts.lot.invoice_currency,released_invoice_minor:review.parts.original_minor,released_cash_currency:'GBP' as const,released_cash_pence:review.parts.cash_pence,lot_version:fxCount(p.lot_version,1),recognized_income_change_pence:0,recognized_expense_change_pence:0};
}
export function parseFxReviewedRequest(ownerValue:string,value:unknown){
 const owner=fxEvidenceId(ownerValue),p=fxObject(value),r=fxObject(p.request);
 if(p.schema_version!=='fx-reviewed-request/1'||r.user_id!==owner||r.author!==owner||typeof r.kind!=='string'||!['allocate','reverse'].includes(r.kind)||typeof p.state!=='string'||!['prepared','completed','cancelled'].includes(p.state)||new TextEncoder().encode(JSON.stringify(value)).length>4400000)throw new Error('Owned saved FX request unavailable.');
 const kind=r.kind as FxRequestKind,intent=fxRequestIntent(kind,r.intent),review=parseFxReviewedSnapshot(owner,kind,r.review_snapshot,intent),request_id=fxEvidenceId(r.request_id);
 if(request_id!==intent.request_id||(p.state==='completed')!==(p.result!==null))throw new Error('Saved request state differs.');
 const result=p.state==='completed'?parseFxReviewedResult(p.result,review):null;
 return{schema_version:'fx-reviewed-request/1' as const,owner_id:owner,request_id,kind,created_at:time(r.created_at),intent,review,state:p.state as 'prepared'|'completed'|'cancelled',result};
}
export type FxReviewedRequest=ReturnType<typeof parseFxReviewedRequest>;

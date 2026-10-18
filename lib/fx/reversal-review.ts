import { redactBankDetailsForPrompt } from '../ai/redaction';
import { exactObject } from './currency';
import { fxEvidenceId } from './document-facts';
import { fxHistoryEqual, parseFxLotPortions } from './settlement-history';
import { parseFxSettlementCatalog } from './settlement-catalog';
export function validateFxLotReversalIntent(value: unknown) {
 const p=exactObject(value,['schema_version','lot_id','lot_version','expected_stamp','rationale','request_id']);
 if(p.schema_version!=='fx-lot-reversal-intent/1'||typeof p.expected_stamp!=='string'||!/^[a-f0-9]{32}$/.test(p.expected_stamp)||!Number.isSafeInteger(p.lot_version)||(p.lot_version as number)<1||(p.lot_version as number)>=2147483647||typeof p.rationale!=='string'||!p.rationale.trim()||p.rationale.trim().length>1000)throw new Error('Exact complete FX reversal intent required.');
 const rationale=redactBankDetailsForPrompt(p.rationale.trim());if(rationale.length>1000)throw new Error('Use a bounded reversal reason without private details.');
 return{schema_version:'fx-lot-reversal-intent/1' as const,lot_id:fxEvidenceId(p.lot_id),lot_version:p.lot_version as number,expected_stamp:p.expected_stamp,rationale,request_id:fxEvidenceId(p.request_id)};
}
/** A complete retained lot is reversible even if current evidence is unavailable. */
export function fxLotReversalReadback(owner:string,value:unknown,raw:unknown){
 const c=parseFxSettlementCatalog(owner,raw),p=exactObject(value,['schema_version','lot_id','lot_version','expected_stamp','rationale','request_id']);
 if(p.schema_version!=='fx-lot-reversal-intent/1'||p.expected_stamp!==c.financial_stamp||!Number.isSafeInteger(p.lot_version))throw new Error('Current complete FX reversal context required.');
 if(typeof p.rationale!=='string'||!p.rationale.trim()||p.rationale.trim().length>1000)throw new Error('Explain the complete FX reversal.');
 const rationale=redactBankDetailsForPrompt(p.rationale.trim());if(rationale.length>1000)throw new Error('Use a bounded reversal reason without private details.');
 const lot=c.lots.find(l=>l.id===fxEvidenceId(p.lot_id));if(!lot||lot.version!==p.lot_version||!lot.active_count)throw new Error('Choose the current active retained conversion lot.');
 const receipt=c.receipts.find(r=>r.id===lot.receipt_id)!,invoice=c.invoices.find(i=>i.id===lot.invoice_id)!;
 return{intent:{schema_version:'fx-lot-reversal-intent/1' as const,lot_id:lot.id,lot_version:lot.version,expected_stamp:c.financial_stamp,rationale,request_id:fxEvidenceId(p.request_id)},result:{
  schema_version:'fx-lot-reversal-review/1' as const,lot,receipt_id:receipt.id,import_id:receipt.import_id,source_row_id:receipt.source_row_id,
  released_original_minor:lot.prior_invoice_minor,invoice_currency:lot.invoice_currency,released_cash_pence:lot.prior_cash_minor,active_portions:lot.active_count,
  outstanding_original_before_minor:invoice.invoice_minor-invoice.allocated_minor,outstanding_original_after_minor:invoice.invoice_minor-invoice.allocated_minor+lot.prior_invoice_minor,
  unallocated_cash_before_pence:receipt.signed_minor-receipt.allocated_minor,unallocated_cash_after_pence:receipt.signed_minor-receipt.allocated_minor+lot.prior_cash_minor,
  recognized_income_change_pence:0,recognized_expense_change_pence:0,financial_action:'preview_only' as const,
 }};
}

/** Current complete read-back includes every active immutable portion. */
export function completeFxLotReversalReadback(owner:string,value:unknown,raw:unknown,portionValue:unknown){
 const review=fxLotReversalReadback(owner,value,raw),portions=parseFxLotPortions(owner,portionValue),lot=review.result.lot,retained=portions.lot;
 const shared=['conversion_family_id','ruleset_id','invoice_currency','cash_currency','invoice_limit_minor','cash_limit_minor','rate','conversion_date','evidence_date'] as const;
 if(shared.some(k=>!fxHistoryEqual(retained[k],lot[k])))throw new Error('Retained FX recipe and complete review changed.');
 if(portions.financial_stamp!==review.intent.expected_stamp||retained.id!==lot.id||portions.version!==lot.version||portions.active_count!==lot.active_count||portions.original_minor!==lot.prior_invoice_minor||portions.cash_pence!==lot.prior_cash_minor||retained.invoice_id!==lot.invoice_id||retained.invoice_revision_id!==lot.invoice_revision_id||retained.invoice_fact_revision_id!==lot.invoice_fact_revision_id||retained.conversion_fact_revision_id!==lot.conversion_fact_revision_id||retained.receipt_id!==lot.receipt_id||retained.receipt_version!==lot.receipt_version||retained.invoice_fact.document_id!==lot.invoice_document_id||retained.invoice_fact.source_snapshot.document_source.document.file_sha256!==lot.invoice_document_sha256||retained.conversion_document_id!==lot.conversion_document_id||retained.conversion_fact.source_snapshot.document_source.document.file_sha256!==lot.conversion_document_sha256)throw new Error('Complete FX portions and reviewed balances changed.');
 return{intent:review.intent,result:{...review.result,schema_version:'fx-lot-reversal-review/2' as const,portions:portions.portions}};
}

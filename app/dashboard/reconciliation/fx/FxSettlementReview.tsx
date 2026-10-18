'use client';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { prepareFxAllocation } from './actions';
function Submit({enabled}:{enabled:boolean}){const{pending}=useFormStatus();return <button type="submit" data-testid="fx-match-save" disabled={!enabled||pending} className="rounded border p-2">{pending?'Saving exact review…':'Save review and continue'}</button>}
import { currencyAmount } from '@/lib/fx/currency';
import { authoritativeFxSettlementReview, fxSettlementChoices, type FxAuthoritativeCatalog } from '@/lib/fx/settlement-catalog';
import type { FxConversionDocumentData } from '@/lib/fx/document-facts';
import { fxAmountReadback, fxRateReadback } from '@/lib/fx/readback';
export default function FxSettlementReview(props:{catalog:FxAuthoritativeCatalog;proposedLotId:string;requestId:string;receiptId?:string}){return <Review key={JSON.stringify(props)} {...props}/>;}
function Review({catalog:c,proposedLotId,requestId,receiptId}:{catalog:FxAuthoritativeCatalog;proposedLotId:string;requestId:string;receiptId?:string}){
 const [choiceId,setChoice]=useState(''),[original,setOriginal]=useState(''),[cash,setCash]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);
 const choices=fxSettlementChoices(c).filter(o=>!receiptId||o.receipt_id===receiptId),choice=choices.find(o=>o.conversion_fact_revision_id===choiceId),fact=c.evidence.facts.find(f=>f.id===choiceId),invoice=c.invoices.find(i=>i.id===choice?.invoice_id),receipt=c.receipts.find(r=>r.id===choice?.receipt_id);
 let preview=null,problem='';
 try{if(choice?.eligible&&fact&&invoice&&receipt){const data=fact.data as FxConversionDocumentData,parent=c.evidence.facts.find(p=>p.id===fact.invoice_evidence_revision_id)!;
  preview=authoritativeFxSettlementReview(c.owner_id,{schema_version:'fx-settlement-intent/1',ruleset_id:c.ruleset_id,receipt_id:receipt.id,receipt_version:receipt.decision_version,expected_stamp:c.financial_stamp,rationale:reason,request_id:requestId,fee_mode:'none',receipt_valuation_id:null,receipt_valuation_evidence_revision_id:null,
   allocations:[{invoice_id:invoice.id,invoice_revision_id:invoice.revision_id,invoice_minor:currencyAmount(original,invoice.currency),cash_minor:currencyAmount(cash,'GBP'),conversion_date:data.conversion_date,rate:data.rate,invoice_evidence_id:parent.family_id,invoice_evidence_revision_id:parent.id,conversion_evidence_id:fact.family_id,conversion_evidence_revision_id:fact.id,conversion_lot_id:choice.lot_id??proposedLotId,conversion_lot_version:choice.lot_version}]},c);
 }}catch(error){problem=error instanceof Error?error.message:'Review the exact source and amounts.';}
 const row=preview?.result.rows[0];
 return <form data-testid="fx-match-form" action={prepareFxAllocation} className="space-y-4 rounded border p-4">
  <input type="hidden" name="intent" value={preview?JSON.stringify(preview.intent):''}/><h2 className="text-xl font-semibold">Draft FX match read-back</h2>
  <label className="block">Conversion evidence<select data-testid="fx-match-choice" value={choiceId} onChange={e=>{setChoice(e.target.value);setOriginal('');setCash('');setConfirmed(false);}} className="block w-full rounded border p-2"><option value="">Choose an eligible conversion</option>{choices.map(o=><option key={o.conversion_fact_revision_id} value={o.conversion_fact_revision_id} disabled={!o.eligible}>{o.eligible?'Eligible':'Unavailable'} · evidence {o.conversion_fact_revision_id}{o.blocked_reason?' · '+o.blocked_reason.replaceAll('_',' '):''}</option>)}</select></label>
  {choice&&invoice&&receipt&&<p data-testid="fx-match-capacity">Original outstanding {fxAmountReadback(invoice.invoice_minor-invoice.allocated_minor,invoice.currency)}. Available observed cash {fxAmountReadback(receipt.signed_minor-receipt.allocated_minor,'GBP')}. Receipt decision version {receipt.decision_version}.</p>}
  <label className="block">Original invoice portion {invoice?.currency??''}<input data-testid="fx-match-original" value={original} inputMode="decimal" maxLength={20} onChange={e=>{setOriginal(e.target.value);setConfirmed(false);}} className="block rounded border p-2"/></label>
  <label className="block">Actual GBP cash portion<input data-testid="fx-match-cash" value={cash} inputMode="decimal" maxLength={20} onChange={e=>{setCash(e.target.value);setConfirmed(false);}} className="block rounded border p-2"/></label>
  <label className="block">Evidence and reason<textarea data-testid="fx-match-reason" value={reason} maxLength={1000} onChange={e=>{setReason(e.target.value);setConfirmed(false);}} className="block w-full rounded border p-2"/></label>
  {preview&&row?<section data-testid="fx-match-readback" className="space-y-2 rounded border p-3"><p>Draft: match original {fxAmountReadback(row.invoice_minor,row.invoice_currency)} to actual cash {fxAmountReadback(row.cash_minor,'GBP')}. {row.conversion_lot_binding_state==='proposed'?'This lot identity is proposed and has not been saved.':'Reuse the saved conversion lot.'} History version {row.conversion_lot_version}.</p>
   <p>Original outstanding: {fxAmountReadback(row.invoice_outstanding_before_minor,row.invoice_currency)} → {fxAmountReadback(row.invoice_outstanding_after_minor,row.invoice_currency)}. Unallocated observed cash after this draft: {fxAmountReadback(preview.result.unallocated_cash_minor,'GBP')}.</p>
   <p>Rate {fxRateReadback(row.conversion.rate)}. Conversion date {row.conversion_date}; cash date {preview.result.cash_date}; evidence date {row.conversion_evidence.evidence_date}. Cumulative conversion retains prior original {fxAmountReadback(row.tranche.before.source_minor,row.invoice_currency)} and prior cash {fxAmountReadback(row.tranche.before.target_minor,'GBP')}. Exact halves round away from zero; cumulative rounding can leave a zero-cash final portion.</p>
   <p>Documented limits: {fxAmountReadback(row.documented_invoice_limit_minor,row.invoice_currency)} and {fxAmountReadback(row.documented_cash_limit_minor,'GBP')}. Remaining documented original after this draft: {fxAmountReadback(row.documented_invoice_remaining_minor,row.invoice_currency)}.</p>
   <p>Invoice fact {row.invoice_evidence.revision_id}; canonical invoice revision {row.invoice_revision_id}. Conversion fact {row.conversion_evidence.revision_id}. Retained hashes: {row.invoice_evidence.document_sha256}; {row.conversion_evidence.document_sha256}.</p>
   <p>Recognised income change {fxAmountReadback(0,'GBP')}; expense change {fxAmountReadback(0,'GBP')}. Matching creates no additional income. Fees and foreign receipt valuations require separate review.</p>
  </section>:<p data-testid="fx-match-incomplete">Choose current evidence, exact original and actual cash portions, and a reason. Differences, unsupported fees or stale sources must be resolved before a read-back is available. {problem}</p>}
  <label className="flex gap-2"><input type="checkbox" data-testid="fx-match-confirm" name="humanConfirmed" value="yes" required checked={confirmed} disabled={!preview} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed these exact draft amounts, source versions and evidence. Save this review for a separate final financial confirmation.</label>
  <Submit enabled={!!preview&&confirmed}/>
  <p data-testid="fx-match-activation">Saving this review creates no financial match. The next page retains this exact request and requires separate final confirmation.</p>
 </form>;
}

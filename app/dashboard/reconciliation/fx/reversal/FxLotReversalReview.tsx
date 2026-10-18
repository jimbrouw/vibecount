'use client';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { prepareFxReversal } from '../actions';
function Submit({enabled}:{enabled:boolean}){const{pending}=useFormStatus();return <button type="submit" data-testid="fx-reversal-save" disabled={!enabled||pending} className="rounded border p-2">{pending?'Saving exact review…':'Save complete reversal review and continue'}</button>}
import type { FxLotPortionReview } from '@/lib/fx/settlement-history';
import { completeFxLotReversalReadback } from '@/lib/fx/reversal-review';
import { fxAmountReadback, fxRateReadback } from '@/lib/fx/readback';
import type { FxAuthoritativeCatalog } from '@/lib/fx/settlement-catalog';
export default function FxLotReversalReview(props:{catalog:FxAuthoritativeCatalog;portionReview:FxLotPortionReview;lotId:string;requestId:string}){return <Review key={props.catalog.financial_stamp+props.requestId+props.lotId+JSON.stringify(props.portionReview)} {...props}/>;}
function Review({catalog:c,portionReview,lotId,requestId}:{catalog:FxAuthoritativeCatalog;portionReview:FxLotPortionReview;lotId:string;requestId:string}){
 const [reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),lot=c.lots.find(l=>l.id===lotId);let preview=null;
 try{preview=completeFxLotReversalReadback(c.owner_id,{schema_version:'fx-lot-reversal-intent/1',lot_id:lotId,lot_version:lot?.version,expected_stamp:c.financial_stamp,rationale:reason,request_id:requestId},c,portionReview);}catch{/* No stale/empty lot can be confirmed. */}
 const r=preview?.result;
 return <form data-testid="fx-reversal-form" action={prepareFxReversal} className="space-y-4 rounded border p-4"><input type="hidden" name="intent" value={preview?JSON.stringify(preview.intent):''}/><h2 className="text-xl font-semibold">Draft complete-lot reversal</h2>
  <p>Reverse all active portions in descending order. Preserve the original receipt and immutable allocation history. Retained evidence can support reversal even when its source is no longer available for a new match.</p>
  {lot&&<p data-testid="fx-reversal-retained">Saved lot {lot.id}; {lot.active_count} active portions; all-event version {lot.version}. Retained original {fxAmountReadback(lot.prior_invoice_minor,lot.invoice_currency)} and actual cash {fxAmountReadback(lot.prior_cash_minor,'GBP')}.</p>}
  <label className="block">Evidence and reason<textarea data-testid="fx-reversal-reason" value={reason} maxLength={1000} onChange={e=>{setReason(e.target.value);setConfirmed(false);}} className="block w-full rounded border p-2"/></label>
  {r?<section data-testid="fx-reversal-readback" className="space-y-2 rounded border p-3"><p>Draft: reverse {r.active_portions} portions, releasing original {fxAmountReadback(r.released_original_minor,r.invoice_currency)} and cash {fxAmountReadback(r.released_cash_pence,'GBP')}. Zero-cash portions remain included.</p>
   <p>Original outstanding: {fxAmountReadback(r.outstanding_original_before_minor,r.invoice_currency)} → {fxAmountReadback(r.outstanding_original_after_minor,r.invoice_currency)}. Unallocated receipt cash: {fxAmountReadback(r.unallocated_cash_before_pence,'GBP')} → {fxAmountReadback(r.unallocated_cash_after_pence,'GBP')}.</p>
   <p>Retained rate {fxRateReadback(r.lot.rate)}; conversion date {r.lot.conversion_date}; evidence date {r.lot.evidence_date}. Original fact {r.lot.invoice_fact_revision_id}; conversion fact {r.lot.conversion_fact_revision_id}. Retained source hashes: {r.lot.invoice_document_sha256}; {r.lot.conversion_document_sha256}.</p>
   <section data-testid="fx-reversal-portions"><h3 className="font-semibold">Every active retained portion, in allocation order</h3><ol className="space-y-3">{r.portions.map(p=><li key={p.id} data-testid={`fx-reversal-portion-${p.id}`}><p>History ordinal {p.lot_event_ordinal}: original {fxAmountReadback(p.invoice_minor,p.invoice_currency)}; cash {fxAmountReadback(p.amount_pence,'GBP')}. Allocated at {p.created_at}.</p><p>Cumulative original {fxAmountReadback(p.fx_snapshot.tranche.before.source_minor,p.invoice_currency)} → {fxAmountReadback(p.fx_snapshot.tranche.after.source_minor,p.invoice_currency)}; cumulative cash {fxAmountReadback(p.fx_snapshot.tranche.before.target_minor,'GBP')} → {fxAmountReadback(p.fx_snapshot.tranche.after.target_minor,'GBP')}. Retained record {p.fx_snapshot.receipt_record_id}; request {p.request_id}.</p><p>Original units and cash will be released exactly as retained, in descending allocation order.</p></li>)}</ol></section>
   <p>Recognised income change {fxAmountReadback(0,'GBP')}; expense change {fxAmountReadback(0,'GBP')}. Other lots and native matches remain intact.</p>
  </section>:<p data-testid="fx-reversal-incomplete">Choose a saved active lot and add the review reason. Reversed or missing lots cannot be reversed again.</p>}
  <label className="flex gap-2"><input type="checkbox" data-testid="fx-reversal-confirm" name="humanConfirmed" value="yes" required checked={confirmed} disabled={!r} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed every displayed retained portion, the evidence and both balances. Save this review for a separate final financial confirmation.</label>
  <Submit enabled={!!r&&confirmed}/><p>Saving this review creates no financial reversal. The next page retains this exact request and requires separate final confirmation.</p>
 </form>;
}

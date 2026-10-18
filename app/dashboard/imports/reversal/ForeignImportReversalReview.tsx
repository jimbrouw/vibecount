'use client';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { ForeignImportReversal } from '@/lib/records/foreign-import-reversal';
import { fxAmountReadback,fxAggregateReadback } from '@/lib/fx/readback';
import { reverseForeignImport } from './foreign-actions';
function Submit({enabled}:{enabled:boolean}){const {pending}=useFormStatus();return <button data-testid="foreign-reversal-submit" disabled={!enabled||pending} className="rounded border p-3">{pending?'Reversing import…':'Confirm import reversal'}</button>;}
export default function ForeignImportReversalReview(props:{review:ForeignImportReversal;requestId:string}){return <Draft key={JSON.stringify(props)} {...props}/>;}
function Draft({review:r,requestId}:{review:ForeignImportReversal;requestId:string}){
 const [reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);
 return <section data-testid="foreign-reversal-review" className="space-y-4 rounded border p-4">
  <h2 className="text-xl font-semibold">Review foreign import reversal</h2>
  <p>Retain every original row, valuation and classification decision. Exclude approved GBP effects and reset {r.sources.length} observations to Unknown. Only this import becomes discarded.</p>
  <ul>{r.sources.map(s=><li className="my-3" key={s.id} data-testid={`foreign-reversal-source-${s.id}`}><p>{s.date}: {fxAmountReadback(s.original_signed_minor,s.currency)} — {s.classification}.</p><p>Approved {s.record_type} to exclude: {fxAmountReadback(s.approved_pence,'GBP')}. Source row: {s.source_row_id}.</p>{s.valuation_revision_id&&<p>Valuation revision: {s.valuation_revision_id}. Classification request: {s.classification_request_id}.</p>}</li>)}</ul>
  <div data-testid="foreign-reversal-readback"><p>Income change: {fxAggregateReadback(r.income_delta_pence,'GBP')}. Expense change: {fxAggregateReadback(r.expense_delta_pence,'GBP')}. Profit change: {fxAggregateReadback(r.profit_delta_pence,'GBP')}.</p><p>Original currency amounts are not GBP cash amounts. No payment is made.</p>{r.income_delta_pence===0&&r.expense_delta_pence===0&&<p>No approved GBP amount will be removed. Original observations and zero/excluded decisions remain in history.</p>}</div>
  {r.blocked?<p role="alert" data-testid="foreign-reversal-blocked">This import is already discarded or has active invoice, transfer, refund or duplicate relationships. Review and release those relationships before reversal.</p>:<form action={reverseForeignImport} className="space-y-3" data-testid="foreign-reversal-form">
   <input type="hidden" name="importId" value={r.import_id}/><input type="hidden" name="stamp" value={r.stamp}/><input type="hidden" name="requestId" value={requestId}/>
   <label className="block">Reason for reversal<input className="block w-full rounded border p-2" name="reason" required maxLength={1000} value={reason} data-testid="foreign-reversal-reason" onChange={e=>{setReason(e.target.value);setConfirmed(false);}}/></label>
   <label className="block"><input type="checkbox" name="humanConfirmed" value="yes" required data-testid="foreign-reversal-confirm" checked={confirmed} disabled={!reason.trim()} onChange={e=>setConfirmed(e.target.checked)}/> I reviewed every original amount and GBP change and confirm this import reversal.</label>
   <Submit enabled={!!reason.trim()&&confirmed}/>
  </form>}
 </section>;
}

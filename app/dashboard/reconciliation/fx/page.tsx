import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { readFxSettlementCatalog } from '@/lib/fx/settlement-catalog-store';
import { readFxRequestIndex } from '@/lib/fx/reviewed-request-store';
import { fxEvidenceId } from '@/lib/fx/document-facts';
import { fxAmountReadback } from '@/lib/fx/readback';
import FxSettlementReview from './FxSettlementReview';
export default async function FxSettlementPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const db=await createClient(),{data:{user},error}=await db.auth.getUser();if(error||!user)redirect('/login');const p=await searchParams;let index=null;try{index=await readFxRequestIndex(db,user.id);}catch{/* Fail closed on unresolved request history. */}let catalog=null,receipt:string|undefined;
 try{if(p.receipt!==undefined)receipt=fxEvidenceId(p.receipt);catalog=await readFxSettlementCatalog(db,user.id);if(receipt&&!catalog.receipts.some(r=>r.id===receipt))throw new Error();}catch{catalog=null;}
 return <main className="mx-auto max-w-5xl space-y-5 p-5"><h1 className="text-2xl font-semibold">Review FX invoice matches</h1><p>Original invoice currency and observed GBP cash have separate balances. Matching creates no new income. Save a review first, then confirm the financial match from its immutable saved request.</p>
  <nav className="flex flex-wrap gap-4"><Link data-testid="fx-request-history-link" className="underline" href="/dashboard/reconciliation/fx/requests">Saved reviews and results</Link><Link data-testid="fx-match-back" href="/dashboard/reconciliation" className="underline">GBP reconciliation</Link><Link data-testid="fx-match-evidence" href="/dashboard/reconciliation/fx/evidence" className="underline">Review evidence</Link><Link data-testid="fx-match-invoices" href="/dashboard/reconciliation/fx/invoices" className="underline">Captured invoices</Link></nav>
  {!index?<p role="alert" data-testid="fx-pending-unavailable">Saved request history unavailable. Reload before preparing another review.</p>:index.pending_request_id?<Link data-testid="fx-open-request" className="block underline" href={'/dashboard/reconciliation/fx/requests?request='+index.pending_request_id}>Finish or cancel the existing saved FX review</Link>:!catalog?<p role="alert" data-testid="fx-match-unavailable">Complete owned FX review sources are unavailable. Reload before relying on balances.</p>:<><FxSettlementReview catalog={catalog} proposedLotId={randomUUID()} requestId={randomUUID()} receiptId={receipt}/>
   <a data-testid="fx-reconciliation-export" className="block underline" href="/api/reconciliation/export">Export complete draft reconciliation and source references</a><section><h2 className="text-xl font-semibold">Retained conversion lots</h2><p>History remains visible after evidence withdrawal or source loss. A zero-cash portion is still a linked relationship.</p><ul className="space-y-3">{catalog.lots.filter(l=>!receipt||l.receipt_id===receipt).map(l=><li key={l.id} data-testid={`fx-retained-lot-${l.id}`}><p>{fxAmountReadback(l.prior_invoice_minor,l.invoice_currency)} original; {fxAmountReadback(l.prior_cash_minor,'GBP')} cash; {l.active_count} active portions; all-event version {l.version}.</p><Link data-testid={`fx-lot-review-${l.id}`} href={`/dashboard/reconciliation/fx/reversal?lot=${l.id}`} className="underline">Review complete lot reversal and retained evidence</Link></li>)}</ul></section>
  </>}
 </main>;
}

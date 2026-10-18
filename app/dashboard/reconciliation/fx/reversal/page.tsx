import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { readFxSettlementCatalog } from '@/lib/fx/settlement-catalog-store';
import { readFxLotPortions } from '@/lib/fx/settlement-history-store';
import { readFxRequestIndex } from '@/lib/fx/reviewed-request-store';
import { fxEvidenceId } from '@/lib/fx/document-facts';
import FxLotReversalReview from './FxLotReversalReview';
export default async function FxReversalPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const db=await createClient(),{data:{user},error}=await db.auth.getUser();if(error||!user)redirect('/login');const p=await searchParams;let index=null;try{index=await readFxRequestIndex(db,user.id);}catch{/* Fail closed on unresolved request history. */}let catalog=null,portionReview=null,lotId='';
 try{lotId=fxEvidenceId(p.lot);catalog=await readFxSettlementCatalog(db,user.id);if(!catalog.lots.some(l=>l.id===lotId))throw new Error();portionReview=await readFxLotPortions(db,user.id,lotId);if(portionReview.financial_stamp!==catalog.financial_stamp||portionReview.version!==catalog.lots.find(l=>l.id===lotId)!.version)throw new Error();}catch{catalog=null;}
 return <main className="mx-auto max-w-5xl space-y-5 p-5"><h1 className="text-2xl font-semibold">Review complete FX reversal</h1><Link data-testid="fx-reversal-back" href="/dashboard/reconciliation/fx" className="underline">Back to FX matches</Link>
  {!index?<p role="alert" data-testid="fx-pending-unavailable">Saved request history unavailable. Reload before preparing another review.</p>:index.pending_request_id?<Link data-testid="fx-open-request" className="block underline" href={'/dashboard/reconciliation/fx/requests?request='+index.pending_request_id}>Finish or cancel the existing saved FX review</Link>:catalog&&portionReview?<FxLotReversalReview catalog={catalog} portionReview={portionReview} lotId={lotId} requestId={randomUUID()}/>:<p role="alert" data-testid="fx-reversal-unavailable">The complete owned retained lot is unavailable. Reload FX history before reviewing.</p>}
 </main>;
}

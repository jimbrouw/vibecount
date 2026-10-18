import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { fxEvidenceId } from '@/lib/fx/document-facts';
import { readFxRequestIndex, readFxReviewedRequest } from '@/lib/fx/reviewed-request-store';
import RequestReview from './RequestReview';
export default async function FxRequestsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const db=await createClient(),{data:{user},error}=await db.auth.getUser();if(error||!user)redirect('/login');const p=await searchParams;let index=null,request=null;
 try{index=await readFxRequestIndex(db,user.id,p.after===undefined?null:fxEvidenceId(p.after));}catch{/* Withhold partial history. */}
 if(p.request!==undefined)try{request=await readFxReviewedRequest(db,user.id,fxEvidenceId(p.request));}catch{/* No missing request is interpreted as a financial success. */}
 return <main className="mx-auto max-w-5xl space-y-5 p-5"><h1 className="text-2xl font-semibold">Saved FX reviews and results</h1><Link data-testid="fx-requests-back" href="/dashboard/reconciliation/fx" className="underline">Back to FX matching</Link>
  {p.notice==='prepare-check'&&<p role="alert">The review save response could not be confirmed. No financial action was attempted by that preparation step. Check this request and the saved review list before preparing another.</p>}
  {p.notice==='financial-check'&&<p role="alert">The financial response could not be confirmed. Check the retained result below. If it still awaits confirmation, checking or retrying this same request is safe; do not create a replacement request to guess the outcome.</p>}
  {p.notice==='cancel-check'&&<p role="alert">Cancellation could not be confirmed. Check this exact request; a completed financial result cannot be cancelled.</p>}
  {p.notice==='review'&&<p role="alert">Review this saved request and explicitly confirm the selected action.</p>}
  {request?<RequestReview request={request}/>:p.request!==undefined?<p data-testid="fx-request-unavailable" role="alert">The complete owned saved request is unavailable. This does not establish a financial result. Reload this request and check the history list.</p>:null}
  {index?<section data-testid="fx-request-history" className="space-y-3"><h2 className="text-xl font-semibold">Request history</h2>{index.pending_request_id&&<Link data-testid="fx-request-pending" className="block underline" href={'/dashboard/reconciliation/fx/requests?request='+index.pending_request_id}>Finish or cancel the existing uncompleted FX review</Link>}<ul>{index.requests.slice(0,20).map(r=><li key={r.request_id}><Link className="underline" href={'/dashboard/reconciliation/fx/requests?request='+r.request_id}>{r.kind==='allocate'?'Match':'Complete reversal'} · {r.state} · {r.created_at} · {r.request_id}</Link></li>)}</ul>{index.requests.length>20&&<Link data-testid="fx-requests-next" href={'/dashboard/reconciliation/fx/requests?after='+index.requests[19].request_id} className="underline">Older request page</Link>}</section>:<p role="alert" data-testid="fx-request-history-unavailable">Saved request history unavailable. Reload before preparing another review.</p>}
 </main>;
}

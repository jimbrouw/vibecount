import 'server-only';
import { fxEvidenceId } from './document-facts';
import { fxHistoryEqual, fxObject } from './settlement-history';
import { readFxSettlementCatalog } from './settlement-catalog-store';
import { authoritativeFxSettlementReview } from './settlement-catalog';
import { readFxLotPortions } from './settlement-history-store';
import { completeFxLotReversalReadback } from './reversal-review';
import { verifyOwnedSettlementSources } from './settlement-source-store';
import { fxRequestIntent, parseFxReviewedRequest, parseFxReviewedResult, type FxRequestKind } from './reviewed-request';
type Client=Awaited<ReturnType<typeof import('../supabase/server').createClient>>;
export async function readFxReviewedRequest(db:Client,owner:string,request:string){
 const id=fxEvidenceId(request),r=await db.rpc('read_fx_reviewed_request',{p_request:id});if(r.error)throw new Error('Saved FX request unavailable.');
 const result=parseFxReviewedRequest(owner,r.data);if(result.request_id!==id)throw new Error('Selected FX request differs.');return result;
}
export async function readFxRequestIndex(db:Client,owner:string,after:string|null=null){
 const r=await db.rpc('read_fx_reviewed_requests',{p_after:after===null?null:fxEvidenceId(after)});if(r.error)throw new Error('Saved FX reviews unavailable.');
 const p=fxObject(r.data);if(p.schema_version!=='fx-reviewed-request-index/1'||p.owner_id!==fxEvidenceId(owner)||!Array.isArray(p.requests)||p.requests.length>21)throw new Error('Complete owned review index unavailable.');
 const requests=p.requests.map(v=>{const r=fxObject(v);if(typeof r.kind!=='string'||!['allocate','reverse'].includes(r.kind)||typeof r.state!=='string'||!['prepared','completed','cancelled'].includes(r.state)||typeof r.created_at!=='string'||!Number.isFinite(Date.parse(r.created_at)))throw new Error('Owned review index entry unavailable.');return{request_id:fxEvidenceId(r.request_id),kind:r.kind as FxRequestKind,state:r.state,created_at:r.created_at};});
 if(new Set(requests.map(r=>r.request_id)).size!==requests.length||requests.some((r,i)=>i>0&&r.request_id>=requests[i-1].request_id)||after!==null&&requests.some(r=>r.request_id>=after))throw new Error('Complete ordered review index unavailable.');
 return{pending_request_id:p.pending_request_id===null?null:fxEvidenceId(p.pending_request_id),requests};
}
export async function prepareFxReviewedRequest(db:Client,owner:string,kind:FxRequestKind,value:unknown){
 const intent=fxRequestIntent(kind,value),prior=await db.from('fx_reviewed_requests').select('request_id').eq('user_id',owner).eq('request_id',intent.request_id).maybeSingle();
 if(prior.error)throw new Error('Saved review history unavailable.');
 if(!prior.data){const catalog=await readFxSettlementCatalog(db,owner);if(kind==='allocate')authoritativeFxSettlementReview(owner,intent,catalog);else{const i=fxRequestIntent('reverse',intent);if(!('lot_id' in i))throw new Error();completeFxLotReversalReadback(owner,i,catalog,await readFxLotPortions(db,owner,i.lot_id));}}
 const r=await db.rpc('prepare_fx_reviewed_request',{p_kind:kind,p_intent:intent,p_confirmed:true});if(r.error)throw new Error('Review save response unavailable.');
 const result=await readFxReviewedRequest(db,owner,intent.request_id);if(result.kind!==kind||!fxHistoryEqual(result.intent,intent))throw new Error('Saved request intent differs.');return result;
}
export async function commitFxReviewedRequest(db:Client,owner:string,request:string){
 const saved=await readFxReviewedRequest(db,owner,request);
 if(saved.state==='cancelled')throw new Error('Cancelled financial review.');
 if(saved.state!=='completed'){
  const catalog=await readFxSettlementCatalog(db,owner);
  if(saved.review.kind==='allocate'){
   authoritativeFxSettlementReview(owner,saved.review.intent,catalog);
   const proof=await verifyOwnedSettlementSources(db,owner,saved.review.intent);if(proof.outcome!=='verified')throw new Error('Exact retained source check unavailable.');
  }else completeFxLotReversalReadback(owner,saved.review.intent,catalog,await readFxLotPortions(db,owner,saved.review.intent.lot_id));
 }
 const r=await db.rpc('commit_fx_reviewed_request',{p_request:saved.request_id,p_confirmed:true});if(r.error)throw new Error('Financial save response unavailable; check this exact request.');
 return parseFxReviewedResult(r.data,saved.review);
}

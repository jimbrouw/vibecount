'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { fxEvidenceId } from '@/lib/fx/document-facts';
import { fxRequestIntent, type FxRequestKind } from '@/lib/fx/reviewed-request';
import { prepareFxReviewedRequest, commitFxReviewedRequest } from '@/lib/fx/reviewed-request-store';
function exact(form:FormData,names:string[],limit:number){const keys=[...form.keys()];if(keys.length>32||keys.filter(k=>!k.startsWith('$ACTION_')).sort().join(',')!==[...names].sort().join(',')||[...form.values()].some(v=>typeof v!=='string'||v.length>limit)||form.get('humanConfirmed')!=='yes')throw new Error('Review and confirm the exact saved request.');}
async function prepare(kind:FxRequestKind,form:FormData){
 const db=await createClient(),{data:{user},error}=await db.auth.getUser();if(error||!user)redirect('/login');let intent;
 try{exact(form,['intent','humanConfirmed'],128000);intent=fxRequestIntent(kind,JSON.parse(String(form.get('intent'))));}catch{redirect('/dashboard/reconciliation/fx?error=review');}
 const target='/dashboard/reconciliation/fx/requests?request='+intent.request_id;
 try{await prepareFxReviewedRequest(db,user.id,kind,intent);}catch{redirect(target+'&notice=prepare-check');}
 revalidatePath('/dashboard/reconciliation/fx','layout');redirect(target);
}
export async function prepareFxAllocation(form:FormData){return prepare('allocate',form)}
export async function prepareFxReversal(form:FormData){return prepare('reverse',form)}
export async function executeFxRequest(form:FormData){
 const db=await createClient(),{data:{user},error}=await db.auth.getUser();if(error||!user)redirect('/login');let request;
 try{exact(form,['requestId','humanConfirmed'],100);request=fxEvidenceId(form.get('requestId'));}catch{redirect('/dashboard/reconciliation/fx/requests?notice=review');}
 const target='/dashboard/reconciliation/fx/requests?request='+request;
 try{await commitFxReviewedRequest(db,user.id,request);}catch{redirect(target+'&notice=financial-check');}
 revalidatePath('/dashboard','layout');redirect(target);
}
export async function cancelFxRequest(form:FormData){
 const db=await createClient(),{data:{user},error}=await db.auth.getUser();if(error||!user)redirect('/login');let request;
 try{exact(form,['requestId','humanConfirmed'],100);request=fxEvidenceId(form.get('requestId'));}catch{redirect('/dashboard/reconciliation/fx/requests?notice=review');}
 const target='/dashboard/reconciliation/fx/requests?request='+request;
 const r=await db.rpc('cancel_fx_reviewed_request',{p_request:request,p_confirmed:true});if(r.error)redirect(target+'&notice=cancel-check');
 revalidatePath('/dashboard/reconciliation/fx','layout');redirect(target);
}

'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { foreignClassificationIntent } from '@/lib/records/foreign-classification';
import { readForeignClassificationReview,foreignClassificationReadback,foreignClassificationResult } from '@/lib/records/foreign-classification-review';
const target='/dashboard/imports/classification';
export async function confirmForeignClassification(form:FormData){
 const db=await createClient(),{data:{user},error}=await db.auth.getUser();if(error||!user)redirect('/login');
 let intent;
 try{
  const keys=[...form.keys()];
  if(keys.length>32||keys.filter(k=>!k.startsWith('$ACTION_')).sort().join(',')!=='humanConfirmed,intent'||form.get('humanConfirmed')!=='yes'||
   [...form.values()].some(v=>typeof v!=='string'||v.length>16000))throw new Error();
  intent=foreignClassificationIntent(JSON.parse(String(form.get('intent'))));
 }catch{redirect(target+'?error=review');}
 const location=target+'?transaction='+intent.transaction_id;
 const prior=await db.from('foreign_classification_requests').select('request_id').eq('user_id',user.id).eq('request_id',intent.request_id).maybeSingle();
 if(prior.error)redirect(location+'&error=history');
 if(!prior.data)try{foreignClassificationReadback(user.id,intent,await readForeignClassificationReview(db,user.id,intent.transaction_id));}catch{redirect(location+'&error=sources');}
 const result=await db.rpc('confirm_foreign_classification',{p_intent:intent});
 try{if(result.error)throw new Error();foreignClassificationResult(result.data,intent);}catch{redirect(location+'&error=save');}
 for(const path of [target,'/dashboard/imports','/dashboard/imports/valuation','/dashboard/records','/dashboard/tax-prep','/dashboard'])revalidatePath(path);
 redirect(location+'&result=saved');
}

'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { bankValuationIntent, parseBankValuationRevision } from '@/lib/records/bank-valuation';
import { bankValuationReadback, readBankValuationReview } from '@/lib/records/bank-valuation-review';
const target='/dashboard/imports/valuation';
export async function reviewBankValuation(form:FormData){
  const db=await createClient(),{data:{user},error}=await db.auth.getUser();
  if(error||!user)redirect('/login');
  let intent,originalHash;
  try{
    const keys=[...form.keys()];
    if(keys.length>32||keys.filter(k=>!k.startsWith('$ACTION_')).sort().join(',')!=='humanConfirmed,intent,originalSha256'||
      [...form.values()].some(v=>typeof v!=='string'||v.length>16000)||form.get('humanConfirmed')!=='yes')throw new Error();
    intent=bankValuationIntent(JSON.parse(String(form.get('intent'))));originalHash=form.get('originalSha256');
    if(typeof originalHash!=='string'||(originalHash!==''&&! /^[a-f0-9]{64}$/.test(originalHash)))throw new Error();
  }catch{redirect(target+'?error=review');}
  const location=target+'?transaction='+intent.transaction_id;
  const prior=await db.from('bank_valuation_requests').select('request_id').eq('user_id',user.id).eq('request_id',intent.request_id).maybeSingle();
  if(prior.error)redirect(location+'&error=history');
  if(!prior.data){
    try{
      const context=await readBankValuationReview(db,user.id,intent.transaction_id),preview=bankValuationReadback(user.id,intent,context);
      if(intent.state==='reviewed'&&originalHash!==preview.document.document.file_sha256)throw new Error();
    }catch{redirect(location+'&error=sources');}
  }
  const saved=await db.rpc('review_bank_valuation',{p_intent:intent,p_original_sha256:originalHash});
  try{
    if(saved.error)throw new Error();const revision=parseBankValuationRevision(user.id,saved.data);
    if(revision.request_id!==intent.request_id||revision.ordinal!==intent.expected_ordinal+1||revision.state!==intent.state||
      revision.source_snapshot.economic_source.transaction_id!==intent.transaction_id)throw new Error();
  }catch{redirect(location+'&error=save');}
  revalidatePath(target);revalidatePath('/dashboard/imports');
  redirect(location+'&result=saved');
}

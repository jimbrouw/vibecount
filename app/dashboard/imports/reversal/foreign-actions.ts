'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { readForeignImportReversal } from '@/lib/records/foreign-import-reversal';
import { fxEvidenceId } from '@/lib/fx/document-facts';
import { redactBankDetailsForPrompt } from '@/lib/ai/redaction';
export async function reverseForeignImport(form:FormData){
 const db=await createClient(),{data:{user},error}=await db.auth.getUser();if(error||!user)redirect('/login');
 let source,request,stamp,reason;
 try{
  if([...form.keys()].filter(k=>!k.startsWith('$ACTION_')).sort().join(',')!=='humanConfirmed,importId,reason,requestId,stamp'||form.get('humanConfirmed')!=='yes'||[...form.values()].some(v=>typeof v!=='string'||v.length>16000))throw new Error();
  source=fxEvidenceId(form.get('importId'));request=fxEvidenceId(form.get('requestId'));stamp=String(form.get('stamp'));reason=redactBankDetailsForPrompt(String(form.get('reason')).trim());
  if(!/^[a-f0-9]{32}$/.test(stamp)||!reason||reason.length>1000)throw new Error();
 }catch{redirect('/dashboard/imports?error=Review%20and%20confirm%20the%20foreign%20import%20reversal.');}
 const target='/dashboard/imports/reversal?import='+source;
 const prior=await db.from('source_import_reversal_requests').select('request_id').eq('user_id',user.id).eq('request_id',request).maybeSingle();
 if(prior.error)redirect(target+'&error=Reversal%20history%20unavailable.');
 if(!prior.data)try{const r=await readForeignImportReversal(db,user.id,source);if(!r||r.blocked||r.stamp!==stamp)throw new Error();}catch{redirect(target+'&error=Import%20reversal%20review%20changed.%20Reload%20and%20review%20again.');}
 const saved=await db.rpc('reverse_foreign_import_reviewed',{p_import:source,p_stamp:stamp,p_reason:reason,p_request:request});
 if(saved.error||saved.data?.schema_version!=='foreign-import-reversal-result/1'||saved.data?.import_id!==source||saved.data?.reviewed_stamp!==stamp)redirect(target+'&error=Reversal%20unavailable.%20Reload%20the%20complete%20review.');
 for(const path of ['/dashboard','/dashboard/imports','/dashboard/imports/reversal','/dashboard/imports/classification','/dashboard/imports/valuation','/dashboard/records','/dashboard/review','/dashboard/reconciliation','/dashboard/tax-prep','/dashboard/finance'])revalidatePath(path);
 redirect('/dashboard/imports?import='+source+'&result=reversed');
}

'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { fxDocumentFactReadback, validateFxDocumentFactIntent, validateFxEvidenceResult } from '@/lib/fx/document-facts';
import { readFxEvidenceCatalog } from '@/lib/fx/document-facts-store';
const target='/dashboard/reconciliation/fx/evidence';
export async function reviewFxEvidence(form: FormData) {
    const db=await createClient(),{data:{user},error}=await db.auth.getUser();
    if(error || !user)redirect('/login');
    let intent,originalHash;
    try{
        // Next/React may attach reserved action metadata. It never supplies application intent.
        const keys=[...form.keys()];
        if(keys.length>32 || keys.filter(k=>!k.startsWith('$ACTION_')).sort().join(',')!=='humanConfirmed,intent,originalSha256' || [...form.values()].some(v=>typeof v!=='string'||v.length>16000) || form.get('humanConfirmed')!=='yes')throw new Error();
        const text=form.get('intent');originalHash=form.get('originalSha256');
        if(typeof text!=='string' || text.length>16000 || typeof originalHash!=='string' || (originalHash!=='' && !/^[a-f0-9]{64}$/.test(originalHash)))throw new Error();
        intent=validateFxDocumentFactIntent(JSON.parse(text));
    }catch{redirect(target+'?error=review');}
    const prior=await db.from('fx_document_fact_requests').select('request_id').eq('user_id',user.id).eq('request_id',intent.request_id).maybeSingle();
    if(prior.error)redirect(target+'?error=history');
    if(!prior.data){
        try{
            const catalog=await readFxEvidenceCatalog(db,user.id);
            fxDocumentFactReadback(user.id,intent,catalog);
            if(intent.state==='verified' && originalHash!==catalog.documents.find(d=>d.id===intent.document_id)?.source.document.file_sha256)throw new Error();
        }catch{redirect(target+'?error=sources');}
    }
    // Retained requests still require authoritative fingerprint verification, before live checks.
    const saved=await db.rpc('review_fx_document_evidence',{p_intent:intent});
    try{if(saved.error)throw new Error();validateFxEvidenceResult(saved.data,intent);}catch{redirect(target+'?error=save');}
    revalidatePath(target);revalidatePath('/dashboard/imports');
    redirect(target+'?result=saved&family='+intent.family_id);
}

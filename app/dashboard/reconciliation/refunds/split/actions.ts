'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { refundSplitReview, validateRefundSplitIntent } from '@/lib/records/refund-splits';
import { readCurrentRefundSplit } from '@/lib/records/native-connected-store';
import { requireSourceConfirmation } from '@/lib/records/native-source-context';

export async function approveRefundSplit(form: FormData) {
    const db = await createClient(), { data: { user }, error } = await db.auth.getUser();
    if (error || !user) redirect('/login');
    let intent;
    try {
        const text = form.get('intent');
        if (form.getAll('intent').length !== 1 || typeof text !== 'string' || text.length > 64000 || form.getAll('humanConfirmed').length !== 1 || form.get('humanConfirmed') !== 'yes') throw new Error('Review required.');
        intent = validateRefundSplitIntent(JSON.parse(text));
    } catch { redirect('/dashboard/reconciliation/refunds?error=Review%20the%20exact%20refund%20portions%20and%20confirm%20the%20complete%20effects.'); }
    const target = '/dashboard/reconciliation/refunds/split?refund=' + intent.refund_id;
    const prior = await db.from('refund_requests').select('request_id').eq('user_id', user.id).eq('request_id', intent.request_id).maybeSingle();
    if (prior.error) redirect(target + '&error=Refund%20history%20unavailable.%20Reload%20before%20reviewing.');
    // Request presence permits only a database-verified retry, never a blind
    // return of a stored result or rebuilding old intent from current sources.
    if (!prior.data) {
        try { const current=await readCurrentRefundSplit(db,user.id,intent.refund_id);requireSourceConfirmation(form,current.source_context);if(current.blocked||!current.native_catalog)throw new Error('Current sources unavailable');refundSplitReview(user.id,intent,current.native_catalog); }
        catch { redirect(target + '&error=Refund%20sources%20or%20portions%20changed.%20Reload%20and%20review%20every%20effect.'); }
    }
    const saved = await db.rpc('approve_refund_split', { p_intent: intent });
    if (saved.error) redirect(target + '&error=Refund%20approval%20unavailable.%20Reload%20the%20current%20sources%20and%20remaining%20amounts.');
    for (const path of ['/dashboard', '/dashboard/reconciliation', '/dashboard/reconciliation/refunds', '/dashboard/reconciliation/refunds/split',
        '/dashboard/imports', '/dashboard/records', '/dashboard/tax-prep', '/dashboard/projects', '/dashboard/review']) revalidatePath(path);
    redirect('/dashboard/reconciliation/refunds?result=approved');
}

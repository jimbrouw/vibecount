'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { readCurrentImportReversal } from '@/lib/records/native-connected-store';
import { requireSourceConfirmation } from '@/lib/records/native-source-context';
import { redactBankDetailsForPrompt } from '@/lib/ai/redaction';
export async function reverseReviewedImport(form: FormData) {
    const db = await createClient(), { data: { user }, error } = await db.auth.getUser();
    if (error || !user) redirect('/login');
    const source = String(form.get('importId') ?? '').toLowerCase(), stamp = String(form.get('stamp') ?? ''), request = String(form.get('requestId') ?? '').toLowerCase();
    const reason = redactBankDetailsForPrompt(String(form.get('reason') ?? '').trim()), uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
    if (!['importId', 'stamp', 'requestId', 'reason', 'humanConfirmed'].every(k => form.getAll(k).length === 1) || !uuid.test(source) || !uuid.test(request) || !/^[a-f0-9]{32}$/.test(stamp) || reason.length < 1 || reason.length > 1000 || form.get('humanConfirmed') !== 'yes') redirect('/dashboard/imports?error=Review%20the%20complete%20import%20reversal%20and%20confirm.');
    const target = '/dashboard/imports/reversal?import=' + source;
    const prior = await db.from('source_import_reversal_requests').select('request_id').eq('user_id', user.id).eq('request_id', request).maybeSingle();
    if (prior.error) redirect(target + '&error=Import%20reversal%20history%20unavailable.%20Reload%20before%20reviewing.');
    if (!prior.data) {
        try { const review = await readCurrentImportReversal(db, user.id, source); requireSourceConfirmation(form,review.source_context);if (review.blocked || !review.native_review || review.native_review.blocked || review.financial_stamp !== stamp) throw new Error('Review changed.'); }
        catch { redirect(target + '&error=Import%20sources%20or%20dependencies%20changed.%20Review%20the%20complete%20current%20scope.'); }
    }
    // Even retained requests go through the database's exact payload check.
    const saved = await db.rpc('reverse_source_import_reviewed', { p_id: source, p_stamp: stamp, p_reason: reason, p_request: request });
    if (saved.error) redirect(target + '&error=Reversal%20unavailable.%20Resolve%20linked%20assignments%20and%20duplicate%20references%20and%20reload.');
    for (const path of ['/dashboard', '/dashboard/imports', '/dashboard/imports/reversal', '/dashboard/records', '/dashboard/reconciliation', '/dashboard/reconciliation/refunds', '/dashboard/reconciliation/transfers', '/dashboard/reconciliation/refund-assignments', '/dashboard/review', '/dashboard/tax-prep', '/dashboard/projects']) revalidatePath(path);
    redirect('/dashboard/imports?import=' + source + '&result=reversed');
}

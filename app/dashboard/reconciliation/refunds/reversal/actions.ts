"use server";
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { redactBankDetailsForPrompt } from '@/lib/ai/redaction';

import { readCurrentRefundClosure } from '@/lib/records/native-connected-store';
import { requireSourceConfirmation } from '@/lib/records/native-source-context';
import type { RefundClosureScope } from '@/lib/records/refund-closure';

export async function reverseRefundClosure(form: FormData) {
    const db = await createClient(), { data: { user }, error } = await db.auth.getUser();
    if (error || !user) redirect('/login');
    const kind = String(form.get('kind') ?? ''), id = String(form.get('source') ?? ''), request = String(form.get('requestId') ?? ''), stamp = String(form.get('stamp') ?? '');
    const reason = redactBankDetailsForPrompt(String(form.get('reason') ?? '').trim()), uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    const target = '/dashboard/reconciliation/refunds/reversal?' + new URLSearchParams({ kind, id });
    if (!['original', 'refund', 'import'].includes(kind) || !uuid.test(id) || !uuid.test(request) || !/^[a-f0-9]{32}$/.test(stamp) ||
        reason.length < 1 || reason.length > 1000 || form.get('humanConfirmed') !== 'yes') redirect(target + '&error=Review%20every%20affected%20refund%20and%20confirm%20the%20complete%20reversal.');
    const prior = await db.from('refund_requests').select('request_id').eq('user_id', user.id).eq('request_id', request).maybeSingle();
    if (prior.error) redirect(target + '&error=Could%20not%20verify%20the%20retained%20refund%20request.');
    if (!prior.data) {
        try {
            const review = await readCurrentRefundClosure(db, user.id, { kind: kind as RefundClosureScope['kind'], id });
            requireSourceConfirmation(form,review.source_context);
            if (review.blocked || !review.native_review || review.native_review.blocked || review.dependencies.financial_stamp !== stamp) throw new Error('Dependency review changed');
        } catch { redirect(target + '&error=Refund%20sources%20changed%20or%20are%20linked%20to%20active%20FX.%20Reload%20the%20complete%20review.'); }
    }
    const r = await db.rpc('reverse_refund_closure', { p_kind: kind, p_id: id, p_stamp: stamp, p_reason: reason, p_request: request });
    if (r.error) redirect(target + '&error=Reversal%20unavailable.%20Reverse%20linked%20invoice%20refund%20assignments%20first%20and%20reload%20the%20current%20sources.');
    for (const path of ['/dashboard', '/dashboard/reconciliation', '/dashboard/reconciliation/refunds', '/dashboard/reconciliation/refunds/reversal',
        '/dashboard/imports', '/dashboard/records', '/dashboard/tax-prep', '/dashboard/projects', '/dashboard/review']) revalidatePath(path);
    redirect('/dashboard/reconciliation/refunds?result=reversed');
}

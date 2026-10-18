'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redactBankDetailsForPrompt } from '@/lib/ai/redaction';
import { londonPlanningDate } from '@/lib/finance/defaults';
import { deadlineYear } from '@/lib/finance/deadlines/model';
import { readDeadlineReview, readDeadlineHistoricalSources, saveReviewedDeadlines, type DeadlineRevision } from '@/lib/finance/deadlines/server';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export async function reviewTaxDeadlines(form: FormData) {
    const db = await createClient(), { data: { user }, error } = await db.auth.getUser();
    if (error || !user) redirect('/login');
    let year: number;
    try { year = deadlineYear(Number(form.get('year'))); } catch { redirect('/dashboard/finance/deadlines?error=Choose+a+supported+year'); }
    const fail = (): never => redirect(`/dashboard/finance/deadlines?year=${year}&error=Review+could+not+be+verified.+Reload+and+review+the+current+sources.+An+exact+completed+retry+remains+recoverable.`);
    const request = String(form.get('requestId') ?? ''), expected = Number(form.get('expected')), stamp = String(form.get('stamp') ?? ''), rulesHash = String(form.get('rulesHash') ?? '');
    const reason = redactBankDetailsForPrompt(String(form.get('reason') ?? '').trim()), raw = String(form.get('plan') ?? ''), resultJson = String(form.get('preview') ?? '');
    if (form.get('humanConfirmed') !== 'yes' || !uuid.test(request) || !Number.isSafeInteger(expected) || expected < 0 || !/^[a-f0-9]{32}$/.test(stamp) || !/^[a-f0-9]{64}$/.test(rulesHash) || !reason || reason.length > 1000 || raw.length > 1000000 || resultJson.length > 1000000) fail();
    let id: string;
    try {
        const plan = JSON.parse(raw);
        id = await saveReviewedDeadlines(user.id, { year, request, expected, stamp, reason, rulesHash, plan, resultJson }, londonPlanningDate(), {
            async recover() { const r = await db.from('tax_deadline_revisions').select('*').eq('user_id', user.id).eq('request_id', request).maybeSingle(); if (r.error) throw new Error('Recovery unavailable.'); return r.data as DeadlineRevision | null; },
            historical(row) { return readDeadlineHistoricalSources(db, user.id, row); },
            read() { return readDeadlineReview(db, user.id, year); },
            async capture(p) { const admin = createAdminClient(); if (!admin) throw new Error('Secure capture unavailable.');
                const r = await admin.rpc('capture_tax_deadline_review', { p_owner: user.id, p_year: year, p_expected: expected, p_stamp: stamp, p_input: p.inputJson, p_result: p.resultJson, p_rules: p.rulesJson, p_reason: reason, p_request: request });
                if (r.error || !uuid.test(String(r.data))) throw new Error('Capture failed.'); return r.data as string; },
        });
    } catch { return fail(); }
    revalidatePath('/dashboard/finance/deadlines');
    redirect(`/dashboard/finance/deadlines?year=${year}&saved=${id}`);
}

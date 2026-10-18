'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redactBankDetailsForPrompt } from '@/lib/ai/redaction';
import { validatePlan } from '@/lib/finance/plan';
import { londonPlanningDate } from '@/lib/finance/defaults';
import { readFinanceReview, saveReviewedFinancePlan, type PlanRevision } from '@/lib/finance/server';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export async function reviewFinancePlan(form: FormData) {
    const db = await createClient(), { data: { user }, error } = await db.auth.getUser();
    if (error || !user) redirect('/login');
    const fail = (message: string): never => redirect('/dashboard/finance?error=' + encodeURIComponent(message));
    const request = String(form.get('requestId') ?? ''), expected = Number(form.get('expected')), stamp = String(form.get('stamp') ?? '');
    const reason = redactBankDetailsForPrompt(String(form.get('reason') ?? '').trim()), rulesHash = String(form.get('rulesHash') ?? '');
    const raw = String(form.get('plan') ?? ''), resultJson = String(form.get('preview') ?? '');
    if (form.get('humanConfirmed') !== 'yes' || !uuid.test(request) || !Number.isSafeInteger(expected) || expected < 0 || !/^[a-f0-9]{32}$/.test(stamp) || !/^[a-f0-9]{64}$/.test(rulesHash) || !reason || reason.length > 1000 || raw.length > 1000000 || resultJson.length > 1000000)
        fail('Review the exact cash plan, assumptions, unresolved inputs and reason before confirming.');
    let saved: string;
    try {
        const plan = validatePlan(JSON.parse(raw));
        saved = await saveReviewedFinancePlan(user.id, { request, expected, stamp, reason, rulesHash, plan, resultJson }, londonPlanningDate(), {
            async recover() {
                const r = await db.from('finance_plan_revisions').select('*').eq('user_id', user.id).eq('request_id', request).maybeSingle();
                if (r.error) throw new Error('Cannot recover finance request.');
                return r.data as PlanRevision | null;
            },
            async read() { return readFinanceReview(db, user.id); },
            async capture(p) {
                const admin = createAdminClient();
                if (!admin) throw new Error('Secure capture unavailable.');
                const r = await admin.rpc('capture_finance_plan', { p_owner: user.id, p_expected: expected, p_stamp: stamp, p_input: p.inputJson, p_result: p.resultJson, p_rules: p.rulesJson, p_reason: reason, p_request: request });
                if (r.error || !uuid.test(String(r.data))) throw new Error('Finance inputs changed or are busy.');
                return r.data as string;
            },
        });
    } catch { return fail('The draft could not be verified or inputs changed. Reload and review again. An exact completed retry remains recoverable.'); }
    revalidatePath('/dashboard/finance');
    redirect('/dashboard/finance?saved=' + saved);
}

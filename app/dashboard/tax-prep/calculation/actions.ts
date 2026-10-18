'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redactBankDetailsForPrompt } from '@/lib/ai/redaction';
import { validateScope } from '@/lib/tax/scope';
import { saveReviewedCalculation } from '@/lib/tax/capture-review';
import type { SavedCalculation } from '@/lib/tax/snapshot';
import type { CalculationInput } from '@/lib/tax/calculation';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export async function reviewCalculation(form: FormData) {
    const db = await createClient(), { data: { user }, error } = await db.auth.getUser();
    if (error || !user)
        redirect('/login');
    const year = Number(form.get('year')), request = String(form.get('requestId') ?? ''), reason = redactBankDetailsForPrompt(String(form.get('reason') ?? '').trim());
    const fail = (message: string): never => redirect(`/dashboard/tax-prep/calculation?year=${Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : ''}&error=${encodeURIComponent(message)}`);
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !uuid.test(request) || form.get('humanConfirmed') !== 'yes' || !reason || reason.length > 1000)
        fail('Review the year, figures, unresolved inputs and reason before confirming.');
    if (form.get('action') === 'scope') {
        const expected = Number(form.get('expected')), stamp = String(form.get('stamp') ?? ''), state = String(form.get('state') ?? ''), document = String(form.get('document') ?? '');
        let data;
        try {
            data = validateScope(JSON.parse(String(form.get('scope') ?? '')), state);
        }
        catch {
            return fail('Review every calculation-scope answer and the exact Class 2 amount.');
        }
        if (!Number.isSafeInteger(expected) || expected < 0 || !/^[a-f0-9]{32}$/.test(stamp) || (document && !uuid.test(document)))
            fail('Reload the current calculation scope.');
        const result = await db.rpc('review_tax_calculation_scope', { p_year: year, p_expected: expected, p_data: data, p_state: state, p_document: document || null, p_stamp: stamp, p_reason: reason, p_request: request });
        if (result.error)
            fail('Scope or source inputs changed, or owned evidence is missing. Reload before reviewing again.');
        revalidatePath('/dashboard/tax-prep/calculation');
        redirect(`/dashboard/tax-prep/calculation?year=${year}&result=scope-saved`);
    }
    if (form.get('action') !== 'capture')
        fail('Choose a supported review action.');
    const inputHash = String(form.get('inputHash') ?? ''), resultHash = String(form.get('resultHash') ?? ''), rulesHash = String(form.get('rulesHash') ?? '');
    if ([inputHash, resultHash, rulesHash].some(h => !/^[a-f0-9]{64}$/.test(h)))
        fail('Reload the complete calculation before saving.');
    let id: string;
    try {
        id = await saveReviewedCalculation({ year, request, reason, inputHash, resultHash, rulesHash }, {
            async recover() {
                const r = await db.from('tax_calculations').select('*').eq('user_id', user.id).eq('request_id', request).maybeSingle();
                if (r.error)
                    throw new Error('Cannot recover prior save.');
                if (!r.data)
                    return null;
                const rules = await db.from('tax_rulesets').select('id,canonical_json,sha256').eq('id', r.data.ruleset_id).single();
                if (rules.error || !rules.data)
                    throw new Error('Cannot verify saved rules.');
                return { row: r.data as SavedCalculation, rules: rules.data };
            },
            async read() {
                const r = await db.rpc('read_tax_calculation_input', { p_year: year });
                if (r.error || !r.data || r.data.owner_id !== user.id || r.data.schema_version!=='tax-calculation-input/4')
                    throw new Error('Cannot read complete calculation inputs.');
                return r.data as CalculationInput;
            },
            async capture(prepared) {
                const admin = createAdminClient();
                if (!admin)
                    throw new Error('Secure snapshot capture is unavailable.');
                const r = await admin.rpc('capture_tax_calculation', { p_owner: user.id, p_year: year, p_input: prepared.inputJson, p_result: prepared.resultJson, p_rules: prepared.rulesJson, p_reason: reason, p_request: request });
                if (r.error || !uuid.test(String(r.data)))
                    throw new Error('Inputs changed or are busy. Reload and review before retrying.');
                return r.data as string;
            },
        });
    }
    catch {
        return fail('The draft could not be saved or its inputs changed. Reload before reviewing again; an exact completed retry remains recoverable.');
    }
    revalidatePath('/dashboard/tax-prep/calculation');
    redirect(`/dashboard/tax-prep/calculation?year=${year}&saved=${id}`);
}

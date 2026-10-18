'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redactBankDetailsForPrompt } from '@/lib/ai/redaction';
import { canonicalJson, sha256 } from '@/lib/tax/snapshot';
import { loadFilingContext } from '@/lib/tax/filing-server';
import { filingSteps, validateStepData, buildFilingPack, verifyFilingPack, type FilingStep, type SavedFilingPack } from '@/lib/tax/filing-pack';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const hash = /^[a-f0-9]{64}$/;
export async function reviewFilingPack(form: FormData) {
    const db = await createClient(), { data: { user }, error } = await db.auth.getUser();
    if (error || !user)
        redirect('/login');
    const calculation = String(form.get('calculation') ?? ''), year = Number(form.get('year')), request = String(form.get('requestId') ?? ''), inputHash = String(form.get('inputHash') ?? ''), reason = redactBankDetailsForPrompt(String(form.get('reason') ?? '').trim()), action = String(form.get('action') ?? ''), step = String(form.get('step') ?? '') as FilingStep;
    const fail = (message: string): never => redirect(`/dashboard/tax-prep/filing-pack?year=${Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : ''}${uuid.test(calculation) ? '&calculation=' + calculation : ''}${filingSteps.includes(step) ? '&step=' + step : ''}&error=${encodeURIComponent(message)}`);
    if (!uuid.test(calculation) || !uuid.test(request) || !Number.isInteger(year) || year < 2000 || year > 2100 || !hash.test(inputHash) || !reason || reason.length > 1000 || form.get('humanConfirmed') !== 'yes' || !['step', 'capture'].includes(action))
        fail('Review the exact year, sources, figures and reason before confirming.');
    let destination = '';
    try {
        if (action === 'step') {
            const digest = String(form.get('digest') ?? '');
            if (!filingSteps.includes(step) || !hash.test(digest))
                throw new Error();
            const data = JSON.parse(String(form.get('answers') ?? ''));
            const prior = await db.from('filing_pack_step_reviews').select('id,calculation_id,input_sha256,tax_year_start,step,digest,data,reason').eq('user_id', user.id).eq('request_id', request).maybeSingle();
            if (prior.error)
                throw new Error();
            if (prior.data) {
                if (prior.data.calculation_id !== calculation || prior.data.tax_year_start !== year || prior.data.input_sha256 !== inputHash || prior.data.step !== step || prior.data.digest !== digest || canonicalJson(prior.data.data) !== canonicalJson(data) || prior.data.reason !== reason)
                    throw new Error();
            }
            else {
                const context = await loadFilingContext(db, user.id, calculation), current = context.model.steps.find(s => s.id === step)!;
                if (context.input.tax_year_start !== year || context.model.inputHash !== inputHash || current.digest !== digest || !context.input.calculation_is_current)
                    throw new Error();
                validateStepData(context.input, step, data);
                const admin = createAdminClient();
                if (!admin)
                    throw new Error();
                const result = await admin.rpc('review_filing_pack_step', { p_owner: user.id, p_calculation: calculation, p_input: canonicalJson(context.input), p_step: step, p_digest: digest, p_data: data, p_reason: reason, p_request: request });
                if (result.error || !uuid.test(String(result.data)))
                    throw new Error();
            }
            const next = filingSteps[filingSteps.indexOf(step) + 1] ?? 'export';
            destination = `?year=${year}&calculation=${calculation}&step=${next}&result=review-saved`;
        }
        else {
            const bundleHash = String(form.get('bundleHash') ?? ''), attest = form.get('completenessAttested') === 'yes';
            if (!hash.test(bundleHash))
                throw new Error();
            const prior = await db.from('filing_packs').select('*').eq('user_id', user.id).eq('request_id', request).maybeSingle();
            if (prior.error)
                throw new Error();
            let saved: string;
            if (prior.data) {
                verifyFilingPack(prior.data as SavedFilingPack);
                if (prior.data.calculation_id !== calculation || prior.data.tax_year_start !== year || prior.data.input_sha256 !== inputHash || prior.data.bundle_sha256 !== bundleHash || prior.data.reason !== reason || prior.data.completeness_attested !== attest)
                    throw new Error();
                saved = prior.data.id;
            }
            else {
                const context = await loadFilingContext(db, user.id, calculation);
                if (context.input.tax_year_start !== year || context.model.inputHash !== inputHash)
                    throw new Error();
                const bundle = buildFilingPack(context.input, context.history, request, attest), serialized = canonicalJson(bundle);
                if (sha256(serialized) !== bundleHash)
                    throw new Error();
                if (bundle.artifacts.some(a => a.size_bytes > 4000000))
                    throw new Error('Artifact delivery limit');
                const admin = createAdminClient();
                if (!admin)
                    throw new Error();
                const result = await admin.rpc('capture_filing_pack', { p_owner: user.id, p_calculation: calculation, p_input: canonicalJson(context.input), p_bundle: serialized, p_reason: reason, p_request: request });
                if (result.error || !uuid.test(String(result.data)))
                    throw new Error();
                saved = String(result.data);
            }
            destination = `?year=${year}&saved=${saved}`;
        }
    }
    catch {
        return fail('Sources, calculation or review answers changed, required details are invalid, or capture is unavailable. Reload before confirming again. Exact completed retries remain recoverable.');
    }
    revalidatePath('/dashboard/tax-prep/filing-pack');
    redirect('/dashboard/tax-prep/filing-pack' + destination);
}

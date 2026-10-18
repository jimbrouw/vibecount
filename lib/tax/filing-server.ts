import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readAllExportRows } from '../records/export-pages';
import { canonicalJson, sha256 } from './snapshot';
import { buildFilingReview, type FilingPackInput, type StepReview } from './filing-pack';
export async function loadFilingContext(db: SupabaseClient, owner: string, calculation: string) {
    const read = async () => { const r = await db.rpc('read_tax_filing_pack_input', { p_calculation: calculation }); if (r.error || !r.data || r.data.owner_id !== owner || r.data.schema_version!=='filing-pack-input/6')
        throw new Error('Complete filing inputs unavailable.'); return r.data as FilingPackInput; };
    const input = await read(), stamp = await db.rpc('filing_pack_review_stamp', { p_year: input.tax_year_start });
    if (stamp.error || typeof stamp.data !== 'string')
        throw new Error('Review history unavailable.');
    const history = await readAllExportRows<StepReview & {
        ordinal: number;
    }>(async (after) => { let q = db.from('filing_pack_step_reviews').select('id,step,digest,data,reason,author,created_at,ordinal').eq('user_id', owner).eq('tax_year_start', input.tax_year_start).order('id').limit(500); if (after)
        q = q.gt('id', after); return await q; });
    const after = await db.rpc('filing_pack_review_stamp', { p_year: input.tax_year_start });
    if (after.error || after.data !== stamp.data || sha256(canonicalJson(await read())) !== sha256(canonicalJson(input)))
        throw new Error('Pack sources or review changed while loading.');
    history.sort((a, b) => b.ordinal - a.ordinal || b.id.localeCompare(a.id));
    return { input, history, model: buildFilingReview(input, history) };
}

import { canonicalJson } from '../../tax/snapshot';
import { readAllExportRows } from '../../records/export-pages';
import type { PlanRevision } from '../server';
import { deadlineYear, validateDeadlinePlan, type DeadlineCatalog, type DeadlinePlan, type NoticeDocument } from './model';
import { deadlineCatalogFromPlan, prepareDeadlineSnapshot, verifyDeadlineSnapshot, type SavedDeadlineSnapshot } from './snapshot';
type Client = Awaited<ReturnType<typeof import('../../supabase/server').createClient>>;
export type DeadlineContext = { owner_id: string; tax_year_start: number; ordinal: number; source_plan_id: string | null; stamp: string };
export type DeadlineRevision = SavedDeadlineSnapshot & { id: string; user_id: string; tax_year_start: number; ordinal: number; expected_ordinal: number; context_stamp: string; source_plan_id: string | null; request_id: string; rationale: string; author: string; created_at: string };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function assertDeadlineProvenance(row: DeadlineRevision, owner: string) {
    if (row.user_id !== owner || row.author !== owner || row.tax_year_start !== row.input.plan.tax_year_start ||
        !Number.isSafeInteger(row.ordinal) || row.ordinal < 1 || row.expected_ordinal !== row.ordinal - 1 ||
        row.source_plan_id !== (row.input.sources.finance_plan?.id ?? null) || !uuid.test(row.id)) throw new Error('Saved deadline provenance failed.');
}
async function finance(db: Client, owner: string, id?: string) {
    let q = db.from('finance_plan_revisions').select('*').eq('user_id', owner);
    if (id) q = q.eq('id', id); else q = q.order('ordinal', { ascending: false }).limit(1);
    const r = await q.maybeSingle();
    if (r.error || (id && !r.data)) throw new Error('Referenced cash plan unavailable.');
    return r.data as PlanRevision | null;
}
export async function readDeadlineHistoricalSources(db: Client, owner: string, row: DeadlineRevision): Promise<DeadlineCatalog> {
    assertDeadlineProvenance(row, owner);
    const source = row.source_plan_id ? await finance(db, owner, row.source_plan_id) : null;
    const selected = [...new Set(row.input.plan.entries.flatMap(e => e.notice_document_id ? [e.notice_document_id] : []))];
    const docs = selected.length ? await readAllExportRows<NoticeDocument>(async after => {
        let q = db.from('evidence_documents').select('id,user_id,file_sha256:file_hash').eq('user_id', owner).in('id', selected).order('id').limit(500);
        if (after) q = q.gt('id', after); return await q;
    }) : [];
    return deadlineCatalogFromPlan(owner, row.tax_year_start, source, docs);
}
export async function readDeadlineReview(db: Client, owner: string, year: number) {
    deadlineYear(year);
    async function context(): Promise<DeadlineContext> {
        const r = await db.rpc('read_tax_deadline_context', { p_year: year }), c = r.data;
        if (r.error || !c || c.owner_id !== owner || c.tax_year_start !== year || !Number.isSafeInteger(c.ordinal) || c.ordinal < 0 ||
            !/^[a-f0-9]{32}$/.test(c.stamp) || (c.source_plan_id !== null && !uuid.test(c.source_plan_id))) throw new Error('Deadline context unavailable.');
        return c;
    }
    const before = await context();
    const [source, documents] = await Promise.all([
        finance(db, owner),
        readAllExportRows<NoticeDocument>(async after => {
            let q = db.from('current_evidence_documents').select('id,user_id,file_sha256:file_hash').eq('user_id', owner).order('id').limit(500);
            if (after) q = q.gt('id', after); return await q;
        }),
    ]);
    const catalog = deadlineCatalogFromPlan(owner, year, source, documents), after = await context();
    if ((source?.id ?? null) !== before.source_plan_id || before.stamp !== after.stamp || before.ordinal !== after.ordinal) throw new Error('Deadline sources changed while reading.');
    return { context: before, catalog };
}
export type DeadlineSaveReview = { year: number; expected: number; stamp: string; request: string; reason: string; plan: DeadlinePlan; resultJson: string; rulesHash: string };
export async function saveReviewedDeadlines(owner: string, review: DeadlineSaveReview, today: string, io: {
    recover(): Promise<DeadlineRevision | null>; historical(row: DeadlineRevision): Promise<DeadlineCatalog>;
    read(): Promise<{ context: DeadlineContext; catalog: DeadlineCatalog }>;
    capture(prepared: ReturnType<typeof prepareDeadlineSnapshot>): Promise<string>;
}) {
    const old = await io.recover();
    if (old) {
        assertDeadlineProvenance(old, owner);
        const catalog = await io.historical(old); verifyDeadlineSnapshot(old, owner, catalog);
        if (old.tax_year_start !== review.year || old.request_id !== review.request || old.expected_ordinal !== review.expected || old.context_stamp !== review.stamp || old.rationale !== review.reason ||
            old.rules_sha256 !== review.rulesHash || old.result_canonical_json !== canonicalJson(JSON.parse(review.resultJson)) ||
            canonicalJson(old.input.plan) !== canonicalJson(validateDeadlinePlan(review.plan, catalog))) throw new Error('Deadline request used with different inputs.');
        return old.id;
    }
    const { context, catalog } = await io.read();
    if (context.owner_id !== owner || context.tax_year_start !== review.year || context.ordinal !== review.expected || context.stamp !== review.stamp || review.plan.tax_year_start !== review.year) throw new Error('Deadline review changed.');
    const p = prepareDeadlineSnapshot(owner, review.plan, today, catalog);
    if (p.rulesHash !== review.rulesHash || p.resultJson !== canonicalJson(JSON.parse(review.resultJson))) throw new Error('Deadline read-back changed.');
    return io.capture(p);
}

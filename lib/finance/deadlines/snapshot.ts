import { canonicalJson, sha256 } from '../../tax/snapshot';
import { verifyPlanRevision, type PlanRevision } from '../server';
import { deadlineRules, DEADLINE_CAVEAT } from './rules';
import { evaluateDeadlines, validateDeadlineCatalog, validateDeadlinePlan, deadlineYear, type DeadlineCatalog, type DeadlinePlan, type DeadlineResult, type NoticeDocument } from './model';

export type DeadlineInput = {
    schema_version: 'tax-deadline-input/1'; owner_id: string; evaluated_on: string;
    plan: DeadlinePlan; sources: DeadlineCatalog;
};
export type SavedDeadlineSnapshot = {
    input: DeadlineInput; result: DeadlineResult;
    input_canonical_json: string; result_canonical_json: string; rules_canonical_json: string;
    input_sha256: string; result_sha256: string; rules_sha256: string;
};
/** Read the revision and documents on the authenticated server, never from submitted review JSON. */
export function deadlineCatalogFromPlan(owner: string, year: number, revision: PlanRevision | null, documents: NoticeDocument[]): DeadlineCatalog {
    deadlineYear(year);
    const verified = revision ? verifyPlanRevision(revision, owner) : null;
    return validateDeadlineCatalog(owner, year, {
        owner_id: owner,
        finance_plan: revision && verified ? { id: revision.id, user_id: owner, ordinal: revision.ordinal, as_of: verified.input.plan.as_of, input_sha256: revision.input_sha256, result_sha256: revision.result_sha256 } : null,
        obligations: verified ? verified.input.plan.obligations.filter(o => o.kind === 'tax' && o.tax_year_start === year).map(o => ({ id: o.id, label: o.label, tax_year_start: year, due_date: o.due_date, amount_pence: o.amount_pence })) : [],
        unassigned_tax_obligations: verified ? verified.input.plan.obligations.filter(o => o.kind === 'tax' && o.tax_year_start === null).length : 0,
        documents: documents.map(d => ({ id: d.id, user_id: d.user_id, file_sha256: d.file_sha256 })),
    });
}
function selectedSources(catalog: DeadlineCatalog, plan: DeadlinePlan): DeadlineCatalog {
    const selected = new Set(plan.entries.flatMap(e => e.notice_document_id ? [e.notice_document_id] : []));
    return { ...catalog, documents: catalog.documents.filter(d => selected.has(d.id)) };
}
/** Freeze just the safe selected-year commitments and selected notice hashes, never raw evidence. */
export function prepareDeadlineSnapshot(owner: string, value: unknown, today: string, catalog: DeadlineCatalog) {
    const rawYear = value && typeof value === 'object' ? (value as { tax_year_start?: unknown }).tax_year_start : undefined;
    const safe = validateDeadlineCatalog(owner, deadlineYear(rawYear), catalog), plan = validateDeadlinePlan(value, safe);
    const sources = selectedSources(safe, plan), result = evaluateDeadlines(plan, sources, today);
    const input: DeadlineInput = { schema_version: 'tax-deadline-input/1', owner_id: owner, evaluated_on: result.evaluated_on, plan, sources };
    const inputJson = canonicalJson(input), resultJson = canonicalJson(result), rulesJson = canonicalJson(deadlineRules);
    return { input, result, rules: deadlineRules, inputJson, resultJson, rulesJson, inputHash: sha256(inputJson), resultHash: sha256(resultJson), rulesHash: sha256(rulesJson) };
}
/**
 * The authoritative catalog must be reconstructed from the retained source finance revision
 * and owned notice metadata. Rehashing edited source amounts cannot establish provenance.
 * This is historical verification; do not substitute the latest plan for the referenced plan.
 */
export function verifyDeadlineSnapshot(row: SavedDeadlineSnapshot, owner: string, historicalCatalog: DeadlineCatalog) {
    if (row.input.schema_version !== 'tax-deadline-input/1' || row.input.owner_id !== owner ||
        canonicalJson(row.input) !== row.input_canonical_json || canonicalJson(row.result) !== row.result_canonical_json ||
        sha256(row.input_canonical_json) !== row.input_sha256 || sha256(row.result_canonical_json) !== row.result_sha256 || sha256(row.rules_canonical_json) !== row.rules_sha256 ||
        row.rules_canonical_json !== canonicalJson(deadlineRules) || row.result.engine_version !== deadlineRules.engine_version || row.result.ruleset_id !== deadlineRules.id)
        throw new Error('Saved deadline integrity or rules version failed.');
    const verified = prepareDeadlineSnapshot(owner, row.input.plan, row.input.evaluated_on, historicalCatalog);
    if (verified.inputJson !== row.input_canonical_json || verified.resultJson !== row.result_canonical_json) throw new Error('Saved deadline sources or replay failed.');
    return { document_status: 'Draft reminder review — not submitted to HMRC', caveat: DEADLINE_CAVEAT,
        input: JSON.parse(row.input_canonical_json) as DeadlineInput, result: JSON.parse(row.result_canonical_json) as DeadlineResult,
        rules: JSON.parse(row.rules_canonical_json), input_sha256: row.input_sha256, result_sha256: row.result_sha256, rules_sha256: row.rules_sha256 };
}
/** Current phases are recalculated without replacing retained historical bytes or clearing acknowledgements. */
export function currentDeadlineReview(row: SavedDeadlineSnapshot, owner: string, historicalCatalog: DeadlineCatalog, currentCatalog: DeadlineCatalog, today: string) {
    const historical = verifyDeadlineSnapshot(row, owner, historicalCatalog);
    const live = validateDeadlineCatalog(owner, row.input.plan.tax_year_start, currentCatalog);
    const expected = selectedSources(live, row.input.plan);
    if (canonicalJson(expected) !== canonicalJson(row.input.sources)) return {
        stale: true as const, active_count: 0, result: null, historical,
        message: 'The cash plan or selected notice evidence changed. Review the current sources before enabling reminders again. Historical acknowledgement is not payment or filing evidence.',
    };
    const result = evaluateDeadlines(row.input.plan, live, today);
    return { stale: false as const, active_count: result.active_count, result, historical, message: DEADLINE_CAVEAT };
}

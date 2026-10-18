import { readAllExportRows } from '../records/export-pages';
import { redactBankDetailsForPrompt } from '../ai/redaction';
import { canonicalJson } from '../tax/snapshot';
import { prepareBankCoveredFinancePlan, verifyFinancePlan, type PlanningCatalog, type SavedFinancePlan } from './snapshot';
import { parseBankSourceCoverage, type BankSourceCoverage } from '../records/bank-source-coverage';
import type { Plan } from './plan';
import { parseInvoiceCurrencyCoverage, type InvoiceCurrencyCoverage } from '../invoices/currency-coverage';

export type PlanContext = { schema_version: 'finance-plan-context/3'; owner_id: string; ordinal: number; stamp: string; invoice_coverage: InvoiceCurrencyCoverage; bank_source_coverage: BankSourceCoverage };
export function parseFinanceContext(value: unknown, owner: string): PlanContext {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Cash plan context unavailable.');
    const r = value as Record<string, unknown>;
    if (Object.keys(r).sort().join(',') !== 'bank_source_coverage,invoice_coverage,ordinal,owner_id,schema_version,stamp' || r.schema_version !== 'finance-plan-context/3' || r.owner_id !== owner || !Number.isSafeInteger(r.ordinal) || (r.ordinal as number) < 0 || typeof r.stamp !== 'string' || !/^[a-f0-9]{32}$/.test(r.stamp)) throw new Error('Versioned cash plan context unavailable.');
    return { schema_version: 'finance-plan-context/3', owner_id: owner, ordinal: r.ordinal as number, stamp: r.stamp, invoice_coverage: parseInvoiceCurrencyCoverage(r.invoice_coverage, owner), bank_source_coverage: parseBankSourceCoverage(r.bank_source_coverage, owner) };
}
export async function readFinanceContext(db: Client, owner: string) {
    const r = await db.rpc('read_finance_plan_context');
    if (r.error) throw new Error('Cash plan context unavailable.');
    return parseFinanceContext(r.data, owner);
}
export type PlanRevision = SavedFinancePlan & { id: string; user_id: string; ordinal: number; expected_ordinal: number; context_stamp: string; request_id: string; rationale: string; author: string; created_at: string };
export type PlanSaveReview = { request: string; reason: string; expected: number; stamp: string; plan: Plan; resultJson: string; rulesHash: string };
type Client = Awaited<ReturnType<typeof import('../supabase/server').createClient>>;
/** Read until empty pages and fail if the owner/catalog/revision changes during review construction. */
export async function readFinanceReview(db: Client, owner: string) {
    const context = () => readFinanceContext(db, owner);
    const before = await context();
    const [accounts, documents] = await Promise.all([
        readAllExportRows(async after => {
            let q = db.from('financial_accounts').select('id,user_id,provider,account_type,currency,label,masked_identifier').eq('user_id', owner).order('id').limit(500);
            if (after) q = q.gt('id', after);
            return await q;
        }),
        readAllExportRows(async after => {
            let q = db.from('current_evidence_documents').select('id,user_id,file_sha256:file_hash,media_type,size_bytes').eq('user_id', owner).in('media_type', ['application/pdf', 'image/png', 'image/jpeg']).order('id').limit(500);
            if (after) q = q.gt('id', after);
            return await q;
        }),
    ]);
    const after = await context();
    if (before.stamp !== after.stamp || before.ordinal !== after.ordinal || canonicalJson(before) !== canonicalJson(after)) throw new Error('Cash plan or sources changed while reading.');
    const catalog: PlanningCatalog = { accounts: accounts.map(a => ({ ...a, label: redactBankDetailsForPrompt(a.label) })), documents };
    if ([...catalog.accounts, ...catalog.documents].some(s => s.user_id !== owner)) throw new Error('Foreign planning source.');
    return { context: before, catalog };
}
export function verifyPlanRevision(row: PlanRevision, owner: string) {
    if (row.user_id !== owner || row.author !== owner || !Number.isSafeInteger(row.ordinal) || row.ordinal < 1 || row.expected_ordinal !== row.ordinal - 1)
        throw new Error('Saved finance review provenance failed.');
    return verifyFinancePlan(row, owner);
}
export async function saveReviewedFinancePlan(owner: string, review: PlanSaveReview, today: string, dependencies: {
    recover(): Promise<PlanRevision | null>;
    read(): Promise<{ context: PlanContext; catalog: PlanningCatalog }>;
    capture(prepared: ReturnType<typeof prepareBankCoveredFinancePlan>): Promise<string>;
}) {
    const old = await dependencies.recover();
    if (old) {
        verifyPlanRevision(old, owner);
        if (old.request_id !== review.request || old.rationale !== review.reason || old.expected_ordinal !== review.expected || old.context_stamp !== review.stamp ||
            old.result_canonical_json !== canonicalJson(JSON.parse(review.resultJson)) || old.rules_sha256 !== review.rulesHash ||
            canonicalJson(old.input.plan) !== canonicalJson(review.plan)) throw new Error('Finance request was used for different reviewed inputs.');
        return old.id;
    }
    const { context, catalog } = await dependencies.read();
    if (context.owner_id !== owner || context.ordinal !== review.expected || context.stamp !== review.stamp) throw new Error('Finance inputs changed.');
    const prepared = prepareBankCoveredFinancePlan(owner, review.plan, today, catalog, context.invoice_coverage, context.bank_source_coverage);
    if (prepared.resultJson !== canonicalJson(JSON.parse(review.resultJson)) || prepared.rulesHash !== review.rulesHash) throw new Error('Finance read-back changed.');
    return dependencies.capture(prepared);
}

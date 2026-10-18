import { apportionPence, sumPence } from '../money';
import { redactBankDetailsForPrompt } from '../ai/redaction';
import { minorPence } from './allocations';
import { refundReview, type RefundChoice } from './refunds';
import { parseFxDependencies, requireDependencySources, type FxDependencies } from '../fx/dependencies';

export type SplitRefundChoice = RefundChoice & {
    user_id: string; source_row_id: string; recognized_record_id: string | null; record_transaction_id: string | null;
    project_id: string | null; category_valid: boolean; record_provenance_valid?: boolean;
    category_label?: string | null; project_label?: string | null;
};
export type RefundSplitCatalog = { owner_id: string; stamp: string; transactions: SplitRefundChoice[]; fx_dependencies?: FxDependencies };
export type RefundSplitIntent = {
    schema_version: 'refund-split-intent/1'; refund_id: string; refund_version: number; expected_stamp: string;
    allocations: { original_id: string; original_version: number; refund_stamp: string; amount_pence: number }[];
    rationale: string; request_id: string;
};
export type RefundSplitPortion = {
    original_id: string; original_version: number; original_source_row_id: string; original_import_id: string; original_date: string;
    original_record_id: string; category_id: string; project_id: string | null; record_type: 'income' | 'expense'; business_use_bps: number;
    prior_refunded_pence: number; prior_reduced_pence: number; amount_pence: number; recognized_pence: number;
    remaining_original_pence: number; needs_invoice_correction: boolean;
};
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i, stamp = /^[a-f0-9]{32}$/;
export const REFUND_SPLIT_ENGINE = 'vibecount-refund-splits/1';
function identity(value: unknown): string { if (typeof value !== 'string' || !uuid.test(value)) throw new Error('Review an owned source identity.'); return value.toLowerCase(); }
function version(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 2147483647) throw new Error('Review the exact source version.'); return value as number; }
function bounded(value: unknown, positive = false): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (positive ? 1 : 0) || value > 999999999999) throw new Error('Use bounded exact integer pence.'); return value;
}
function object(value: unknown, keys: string[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Review a plain split-refund object.');
    const v = value as Record<string, unknown>;
    if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) throw new Error('Review exact split-refund fields; extra fields are not retained.'); return v;
}
function financialStamp(value: unknown): string { if (typeof value !== 'string' || !stamp.test(value)) throw new Error('Review the source financial stamp.'); return value; }
function date(value: unknown): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Review a source date.');
    const n = Date.parse(value + 'T00:00:00Z'); if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value || value < '1900-01-01' || value > '9998-12-31') throw new Error('Review a source date.'); return value;
}
export function validateRefundSplitIntent(value: unknown): RefundSplitIntent {
    const p = object(value, ['schema_version', 'refund_id', 'refund_version', 'expected_stamp', 'allocations', 'rationale', 'request_id']);
    if (p.schema_version !== 'refund-split-intent/1' || !Array.isArray(p.allocations) || p.allocations.length < 1 || p.allocations.length > 100) throw new Error('Review one to 100 original portions.');
    if (typeof p.rationale !== 'string' || !p.rationale.trim() || p.rationale.trim().length > 1000) throw new Error('Add a bounded review reason.');
    const rationale = redactBankDetailsForPrompt(p.rationale.trim()); if (rationale.length > 1000) throw new Error('Use a shorter reason without private details.');
    const allocations = p.allocations.map(value => {
        const a = object(value, ['original_id', 'original_version', 'refund_stamp', 'amount_pence']);
        return { original_id: identity(a.original_id), original_version: version(a.original_version), refund_stamp: financialStamp(a.refund_stamp), amount_pence: bounded(a.amount_pence, true) };
    }).sort((a, b) => a.original_id < b.original_id ? -1 : a.original_id > b.original_id ? 1 : 0);
    if (new Set(allocations.map(a => a.original_id)).size !== allocations.length) throw new Error('An original can appear only once.');
    return { schema_version: 'refund-split-intent/1', refund_id: identity(p.refund_id), refund_version: version(p.refund_version), expected_stamp: financialStamp(p.expected_stamp), allocations, rationale, request_id: identity(p.request_id) };
}
function source(s: SplitRefundChoice, owner: string) {
    if (s.user_id !== owner) throw new Error('Source is not owned.');
    identity(s.id); identity(s.source_row_id); identity(s.account_id); identity(s.import_id); date(s.transaction_date); version(s.decision_version);
    const cash = minorPence(s.signed_amount_pence); bounded(Math.abs(cash), true);
    if (s.currency !== 'GBP' || s.dedupe_status !== 'clear' || !['review', 'committed'].includes(s.import_status)) throw new Error('Resolve source currency, duplicate or import state.');
    if (s.active_transfer_id || s.active_refund_id) throw new Error('Reverse existing transfer/refund relationships first.');
    if (s.recognized_record_id !== null) identity(s.recognized_record_id);
    if (s.record_provenance_valid === false) throw new Error('Review valid source posting provenance.');
    if (s.project_id !== null) identity(s.project_id);
    return cash;
}
/** Pure reference/read-back calculation. This function authorises or persists no financial action. */
export function refundSplitReview(owner: string, value: unknown, catalog: RefundSplitCatalog) {
    identity(owner);
    const intent = validateRefundSplitIntent(value);
    if (catalog.owner_id !== owner || catalog.stamp !== intent.expected_stamp) throw new Error('Split refund financial context changed.');
    if (!Array.isArray(catalog.transactions) || catalog.transactions.length > 10000 || catalog.transactions.some(s => s.user_id !== owner) || new Set(catalog.transactions.map(s => s.id)).size !== catalog.transactions.length) throw new Error('Complete owned source catalog unavailable.');
    const byId = new Map(catalog.transactions.map(s => [s.id, s])), refund = byId.get(intent.refund_id);
    if (catalog.fx_dependencies) {
        const dependencies = parseFxDependencies(owner, catalog.fx_dependencies);
        requireDependencySources(dependencies, catalog.transactions, catalog.stamp);
        const selected = new Set([intent.refund_id, ...intent.allocations.map(a => a.original_id)]);
        if (dependencies.fx_blockers.some(b => selected.has(b.receipt_id))) throw new Error('Review linked FX lots before allocating these refund sources.');
    }
    if (!refund || refund.decision_version !== intent.refund_version) throw new Error('Refund source version changed.');
    const signedCash = source(refund, owner), cash = Math.abs(signedCash);
    if (refund.has_refunds || minorPence(refund.invoice_allocated_pence) !== 0) throw new Error('Reverse refund-source dependencies before splitting.');
    const prior = minorPence(refund.recognized_pence);
    if (refund.record_status === 'approved') {
        if (!refund.recognized_record_id || refund.record_transaction_id !== refund.id || refund.effect_sign !== 1 || refund.record_type !== (signedCash > 0 ? 'income' : 'expense') || prior <= 0 || prior > cash || !['Business', 'Mixed'].includes(refund.classification)) throw new Error('Review the existing interpretation before replacing it.');
    } else if (prior !== 0) throw new Error('Unapproved source cannot have a recognised amount.');
    if (sumPence(intent.allocations.map(a => a.amount_pence)) !== cash) throw new Error('Portions must allocate the entire observed refund cash exactly.');
    const portions: RefundSplitPortion[] = intent.allocations.map(a => {
        const original = byId.get(a.original_id);
        if (!original || original.decision_version !== a.original_version || original.refund_stamp !== a.refund_stamp) throw new Error('Original payment or refund group changed.');
        const gross = Math.abs(source(original, owner));
        if (!original.recognized_record_id || original.record_transaction_id !== original.id || !original.category_valid || !original.category_id || !original.record_type) throw new Error('Review valid original record/category provenance.');
        identity(original.category_id);
        if (original.record_type !== (minorPence(original.signed_amount_pence) > 0 ? 'income' : 'expense') ||
            (original.classification === 'Business' && original.business_use_bps !== 10000) ||
            (original.classification === 'Mixed' && (original.record_type !== 'expense' || original.business_use_bps <= 0 || original.business_use_bps >= 10000))) throw new Error('Review the original accounting treatment.');
        const refunded = bounded(minorPence(original.refunded_pence)), reduced = bounded(minorPence(original.reduced_pence));
        if (refunded > gross || reduced !== apportionPence(refunded, original.business_use_bps) ||
            !Number.isSafeInteger(original.refund_count) || original.refund_count < 0 || (refunded === 0) !== (original.refund_count === 0)) throw new Error('Prior refund totals are inconsistent; reload complete history.');
        const r = refundReview(original, { ...refund, signed_amount_pence: (signedCash > 0 ? 1 : -1) * a.amount_pence });
        return { original_id: original.id, original_version: original.decision_version, original_source_row_id: original.source_row_id, original_import_id: original.import_id,
            original_date: original.transaction_date, original_record_id: original.recognized_record_id, category_id: original.category_id, project_id: original.project_id,
            record_type: r.type!, business_use_bps: original.business_use_bps, prior_refunded_pence: refunded, prior_reduced_pence: reduced,
            amount_pence: a.amount_pence, recognized_pence: r.reduction, remaining_original_pence: r.remainingGross, needs_invoice_correction: r.needsInvoiceCorrection };
    });
    if (new Set([refund.source_row_id, ...portions.map(p => p.original_source_row_id)]).size !== portions.length + 1 || new Set(portions.map(p => p.original_record_id)).size !== portions.length) throw new Error('Source rows and original records must have distinct provenance.');
    const incomeReduction = sumPence(portions.filter(p => p.record_type === 'income').map(p => p.recognized_pence)), expenseReduction = sumPence(portions.filter(p => p.record_type === 'expense').map(p => p.recognized_pence));
    const removedIncome = refund.record_status === 'approved' && refund.record_type === 'income' ? prior : 0, removedExpense = refund.record_status === 'approved' && refund.record_type === 'expense' ? prior : 0;
    const incomeDelta = sumPence([-removedIncome, -incomeReduction]), expenseDelta = sumPence([-removedExpense, -expenseReduction]);
    return { engine_version: REFUND_SPLIT_ENGINE, intent, result: {
        refund_id: refund.id, refund_version: refund.decision_version, refund_source_row_id: refund.source_row_id, refund_import_id: refund.import_id, refund_date: refund.transaction_date,
        observed_cash_pence: cash, allocated_cash_pence: sumPence(portions.map(p => p.amount_pence)), recognized_reduction_pence: sumPence([incomeReduction, expenseReduction]),
        income_reduction_pence: incomeReduction, expense_reduction_pence: expenseReduction, removed_ordinary_income_pence: removedIncome, removed_ordinary_expense_pence: removedExpense,
        income_delta_pence: incomeDelta, expense_delta_pence: expenseDelta, profit_delta_pence: sumPence([incomeDelta, -expenseDelta]),
        portions, posting_count: portions.filter(p => p.recognized_pence > 0).length, zero_recognized_portion_count: portions.filter(p => p.recognized_pence === 0).length,
        financial_action: 'preview_only' as const,
    } };
}

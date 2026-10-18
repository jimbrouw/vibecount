import { apportionPence, sumPence } from '../money';
import { minorPence } from './allocations';

export type RefundClosureTransaction = {
    id: string; user_id: string; import_id: string; source_row_id: string; decision_version: number;
    signed_amount_pence: number | string; currency: string; original_link_count: number; refund_link_count: number;
};
export type RefundClosureLink = {
    id: string; user_id: string; original_transaction_id: string; refund_transaction_id: string;
    amount_pence: number | string; recognized_pence: number | string; record_type: 'income' | 'expense';
    business_use_bps: number; category_id: string; record_id: string | null; assignment_count: number;
};
export type RefundClosureAssignment = { id: string; user_id: string; refund_id: string; amount_pence: number | string };
export type RefundClosureCatalog = {
    owner_id: string; stamp: string; transactions: RefundClosureTransaction[]; links: RefundClosureLink[];
    assignments: RefundClosureAssignment[]; imports: { id: string; user_id: string; transaction_count: number }[];
};
export type RefundClosureScope = { kind: 'original' | 'refund' | 'import'; id: string };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const sort = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function identity(value: unknown): asserts value is string { if (typeof value !== 'string' || !uuid.test(value)) throw new Error('Owned refund graph identity unavailable.'); }
function count(value: unknown) { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Complete refund graph counts unavailable.'); }
function pence(value: number | string, positive = false) { const n = minorPence(value); if (n < (positive ? 1 : 0) || n > 999999999999) throw new Error('Invalid refund graph pence.'); return n; }
function unique<T extends { id: string; user_id: string }>(rows: T[], owner: string) {
    if (!Array.isArray(rows) || rows.length > 20000) throw new Error('Complete bounded refund graph unavailable.');
    for (const r of rows) { identity(r.id); if (r.user_id !== owner) throw new Error('Foreign refund graph source.'); }
    if (new Set(rows.map(r => r.id)).size !== rows.length) throw new Error('Duplicate refund graph identity.');
    return new Map(rows.map(r => [r.id, r]));
}
/**
 * Read-back/reference model for the entire active connected component. Catalogs and their
 * counts/stamp must be reconstructed on the authenticated server, never supplied as authority
 * by a browser. Excluded/reversed links are not active edges. This function performs no write.
 */
export function refundReversalClosure(owner: string, scope: RefundClosureScope, catalog: RefundClosureCatalog) {
    identity(owner); identity(scope.id);
    if (!['original', 'refund', 'import'].includes(scope.kind) || catalog.owner_id !== owner || !/^[a-f0-9]{32}$/.test(catalog.stamp)) throw new Error('Owned refund closure context unavailable.');
    const tx = unique(catalog.transactions, owner), links = unique(catalog.links, owner), assignments = unique(catalog.assignments, owner), imports = unique(catalog.imports, owner);
    const byOriginal = new Map<string, RefundClosureLink[]>(), byRefund = new Map<string, RefundClosureLink[]>(), byAssignment = new Map<string, RefundClosureAssignment[]>();
    function add<T>(map: Map<string, T[]>, key: string, value: T) { const rows = map.get(key) ?? []; rows.push(value); map.set(key, rows); }
    for (const t of tx.values()) {
        identity(t.import_id); identity(t.source_row_id); count(t.decision_version); count(t.original_link_count); count(t.refund_link_count);
        if (!imports.has(t.import_id)) throw new Error('Owned source import missing from refund graph.');
        pence(Math.abs(minorPence(t.signed_amount_pence)), true); if (t.currency !== 'GBP') throw new Error('Refund currency needs a supported review.');
        if (t.original_link_count && t.refund_link_count) throw new Error('A refund observation cannot also be an original payment.');
    }
    for (const i of imports.values()) count(i.transaction_count);
    for (const l of links.values()) {
        identity(l.original_transaction_id); identity(l.refund_transaction_id); identity(l.category_id); count(l.assignment_count);
        const original = tx.get(l.original_transaction_id), refund = tx.get(l.refund_transaction_id);
        if (!original || !refund || original.id === refund.id || (minorPence(original.signed_amount_pence) > 0) === (minorPence(refund.signed_amount_pence) > 0)) throw new Error('Incomplete or invalid original/refund endpoints.');
        if (!['income', 'expense'].includes(l.record_type) || l.record_type !== (minorPence(original.signed_amount_pence) > 0 ? 'income' : 'expense') || !Number.isInteger(l.business_use_bps) || l.business_use_bps < 1 || l.business_use_bps > 10000 || (l.record_type === 'income' && l.business_use_bps !== 10000)) throw new Error('Invalid refund accounting bucket or percentage.');
        const cash = pence(l.amount_pence, true), recognised = pence(l.recognized_pence);
        if (recognised > cash || (recognised === 0 ? l.record_id !== null : l.record_id === null)) throw new Error('Refund effect provenance incomplete.');
        if (l.record_id !== null) identity(l.record_id);
        add(byOriginal, original.id, l); add(byRefund, refund.id, l);
    }
    if (new Set(catalog.transactions.map(t => t.source_row_id)).size !== catalog.transactions.length) throw new Error('Refund observations must retain unique source rows.');
    const records = catalog.links.flatMap(l => l.record_id ? [l.record_id] : []);
    if (new Set(records).size !== records.length) throw new Error('Each refund effect must have its own record.');
    for (const a of assignments.values()) { identity(a.refund_id); pence(a.amount_pence, true); if (!links.has(a.refund_id)) throw new Error('Refund assignment source unavailable.'); add(byAssignment, a.refund_id, a); }
    for (const l of links.values()) {
        const rows = byAssignment.get(l.id) ?? [];
        if (rows.length !== l.assignment_count || sumPence(rows.map(a => pence(a.amount_pence, true))) > pence(l.amount_pence, true)) throw new Error('Complete refund assignment history unavailable.');
        if (rows.length && (l.record_type !== 'income' || l.business_use_bps !== 10000)) throw new Error('Invoice refund assignment does not match income cash.');
    }
    for (const t of tx.values()) {
        const originals = byOriginal.get(t.id) ?? [], refunds = byRefund.get(t.id) ?? [];
        if (originals.length !== t.original_link_count || refunds.length !== t.refund_link_count) throw new Error('Complete connected refund edges unavailable.');
        if (originals.length) {
            const first = originals[0], cash = sumPence(originals.map(l => pence(l.amount_pence, true))), recognised = sumPence(originals.map(l => pence(l.recognized_pence)));
            if (originals.some(l => l.business_use_bps !== first.business_use_bps || l.category_id !== first.category_id || l.record_type !== first.record_type) || cash > Math.abs(minorPence(t.signed_amount_pence)) || recognised !== apportionPence(cash, first.business_use_bps)) throw new Error('Original refund capacity or cumulative rounding is inconsistent.');
        }
        if (refunds.length && sumPence(refunds.map(l => pence(l.amount_pence, true))) !== Math.abs(minorPence(t.signed_amount_pence))) throw new Error('Shared refund cash is not completely allocated.');
    }
    let seeds: string[];
    if (scope.kind === 'import') {
        const imp = imports.get(scope.id); if (!imp) throw new Error('Owned root import unavailable.');
        seeds = [...tx.values()].filter(t => t.import_id === scope.id).map(t => t.id);
        if (seeds.length !== imp.transaction_count) throw new Error('Complete root-import observations unavailable.');
    } else {
        if (!tx.has(scope.id)) throw new Error('Owned root source unavailable.');
        if (scope.kind === 'original' && (tx.get(scope.id)!.refund_link_count > 0)) throw new Error('Choose an original payment as the root.');
        if (scope.kind === 'refund' && (tx.get(scope.id)!.original_link_count > 0)) throw new Error('Choose refund cash as the root.');
        seeds = [scope.id];
    }
    const nodes = new Set<string>(), edges = new Set<string>(), queue = [...seeds];
    for (let index = 0; index < queue.length; index++) {
        const id = queue[index]; if (nodes.has(id)) continue; nodes.add(id);
        for (const l of [...(byOriginal.get(id) ?? []), ...(byRefund.get(id) ?? [])]) {
            if (edges.has(l.id)) continue; edges.add(l.id); queue.push(l.original_transaction_id, l.refund_transaction_id);
        }
    }
    const selected = [...edges].sort(sort).map(id => links.get(id)!), originalIds = [...new Set(selected.map(l => l.original_transaction_id))].sort(sort), refundIds = [...new Set(selected.map(l => l.refund_transaction_id))].sort(sort);
    const sourceIds = [...new Set([...originalIds, ...refundIds])].sort(sort), affectedImports = [...new Set(sourceIds.map(id => tx.get(id)!.import_id))].sort(sort);
    const blocking = selected.flatMap(l => byAssignment.get(l.id) ?? []).sort((a, b) => sort(a.id, b.id));
    const cash = sumPence(refundIds.map(id => Math.abs(minorPence(tx.get(id)!.signed_amount_pence))));
    if (cash !== sumPence(selected.map(l => pence(l.amount_pence, true)))) throw new Error('Refund closure omitted shared cash portions.');
    const income = sumPence(selected.filter(l => l.record_type === 'income').map(l => pence(l.recognized_pence))), expense = sumPence(selected.filter(l => l.record_type === 'expense').map(l => pence(l.recognized_pence)));
    return { schema_version: 'refund-reversal-closure/1' as const, owner_id: owner, scope: { kind: scope.kind, id: scope.id }, financial_stamp: catalog.stamp,
        link_ids: selected.map(l => l.id), original_ids: originalIds, refund_ids: refundIds, import_ids: affectedImports,
        source_versions: sourceIds.map(id => { const t = tx.get(id)!; return { id, decision_version: t.decision_version, import_id: t.import_id, source_row_id: t.source_row_id }; }),
        refund_observations: refundIds.map(id => { const t = tx.get(id)!; return { id, import_id: t.import_id, cash_pence: Math.abs(minorPence(t.signed_amount_pence)) }; }),
        portions: selected.map(l => ({ id: l.id, original_id: l.original_transaction_id, refund_id: l.refund_transaction_id,
            cash_pence: pence(l.amount_pence, true), recognized_pence: pence(l.recognized_pence), record_type: l.record_type })),
        observed_refund_cash_pence: cash, income_reduction_removed_pence: income, expense_reduction_removed_pence: expense,
        income_delta_pence: income, expense_delta_pence: expense, profit_delta_pence: sumPence([income, -expense]),
        blocking_assignment_ids: blocking.map(a => a.id), blocked: blocking.length > 0, restored_prior_classifications: 0,
        financial_action: 'preview_only' as const };
}
export type RefundReversalClosure = ReturnType<typeof refundReversalClosure>;

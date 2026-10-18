import { sumPence } from '../money';
import { minorPence } from './allocations';
import { refundReversalClosure, type RefundClosureCatalog } from './refund-closure';
type Owned = { id: string; user_id: string };
export type ImportReversalTransaction = Owned & {
    import_id: string; source_row_id: string; transaction_date: string; decision_version: number;
    signed_amount_pence: number | string; currency: string; classification: string; account_id: string; account_type: string; import_status: string;
    recognized_record_id: string | null; active_transfer_id: string | null; active_refund_id: string | null;
    record_count: number; allocation_count: number; transfer_pair_count: number; original_link_count: number; refund_link_count: number;
};
export type ImportReversalEffect = Owned & {
    bank_transaction_id: string | null; import_id: string | null; record_date: string; record_type: string; amount_pence: number | string;
    effect_sign: number; refund_link_id: string | null; status: string; category_id: string | null; project_id: string | null;
};
export type ImportReversalContext = {
    schema_version: 'source-import-reversal-context/1'; owner_id: string; import_id: string; import_status: string; financial_stamp: string;
    counts: Record<'target_transactions' | 'transactions' | 'effects' | 'transfers' | 'allocations' | 'invoices' | 'assignments' | 'duplicates', number>;
    transactions: ImportReversalTransaction[]; effects: ImportReversalEffect[];
    transfer_pairs: (Owned & { outgoing_transaction_id: string; incoming_transaction_id: string; amount_pence: number | string; kind: string })[];
    allocations: (Owned & { invoice_id: string; transaction_id: string; amount_pence: number | string; assignment_count: number })[];
    invoices: (Owned & { status: string; currency: string; invoice_pence: number | string; credited_pence: number | string; entitlement_pence: number | string; allocated_pence: number | string; returned_pence: number | string; retained_cash_pence: number | string; outstanding_pence: number | string; refund_due_pence: number | string })[];
    blocking_assignments: (Owned & { refund_id: string; allocation_id: string; amount_pence: number | string })[];
    duplicate_references: (Owned & { transaction_id: string; retained_transaction_id: string })[];
    refund_graph: RefundClosureCatalog;
};
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function id(v: unknown): asserts v is string { if (typeof v !== 'string' || !uuid.test(v)) throw new Error('Complete owned source identity unavailable.'); }
function count(v: unknown) { if (!Number.isSafeInteger(v) || (v as number) < 0 || (v as number) > 20000) throw new Error('Complete bounded reversal counts unavailable.'); }
function pence(v: number | string, positive = false) { const n = minorPence(v); if (n < (positive ? 1 : 0) || n > 999999999999) throw new Error('Invalid reversal amount.'); return n; }
function date(v: string) { const n = Date.parse(v + 'T00:00:00Z'); if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== v) throw new Error('Source date unavailable.'); }
function owned<T extends Owned>(rows: T[], owner: string) {
    if (!Array.isArray(rows) || rows.length > 20000) throw new Error('Complete bounded reversal sources unavailable.');
    for (const r of rows) { id(r.id); if (r.user_id !== owner) throw new Error('Foreign reversal source.'); }
    if (new Set(rows.map(r => r.id)).size !== rows.length) throw new Error('Duplicate reversal source.');
    return new Map(rows.map(r => [r.id, r]));
}
/** Independent complete read-back; callers obtain context from the owner-derived
 * atomic RPC. This performs no write and returns detached safe fields only. */
export function sourceImportReversalReview(owner: string, c: ImportReversalContext) {
    id(owner); id(c.import_id);
    if (c.schema_version !== 'source-import-reversal-context/1' || c.owner_id !== owner || !/^[a-f0-9]{32}$/.test(c.financial_stamp) || !['review', 'committed', 'discarded'].includes(c.import_status)) throw new Error('Owned import reversal context unavailable.');
    const tx = owned(c.transactions, owner), effects = owned(c.effects, owner), pairs = owned(c.transfer_pairs, owner), allocations = owned(c.allocations, owner), invoices = owned(c.invoices, owner), assignments = owned(c.blocking_assignments, owner), duplicates = owned(c.duplicate_references, owner);
    const actual = { target_transactions: c.transactions.filter(t => t.import_id === c.import_id).length, transactions: tx.size, effects: effects.size, transfers: pairs.size, allocations: allocations.size, invoices: invoices.size, assignments: assignments.size, duplicates: duplicates.size };
    for (const key of Object.keys(actual) as (keyof typeof actual)[]) { count(c.counts[key]); if (c.counts[key] !== actual[key]) throw new Error('Complete import reversal counts disagree.'); }
    if (c.refund_graph.stamp !== c.financial_stamp) throw new Error('Refund context changed during import review.');
    const closure = refundReversalClosure(owner, { kind: 'import', id: c.import_id }, c.refund_graph);
    const graph = new Map(c.refund_graph.transactions.map(t => [t.id, t])), graphLinks = new Map(c.refund_graph.links.map(l => [l.id, l]));
    const expected = new Set(graph.keys()), target = new Set(c.transactions.filter(t => t.import_id === c.import_id).map(t => t.id)), refunds = new Set(closure.refund_ids), reset = new Set([...target, ...refunds]);
    const records = new Map<string, ImportReversalEffect[]>(), matched = new Map<string, typeof c.allocations>();
    for (const f of effects.values()) {
        id(f.bank_transaction_id); id(f.import_id); date(f.record_date); pence(f.amount_pence, true);
        const t = tx.get(f.bank_transaction_id);
        if (!t || t.import_id !== f.import_id || !['income', 'expense'].includes(f.record_type) || !['draft', 'review', 'approved', 'excluded'].includes(f.status) || ![1, -1].includes(f.effect_sign)) throw new Error('Complete source effect provenance unavailable.');
        if (f.category_id !== null) id(f.category_id); if (f.project_id !== null) id(f.project_id);
        if (f.effect_sign === -1) { id(f.refund_link_id); if (f.status === 'approved' && !graphLinks.has(f.refund_link_id)) throw new Error('Approved refund effect absent from complete closure.'); }
        else if (f.refund_link_id !== null) throw new Error('Ordinary effect cannot be a refund child.');
        const rows = records.get(t.id) ?? []; rows.push(f); records.set(t.id, rows);
    }
    for (const t of tx.values()) {
        id(t.import_id); id(t.source_row_id); id(t.account_id); date(t.transaction_date); pence(Math.abs(minorPence(t.signed_amount_pence)), true);
        if ((t.import_status === 'discarded' && (t.import_id !== c.import_id || c.import_status !== 'discarded')) || !Number.isSafeInteger(t.decision_version) || t.decision_version < 0 || t.decision_version >= 2147483647 || t.currency !== 'GBP' || !['review', 'committed', 'discarded'].includes(t.import_status)) throw new Error('Affected source state unavailable.');
        for (const n of [t.record_count, t.allocation_count, t.transfer_pair_count, t.original_link_count, t.refund_link_count]) count(n);
        if ((records.get(t.id) ?? []).length !== t.record_count) throw new Error('Complete retained effects unavailable.');
        if (t.recognized_record_id !== null && !records.get(t.id)?.some(f => f.id === t.recognized_record_id)) throw new Error('Canonical source pointer is not reciprocal.');
        const g = graph.get(t.id);
        if (g && (g.import_id !== t.import_id || g.source_row_id !== t.source_row_id || g.decision_version !== t.decision_version || minorPence(g.signed_amount_pence) !== minorPence(t.signed_amount_pence) || g.original_link_count !== t.original_link_count || g.refund_link_count !== t.refund_link_count)) throw new Error('Refund and source context disagree.');
        if (t.active_refund_id !== null && !c.refund_graph.links.some(l => l.id === t.active_refund_id && l.refund_transaction_id === t.id)) throw new Error('Refund dependency marker unavailable.');
    }
    const endpoints = new Set<string>();
    for (const pair of pairs.values()) {
        const outgoing = tx.get(pair.outgoing_transaction_id), incoming = tx.get(pair.incoming_transaction_id), cash = pence(pair.amount_pence, true);
        if (!outgoing || !incoming || outgoing.id === incoming.id || outgoing.account_id === incoming.account_id || outgoing.account_type !== 'bank' || !['transfer', 'card_repayment'].includes(pair.kind) || incoming.account_type !== (pair.kind === 'card_repayment' ? 'credit_card' : 'bank') || minorPence(outgoing.signed_amount_pence) !== -cash || minorPence(incoming.signed_amount_pence) !== cash || (!target.has(outgoing.id) && !target.has(incoming.id))) throw new Error('Complete transfer endpoints unavailable.');
        for (const t of [outgoing, incoming]) {
            if (endpoints.has(t.id) || t.active_transfer_id !== pair.id || t.classification !== 'Transfer' || t.transfer_pair_count !== 1 || t.allocation_count || t.original_link_count || t.refund_link_count || (records.get(t.id) ?? []).some(f => f.status === 'approved')) throw new Error('Transfer overlaps an accounting dependency.');
            endpoints.add(t.id); expected.add(t.id); reset.add(t.id);
        }
    }
    for (const t of tx.values()) if (!expected.has(t.id) || (!endpoints.has(t.id) && (t.active_transfer_id !== null || t.transfer_pair_count))) throw new Error('Unexpected or missing affected source.');
    if (expected.size !== tx.size || new Set(c.transactions.map(t => t.source_row_id)).size !== tx.size) throw new Error('Complete unique source context unavailable.');
    for (const link of c.refund_graph.links) {
        if (pence(link.recognized_pence) > 0 && !effects.has(link.record_id!)) throw new Error('Approved refund child missing from import effects.');
        if (link.record_id) { const f = effects.get(link.record_id)!; if (f.status !== 'approved' || f.bank_transaction_id !== link.refund_transaction_id || f.effect_sign !== -1 || f.refund_link_id !== link.id || f.record_type !== link.record_type || pence(f.amount_pence) !== pence(link.recognized_pence)) throw new Error('Refund child and source effect disagree.'); }
    }
    for (const a of allocations.values()) {
        id(a.transaction_id); id(a.invoice_id); count(a.assignment_count); pence(a.amount_pence, true);
        if (!target.has(a.transaction_id) || !invoices.has(a.invoice_id)) throw new Error('Invoice allocation source unavailable.');
        const rows = matched.get(a.transaction_id) ?? []; rows.push(a); matched.set(a.transaction_id, rows);
    }
    for (const t of tx.values()) if (target.has(t.id) && (matched.get(t.id) ?? []).length !== t.allocation_count) throw new Error('Complete target receipt allocations unavailable.');
    for (const a of assignments.values()) { id(a.refund_id); id(a.allocation_id); pence(a.amount_pence, true); if (!graphLinks.has(a.refund_id) && !allocations.has(a.allocation_id)) throw new Error('Unexpected assignment blocker.'); }
    for (const a of allocations.values()) if (c.blocking_assignments.filter(s => s.allocation_id === a.id).length !== a.assignment_count) throw new Error('Incomplete invoice assignment blockers.');
    for (const a of c.refund_graph.assignments) if (!assignments.has(a.id)) throw new Error('Missing sibling assignment blocker.');
    for (const d of duplicates.values()) { id(d.transaction_id); id(d.retained_transaction_id); if (!target.has(d.retained_transaction_id)) throw new Error('Unexpected retained-source blocker.'); }
    const invoiceChanges = c.invoices.map(i => {
        if (i.status !== 'finalised' || i.currency !== 'GBP') throw new Error('Invoice balance unavailable.');
        const gross = pence(i.invoice_pence, true), credited = pence(i.credited_pence), allocated = pence(i.allocated_pence), returned = pence(i.returned_pence), entitlement = pence(i.entitlement_pence), retained = pence(i.retained_cash_pence);
        if (gross - credited !== entitlement || allocated - returned !== retained || pence(i.outstanding_pence) !== Math.max(entitlement - retained, 0) || pence(i.refund_due_pence) !== Math.max(retained - entitlement, 0)) throw new Error('Invoice balance equations disagree.');
        const released = sumPence(c.allocations.filter(a => a.invoice_id === i.id).map(a => pence(a.amount_pence))), afterRetained = retained - released;
        if (released <= 0 || (afterRetained < 0 && assignments.size === 0)) throw new Error('Invoice release exceeds retained receipts.');
        return { id: i.id, released_allocation_pence: released, credited_pence: credited, returned_pence: returned, outstanding_before_pence: pence(i.outstanding_pence), outstanding_after_pence: afterRetained < 0 ? null : Math.max(entitlement - afterRetained, 0), refund_due_before_pence: pence(i.refund_due_pence), refund_due_after_pence: afterRetained < 0 ? null : Math.max(afterRetained - entitlement, 0), retained_before_pence: retained, retained_after_pence: afterRetained < 0 ? null : afterRetained };
    });
    const excluded = c.effects.filter(f => f.status === 'approved' && reset.has(f.bank_transaction_id!));
    const income = sumPence(excluded.filter(f => f.record_type === 'income').map(f => pence(f.amount_pence) * f.effect_sign)), expense = sumPence(excluded.filter(f => f.record_type === 'expense').map(f => pence(f.amount_pence) * f.effect_sign));
    const safeSource = (t: ImportReversalTransaction) => ({ id: t.id, import_id: t.import_id, source_row_id: t.source_row_id, transaction_date: t.transaction_date, decision_version: t.decision_version, signed_amount_pence: minorPence(t.signed_amount_pence), classification: t.classification });
    return { schema_version: 'source-import-reversal-review/1' as const, owner_id: owner, import_id: c.import_id, import_status: c.import_status, financial_stamp: c.financial_stamp,
        target_sources: c.transactions.filter(t => target.has(t.id)).map(safeSource), external_reset_sources: c.transactions.filter(t => reset.has(t.id) && !target.has(t.id)).map(safeSource), retained_original_sources: c.transactions.filter(t => !reset.has(t.id)).map(safeSource),
        reset_ids: [...reset].sort(), excluded_record_ids: excluded.map(f => f.id).sort(), retained_record_count: effects.size,
        records_to_exclude: excluded.map(f => ({ id: f.id, source_id: f.bank_transaction_id!, date: f.record_date, record_type: f.record_type, amount_pence: pence(f.amount_pence), effect_sign: f.effect_sign, refund_link_id: f.refund_link_id, category_id: f.category_id, project_id: f.project_id })),
        transfer_pairs: c.transfer_pairs.map(p => ({ id: p.id, kind: p.kind, outgoing_id: p.outgoing_transaction_id, incoming_id: p.incoming_transaction_id, amount_pence: pence(p.amount_pence) })),
        allocations: c.allocations.map(a => ({ id: a.id, invoice_id: a.invoice_id, source_id: a.transaction_id, amount_pence: pence(a.amount_pence) })), invoices: invoiceChanges, refund_closure: closure,
        blocking_assignment_ids: [...assignments.keys()].sort(), blocking_duplicate_ids: [...duplicates.keys()].sort(),
        income_delta_pence: -income, expense_delta_pence: -expense, profit_delta_pence: sumPence([-income, expense]),
        transfer_cash_pence: sumPence(c.transfer_pairs.map(p => pence(p.amount_pence))), released_allocation_pence: sumPence(c.allocations.map(a => pence(a.amount_pence))),
        blocked: assignments.size > 0 || duplicates.size > 0 || c.import_status === 'discarded', restored_prior_classifications: 0, financial_action: 'preview_only' as const };
}
export type ImportReversalReview = ReturnType<typeof sourceImportReversalReview>;

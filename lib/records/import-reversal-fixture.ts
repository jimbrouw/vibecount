/** Synthetic metadata only: no real source files, account details or financial action. */
import { refundClosureFixture, refundFixtureId as id } from './refund-split-fixture';
import type { ImportReversalContext, ImportReversalTransaction, ImportReversalEffect } from './import-reversal';
export function importReversalFixture(): ImportReversalContext {
    const owner = id(1), root = id(20), g = refundClosureFixture();
    g.transactions = g.transactions.filter(t => ![id(103), id(113)].includes(t.id)); g.links = g.links.slice(0, 5);
    g.imports = g.imports.filter(i => ![id(13), id(23)].includes(i.id));
    for (const [n, cash] of [[120, -1000], [121, -500], [123, 1000]]) g.transactions.push({ id: id(n), user_id: owner, import_id: root, source_row_id: id(n + 200), decision_version: 1, signed_amount_pence: cash, currency: 'GBP', original_link_count: 0, refund_link_count: 0 });
    g.imports.find(i => i.id === root)!.transaction_count = 4;
    const effects: ImportReversalEffect[] = [
        ...[100, 101, 102, 120, 123].map((n, i) => ({ id: id(310 + i), user_id: owner, bank_transaction_id: id(n), import_id: g.transactions.find(t => t.id === id(n))!.import_id, record_date: '2026-04-06', record_type: n === 123 ? 'income' : 'expense', amount_pence: [500, 1000, 300, 1000, 1000][i], effect_sign: 1, refund_link_id: null, status: 'approved', category_id: id(400 + n), project_id: null })),
        ...g.links.map(l => ({ id: l.record_id!, user_id: owner, bank_transaction_id: l.refund_transaction_id, import_id: g.transactions.find(t => t.id === l.refund_transaction_id)!.import_id, record_date: '2026-04-06', record_type: l.record_type, amount_pence: l.recognized_pence, effect_sign: -1, refund_link_id: l.id, status: 'approved', category_id: l.category_id, project_id: null })),
    ];
    const transactions: ImportReversalTransaction[] = g.transactions.map(t => ({ ...t, transaction_date: '2026-04-06', classification: t.refund_link_count ? 'Refund' : t.id === id(121) ? 'Transfer' : 'Business', account_id: id(2), account_type: 'bank', import_status: 'review', recognized_record_id: effects.find(f => f.bank_transaction_id === t.id && f.effect_sign === 1)?.id ?? null, active_transfer_id: t.id === id(121) ? id(900) : null, active_refund_id: g.links.find(l => l.refund_transaction_id === t.id)?.id ?? null, record_count: effects.filter(f => f.bank_transaction_id === t.id).length, allocation_count: t.id === id(123) ? 1 : 0, transfer_pair_count: t.id === id(121) ? 1 : 0 }));
    transactions.push({ id: id(122), user_id: owner, import_id: id(30), source_row_id: id(322), transaction_date: '2026-04-06', decision_version: 1, signed_amount_pence: 500, currency: 'GBP', classification: 'Transfer', account_id: id(3), account_type: 'bank', import_status: 'review', recognized_record_id: null, active_transfer_id: id(900), active_refund_id: null, record_count: 0, allocation_count: 0, transfer_pair_count: 1, original_link_count: 0, refund_link_count: 0 });
    return { schema_version: 'source-import-reversal-context/1', owner_id: owner, import_id: root, import_status: 'review', financial_stamp: g.stamp,
        counts: { target_transactions: 4, transactions: transactions.length, effects: effects.length, transfers: 1, allocations: 1, invoices: 1, assignments: 0, duplicates: 0 }, transactions, effects,
        transfer_pairs: [{ id: id(900), user_id: owner, outgoing_transaction_id: id(121), incoming_transaction_id: id(122), amount_pence: 500, kind: 'transfer' }],
        allocations: [{ id: id(901), user_id: owner, invoice_id: id(800), transaction_id: id(123), amount_pence: 1000, assignment_count: 0 }],
        invoices: [{ id: id(800), user_id: owner, status: 'finalised', currency: 'GBP', invoice_pence: 1500, credited_pence: 900, entitlement_pence: 600, allocated_pence: 1500, returned_pence: 0, retained_cash_pence: 1500, outstanding_pence: 0, refund_due_pence: 900 }],
        blocking_assignments: [], duplicate_references: [], refund_graph: g };
}

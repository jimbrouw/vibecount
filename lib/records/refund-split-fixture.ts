/** Deliberately synthetic reference fixtures, used only by tests and the local demo. */
import type { RefundSplitCatalog, RefundSplitIntent, SplitRefundChoice } from './refund-splits';
import type { RefundClosureCatalog, RefundClosureLink, RefundClosureTransaction } from './refund-closure';
export const refundFixtureId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export function splitRefundFixture() {
    const id = refundFixtureId, owner = id(1);
    const original: SplitRefundChoice = {
        id: id(100), user_id: owner, account_id: id(2), import_id: id(10), source_row_id: id(200), recognized_record_id: id(300), record_transaction_id: id(100), project_id: id(500), category_valid: true, record_provenance_valid: true, category_label: 'Synthetic travel costs', project_label: 'Synthetic project',
        transaction_date: '2026-04-05', signed_amount_pence: -63029, currency: 'GBP', description: 'Synthetic reviewed repair', account_label: 'Synthetic bank', account_mask: '1234', account_type: 'bank',
        classification: 'Mixed', decision_version: 1, dedupe_status: 'clear', active_transfer_id: null, active_refund_id: null, has_refunds: false, import_status: 'review', record_status: 'approved', recognized_pence: 18909, invoice_allocated_pence: 0,
        business_use_bps: 3000, record_type: 'expense', effect_sign: 1, category_id: id(400), refunded_pence: 0, reduced_pence: 0, refund_count: 0, refund_stamp: 'a'.repeat(32),
    };
    const second: SplitRefundChoice = { ...original, id: id(101), import_id: id(11), source_row_id: id(201), recognized_record_id: id(301), record_transaction_id: id(101), project_id: id(501), category_id: id(401), transaction_date: '2026-04-07', signed_amount_pence: -50000, business_use_bps: 4500, recognized_pence: 22500, description: 'Synthetic mixed-use equipment' };
    const refund: SplitRefundChoice = { ...original, id: id(102), import_id: id(12), source_row_id: id(202), recognized_record_id: null, record_transaction_id: null, project_id: null, category_valid: false, transaction_date: '2026-04-10', signed_amount_pence: 50000,
        classification: 'Unknown', decision_version: 0, record_status: null, recognized_pence: 0, business_use_bps: 0, record_type: null, effect_sign: null, category_id: null, description: 'Synthetic combined supplier refund' };
    const catalog: RefundSplitCatalog = { owner_id: owner, stamp: 'f'.repeat(32), transactions: [original, second, refund] };
    const intent: RefundSplitIntent = { schema_version: 'refund-split-intent/1', refund_id: refund.id, refund_version: 0, expected_stamp: catalog.stamp,
        allocations: [{ original_id: original.id, original_version: 1, refund_stamp: original.refund_stamp, amount_pence: 30000 }, { original_id: second.id, original_version: 1, refund_stamp: second.refund_stamp, amount_pence: 20000 }], rationale: 'Synthetic exact source and eligibility review', request_id: id(700) };
    return { owner, original, second, refund, catalog, intent };
}
export function refundClosureFixture(income = false): RefundClosureCatalog {
    const id = refundFixtureId, owner = id(1);
    const transactions: RefundClosureTransaction[] = [
        ...[100, 101, 102, 103].map((n, i) => ({ id: id(n), user_id: owner, import_id: id(10 + i), source_row_id: id(200 + i), decision_version: 1, currency: 'GBP', signed_amount_pence: income ? 1000 : -1000, original_link_count: [1, 2, 2, 1][i], refund_link_count: 0 })),
        ...[110, 111, 112, 113].map((n, i) => ({ id: id(n), user_id: owner, import_id: id(20 + i), source_row_id: id(210 + i), decision_version: 1, currency: 'GBP', signed_amount_pence: (income ? -1 : 1) * [600, 400, 100, 100][i], original_link_count: 0, refund_link_count: [2, 2, 1, 1][i] })),
    ];
    const links: RefundClosureLink[] = [
        [100, 110, 300, 150, 5000], [101, 110, 300, 300, 10000], [101, 111, 100, 100, 10000], [102, 111, 300, 90, 3000], [102, 112, 100, 30, 3000], [103, 113, 100, 100, 10000],
    ].map(([o, r, cash, recognised, bps], i) => ({ id: id(600 + i), user_id: owner, original_transaction_id: id(o), refund_transaction_id: id(r), amount_pence: cash, recognized_pence: income ? cash : recognised, record_type: income ? 'income' : 'expense', business_use_bps: income ? 10000 : bps, category_id: id(400 + o), record_id: id(300 + i), assignment_count: 0 }));
    return { owner_id: owner, stamp: 'f'.repeat(32), transactions, links, assignments: [], imports: transactions.map(t => ({ id: t.import_id, user_id: owner, transaction_count: 1 })) };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { reconciliationExport } from './reconciliation-export';
import { readSourceCsv } from './source-csv';
import type { RefundExportLink, RefundExportReversal } from './refund-export';
const source = (id: string, cash: number) => ({ id, signed_amount_pence: cash, source_row_id: id + '-row', source_rows: { row_number: 2, row_hash: id + '-row-hash' }, record_imports: { file_hash: id + '-file-hash' }, financial_accounts: { label: 'Synthetic bank', masked_identifier: '1234' } });
const link = (id: string, amount: number): RefundExportLink => ({ id, original_transaction_id: 'original-' + id, refund_transaction_id: 'refund', amount_pence: amount, recognized_pence: amount, record_type: 'income', business_use_bps: 10000, author: 'owner', rationale: 'Reviewed synthetic portion', request_id: 'request-' + id, created_at: '2026-04-06', original_snapshot: { date: '2026-04-05' }, refund_snapshot: { date: '2026-04-06' }, original: source('original-' + id, 50000), refund: source('refund', -50000) });
const reversal = (id: string): RefundExportReversal => ({ id: 'reverse-' + id, refund_id: id, author: 'owner', rationale: 'Reviewed synthetic reversal', request_id: 'reverse-request', created_at: '2026-04-07' });
function rows(links: RefundExportLink[], reversals: RefundExportReversal[] = []) {
    const csv = readSourceCsv(reconciliationExport([], [], [], [], [], links, reversals).csv), header = csv.shift()!;
    return csv.map(row => Object.fromEntries(header.map((key, i) => [key, row[i]])));
}
test('versioned reconciliation separates observed cash once, portions and active portions across shared history', () => {
    const a = link('a', 30000), b = link('b', 20000), active = rows([b, a]);
    assert.ok(active.every(r => r.reconciliation_schema_version === 'vibecount.reconciliation/2'));
    assert.equal(active.reduce((n, r) => n + Number(r.refund_observed_signed_cash_once_pence), 0), -50000);
    assert.equal(active.reduce((n, r) => n + Number(r.refund_active_cash_portion_pence), 0), 50000);
    assert.ok(active.every(r => r.refund_observed_signed_cash_pence === '-50000'));
    assert.equal(active.find(r => r.refund_link_id === 'a')?.refund_observed_signed_cash_once_pence, '-50000');
    const history = rows([a, b], [reversal('a'), reversal('b')]);
    assert.equal(history.length, 4); assert.equal(history.reduce((n, r) => n + Number(r.refund_observed_signed_cash_once_pence), 0), -50000);
    assert.equal(history.reduce((n, r) => n + Number(r.refund_active_cash_portion_pence), 0), 0);
    assert.equal(history.reduce((n, r) => n + Number(r.recognized_effect_pence), 0), 0);
    assert.ok(history.every(r => r.refund_cash_portion_pence === r.amount_pence));
    // Later reviewed reallocation shares the original physical observation.
    const reallocated = rows([a, b, link('c', 50000)], [reversal('a'), reversal('b')]);
    assert.equal(reallocated.reduce((n, r) => n + Number(r.refund_observed_signed_cash_once_pence), 0), -50000);
    assert.equal(reallocated.reduce((n, r) => n + Number(r.refund_active_cash_portion_pence), 0), 50000);
});
test('reconciliation cash export rejects missing, duplicated, partial or inconsistent refund observation evidence', () => {
    const a = link('a', 30000), b = link('b', 20000);
    assert.throws(() => rows([a]), /Incomplete active/); assert.throws(() => rows([a, a]), /Duplicate/);
    assert.throws(() => rows([a, { ...b, refund: source('refund', -60000) }]), /Inconsistent/);
    assert.throws(() => rows([a, { ...b, refund: null }]), /evidence|observation/);
    assert.throws(() => rows([a, b], [reversal('b')]), /Incomplete active/);
});

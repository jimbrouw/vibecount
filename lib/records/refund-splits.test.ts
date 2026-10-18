import assert from 'node:assert/strict';
import test from 'node:test';
import { refundSplitReview, validateRefundSplitIntent } from './refund-splits';
import { refundReview } from './refunds';
import { splitRefundFixture, refundFixtureId as id } from './refund-split-fixture';
import { canonicalJson } from '../tax/snapshot';

test('shared cash splits exactly across categories/projects and preserves original years with no financial action', () => {
    const f = splitRefundFixture(), old = canonicalJson(f.catalog), { result } = refundSplitReview(f.owner, f.intent, f.catalog);
    assert.equal(result.observed_cash_pence, 50000); assert.equal(result.allocated_cash_pence, 50000); assert.equal(result.recognized_reduction_pence, 18000);
    assert.equal(result.expense_reduction_pence, 18000); assert.equal(result.income_reduction_pence, 0); assert.equal(result.profit_delta_pence, 18000);
    assert.deepEqual(result.portions.map(p => [p.amount_pence, p.recognized_pence, p.category_id, p.project_id]), [[30000, 9000, id(400), id(500)], [20000, 9000, id(401), id(501)]]);
    assert.deepEqual(result.portions.map(p => p.original_date), ['2026-04-05', '2026-04-07']); assert.equal(result.refund_date, '2026-04-10');
    assert.equal(result.posting_count, 2); assert.equal(result.financial_action, 'preview_only'); assert.equal(canonicalJson(f.catalog), old);
});
test('single-original preview remains mathematically compatible and committed imports are supported', () => {
    const f = splitRefundFixture(); f.refund.signed_amount_pence = 10000; f.intent.allocations = [{ ...f.intent.allocations[0], amount_pence: 10000 }]; f.original.import_status = 'committed';
    const result = refundSplitReview(f.owner, f.intent, f.catalog).result, legacy = refundReview(f.original, f.refund);
    assert.equal(result.portions[0].recognized_pence, legacy.reduction); assert.equal(result.portions[0].remaining_original_pence, legacy.remainingGross);
});
test('cumulative final pennies can be zero per portion without losing cash provenance or creating a zero posting', () => {
    const f = splitRefundFixture();
    Object.assign(f.original, { signed_amount_pence: -2, business_use_bps: 5000, recognized_pence: 1, refunded_pence: 1, reduced_pence: 1, refund_count: 1, has_refunds: true });
    Object.assign(f.second, { signed_amount_pence: -2, business_use_bps: 10000, recognized_pence: 2, classification: 'Business' });
    f.refund.signed_amount_pence = 2; f.intent.allocations.forEach(a => a.amount_pence = 1);
    const { result } = refundSplitReview(f.owner, f.intent, f.catalog);
    assert.deepEqual(result.portions.map(p => [p.amount_pence, p.recognized_pence]), [[1, 0], [1, 1]]);
    assert.equal(result.observed_cash_pence, 2); assert.equal(result.posting_count, 1); assert.equal(result.zero_recognized_portion_count, 1); assert.equal(result.portions[0].remaining_original_pence, 0);
    f.original.reduced_pence = 0; assert.throws(() => refundSplitReview(f.owner, f.intent, f.catalog), /inconsistent/);
});
test('a prior ordinary interpretation is removed once for shared cash, not once per original', () => {
    const f = splitRefundFixture(); Object.assign(f.refund, { classification: 'Business', business_use_bps: 10000, record_status: 'approved', record_type: 'income', effect_sign: 1, recognized_pence: 50000, recognized_record_id: id(999), record_transaction_id: f.refund.id });
    const { result } = refundSplitReview(f.owner, f.intent, f.catalog);
    assert.equal(result.removed_ordinary_income_pence, 50000); assert.equal(result.income_delta_pence, -50000); assert.equal(result.expense_delta_pence, -18000); assert.equal(result.profit_delta_pence, -32000);
    assert.equal(result.removed_ordinary_expense_pence, 0); assert.equal(result.portions.length, 2);
});
test('customer refunds remain income reductions and identify allocated originals needing invoice correction', () => {
    const f = splitRefundFixture();
    for (const o of [f.original, f.second]) Object.assign(o, { signed_amount_pence: 50000, business_use_bps: 10000, classification: 'Business', recognized_pence: 50000, record_type: 'income', invoice_allocated_pence: 50000 });
    f.refund.signed_amount_pence = -50000;
    const { result } = refundSplitReview(f.owner, f.intent, f.catalog);
    assert.equal(result.income_reduction_pence, 50000); assert.equal(result.expense_reduction_pence, 0); assert.equal(result.profit_delta_pence, -50000); assert.ok(result.portions.every(p => p.needs_invoice_correction));
});
test('complete allocation, unique originals, strict integer bounds and exact payload fields are mandatory', () => {
    const f = splitRefundFixture();
    for (const amount of [0, -1, 0.1, '30000', null, NaN, Infinity, 1000000000000]) assert.throws(() => refundSplitReview(f.owner, { ...f.intent, allocations: [{ ...f.intent.allocations[0], amount_pence: amount }, f.intent.allocations[1]] }, f.catalog));
    assert.throws(() => refundSplitReview(f.owner, { ...f.intent, allocations: [f.intent.allocations[0]] }, f.catalog), /entire/);
    assert.throws(() => refundSplitReview(f.owner, { ...f.intent, allocations: [f.intent.allocations[0], f.intent.allocations[0]] }, f.catalog), /only once/);
    assert.throws(() => validateRefundSplitIntent({ ...f.intent, allocations: [] }));
    assert.throws(() => validateRefundSplitIntent({ ...f.intent, raw_bank_pdf: 'PRIVATE' }), /exact/);
    assert.throws(() => validateRefundSplitIntent({ ...f.intent, allocations: [{ ...f.intent.allocations[0], private_path: 'PRIVATE' }] }), /exact/);
    assert.throws(() => validateRefundSplitIntent({ ...f.intent, refund_version: null }));
    f.refund.signed_amount_pence = 0; assert.throws(() => refundSplitReview(f.owner, f.intent, f.catalog));
});
test('stale or foreign source snapshots, invalid eligibility, duplicate dependencies and over-capacity originals reject', () => {
    const f = splitRefundFixture();
    assert.throws(() => refundSplitReview(id(999), f.intent, f.catalog), /context changed/);
    assert.throws(() => refundSplitReview(f.owner, { ...f.intent, expected_stamp: '0'.repeat(32) }, f.catalog), /context changed/);
    assert.throws(() => refundSplitReview(f.owner, { ...f.intent, refund_version: 1 }, f.catalog), /version changed/);
    assert.throws(() => refundSplitReview(f.owner, { ...f.intent, allocations: [{ ...f.intent.allocations[0], original_version: 2 }, f.intent.allocations[1]] }, f.catalog), /group changed/);
    for (const patch of [{ user_id: id(998) }, { currency: 'EUR' }, { dedupe_status: 'needs_review' }, { import_status: 'discarded' }, { active_transfer_id: id(998) }, { active_refund_id: id(998) }, { category_valid: false }, { recognized_record_id: null }, { record_transaction_id: id(998) }, { record_status: 'excluded' }, { effect_sign: -1 }, { record_type: 'income' }, { business_use_bps: 10000 }, { refunded_pence: 63030 }, { reduced_pence: 1 }]) {
        const c = structuredClone(f.catalog); Object.assign(c.transactions[0], patch); assert.throws(() => refundSplitReview(f.owner, f.intent, c), JSON.stringify(patch));
    }
    for (const patch of [{ has_refunds: true }, { active_refund_id: id(998) }, { invoice_allocated_pence: 1 }, { recognized_pence: -1 }]) {
        const c = structuredClone(f.catalog); Object.assign(c.transactions[2], patch); assert.throws(() => refundSplitReview(f.owner, f.intent, c));
    }
    const c = structuredClone(f.catalog); c.transactions[0].refunded_pence = 60000; c.transactions[0].reduced_pence = 18000; c.transactions[0].refund_count = 1;
    assert.throws(() => refundSplitReview(f.owner, f.intent, c), /exceeds/);
});
test('stable input order, redacted rationale and allowlisted output keep raw source fields out of read-back', () => {
    const f = splitRefundFixture(); f.original.description = 'PRIVATE_SENTINEL'; Object.assign(f.original, { object_path: 'PRIVATE_SENTINEL', raw_row: ['PRIVATE_SENTINEL'] });
    f.intent.rationale = 'Review account 12345678 without carrying bank details';
    const a = refundSplitReview(f.owner, f.intent, f.catalog), b = refundSplitReview(f.owner, { ...f.intent, allocations: [...f.intent.allocations].reverse() }, { ...f.catalog, transactions: [...f.catalog.transactions].reverse() });
    assert.equal(canonicalJson(a), canonicalJson(b)); assert.ok(!canonicalJson(a).includes('12345678')); assert.ok(!canonicalJson(a).includes('PRIVATE_SENTINEL'));
    const old = canonicalJson(a); f.original.project_id = id(999); assert.equal(canonicalJson(a), old);
});

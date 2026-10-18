import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceImportReversalReview } from './import-reversal';
import { importReversalFixture } from './import-reversal-fixture';
import { refundFixtureId as id } from './refund-split-fixture';
test('complete import preview excludes shared effects once and retains unrelated originals and credited invoice economics', () => {
    const c = importReversalFixture(), r = sourceImportReversalReview(c.owner_id, c);
    assert.equal(r.target_sources.length, 4); assert.equal(r.reset_ids.length, 7); assert.equal(r.retained_original_sources.length, 3);
    assert.equal(r.refund_closure.observed_refund_cash_pence, 1100); assert.equal(r.transfer_cash_pence, 500);
    assert.equal(r.income_delta_pence, -1000); assert.equal(r.expense_delta_pence, -330); assert.equal(r.profit_delta_pence, -670);
    assert.equal(r.invoices[0].released_allocation_pence, 1000); assert.equal(r.invoices[0].outstanding_after_pence, 100); assert.equal(r.invoices[0].refund_due_after_pence, 0); assert.equal(r.invoices[0].retained_after_pence, 500);
    assert.equal(r.financial_action, 'preview_only'); assert.equal(r.restored_prior_classifications, 0);
    const before = JSON.stringify(r); Object.assign(c.transactions[0], { description: 'PRIVATE', object_path: 'PRIVATE' }); c.effects[0].amount_pence = 999; assert.equal(JSON.stringify(r), before); assert.ok(!before.includes('PRIVATE'));
});
test('missing, foreign, duplicated, inconsistent or overlapping sources withhold the entire import preview', () => {
    const mutations = [
        (c: ReturnType<typeof importReversalFixture>) => { c.transactions.pop(); },
        (c: ReturnType<typeof importReversalFixture>) => { c.effects.pop(); },
        (c: ReturnType<typeof importReversalFixture>) => { c.effects[0].user_id = id(999); },
        (c: ReturnType<typeof importReversalFixture>) => { c.effects[0].bank_transaction_id = null; },
        (c: ReturnType<typeof importReversalFixture>) => { c.transactions[0].record_count++; },
        (c: ReturnType<typeof importReversalFixture>) => { c.transactions[0].recognized_record_id = id(999); },
        (c: ReturnType<typeof importReversalFixture>) => { c.transfer_pairs[0].amount_pence = 499; },
        (c: ReturnType<typeof importReversalFixture>) => { c.transactions.find(t => t.id === id(122))!.allocation_count = 1; },
        (c: ReturnType<typeof importReversalFixture>) => { c.invoices[0].outstanding_pence = 1000; },
        (c: ReturnType<typeof importReversalFixture>) => { c.refund_graph.stamp = '0'.repeat(32); },
        (c: ReturnType<typeof importReversalFixture>) => { c.refund_graph.links.splice(1, 1); },
    ];
    for (const mutate of mutations) { const c = importReversalFixture(); mutate(c); assert.throws(() => sourceImportReversalReview(c.owner_id, c)); }
});
test('retained duplicate references block the full operation without dropping their history', () => {
    const c = importReversalFixture(); c.duplicate_references.push({ id: id(990), user_id: c.owner_id, transaction_id: id(991), retained_transaction_id: id(110) }); c.counts.duplicates++;
    const r = sourceImportReversalReview(c.owner_id, c); assert.equal(r.blocked, true); assert.deepEqual(r.blocking_duplicate_ids, [id(990)]);
});

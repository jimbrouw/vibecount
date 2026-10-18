import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceDependenciesFixture } from '../fx/dependency-fixture';
import { refundSplitCatalog, readRefundSplitCatalog } from './refund-split-store';
import { splitRefundFixture, refundFixtureId as id } from './refund-split-fixture';
import { validateRefundSplitIntent, refundSplitReview } from './refund-splits';

test('split catalog rebuilds detached safe metadata and rejects incomplete, foreign or malformed sources', () => {
    const f = splitRefundFixture();
    Object.assign(f.catalog, { raw_document: 'PRIVATE' });
    for (const t of f.catalog.transactions) Object.assign(t, { object_path: 'PRIVATE', reference: 'PRIVATE', description: 'PRIVATE', account_label: 'PRIVATE', account_mask: '12345678' });
    const result = refundSplitCatalog(f.catalog, f.owner, f.refund.id);
    assert.ok(!JSON.stringify(result).includes('PRIVATE')); assert.ok(!JSON.stringify(result).includes('12345678'));
    f.catalog.transactions[0].project_id = id(999); assert.notEqual(result.transactions[0].project_id, id(999));
    for (const raw of [{ ...f.catalog, owner_id: id(999) }, { ...f.catalog, stamp: 'bad' }, { ...f.catalog, transactions: [] }, { ...f.catalog, transactions: Array(10001).fill(f.original) }, { ...f.catalog, transactions: [...f.catalog.transactions, f.original] }]) assert.throws(() => refundSplitCatalog(raw, f.owner, f.refund.id));
    for (const patch of [{ user_id: id(999) }, { transaction_date: '2026-02-30' }, { signed_amount_pence: null }, { signed_amount_pence: 1.5 }, { decision_version: 2147483648 }, { effect_sign: 0 }, { record_provenance_valid: undefined }, { account_type: 'untrusted' }, { currency: 'EUR' }]) {
        const raw = structuredClone(f.catalog); Object.assign(raw.transactions[0], patch); assert.throws(() => refundSplitCatalog(raw, f.owner, f.refund.id));
    }
    const draft = splitRefundFixture(); draft.original.record_status = 'draft'; draft.original.category_label = 'Travel 12345678';
    const safeDraft = refundSplitCatalog(draft.catalog, draft.owner, draft.refund.id); assert.equal(safeDraft.transactions[0].record_status, 'draft'); assert.ok(!safeDraft.transactions[0].category_label?.includes('12345678'));
    assert.throws(() => validateRefundSplitIntent({ ...f.intent, refund_version: 2147483648 }));
    const bad = splitRefundFixture(); bad.original.record_provenance_valid = false; assert.throws(() => refundSplitReview(bad.owner, bad.intent, bad.catalog), /provenance/);
});
test('split catalog reads only owner-derived atomic RPC and withholds transport errors', async () => {
    const f = splitRefundFixture(), calls: unknown[] = [];
    const db = { rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { data: {schema_version:'refund-split-catalog/2',refund_id:f.refund.id,native_context:f.catalog,dependencies:sourceDependenciesFixture(f.owner,f.catalog.stamp,f.catalog.transactions)}, error: null }; } };
    assert.equal((await readRefundSplitCatalog(db as never, f.owner, f.refund.id)).owner_id, f.owner);
    assert.deepEqual(calls, [{ name: 'read_refund_split_catalog_v2', args: { p_refund: f.refund.id } }]);
    await assert.rejects(readRefundSplitCatalog({ rpc: async () => ({ data: f.catalog, error: { message: 'PRIVATE' } }) } as never, f.owner, f.refund.id), /Complete owned/);
    await assert.rejects(readRefundSplitCatalog(db as never, f.owner, 'bad')); assert.equal(calls.length, 1);
});

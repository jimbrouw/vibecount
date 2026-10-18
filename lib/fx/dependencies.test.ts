import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFxDependencies, requireDependencySources } from './dependencies';
import { sourceDependenciesFixture } from './dependency-fixture';
import { splitRefundFixture } from '../records/refund-split-fixture';
import { refundSplitReview } from '../records/refund-splits';
test('safe dependency projection preserves zero-cash relationships and rejects incomplete/foreign/oversized context', () => {
 const f = splitRefundFixture(), raw = sourceDependenciesFixture(f.owner, f.catalog.stamp, f.catalog.transactions, [f.original.id]);
 const safe = parseFxDependencies(f.owner, { ...raw, raw_document: 'PRIVATE' });
 assert.ok(!JSON.stringify(safe).includes('PRIVATE')); assert.equal(safe.fx_blockers[0].cash_pence, 0);
 assert.deepEqual(parseFxDependencies(f.owner, safe), safe); requireDependencySources(safe, f.catalog.transactions, f.catalog.stamp);
 for (const patch of [{ owner_id: f.refund.id }, { blocked: false }, { counts: { sources: 1, fx_blockers: 1 } }, { sources: raw.sources.slice(1) }, { sources: [...raw.sources, raw.sources[0]] }, { private: 'x'.repeat(2000000) }]) assert.throws(() => parseFxDependencies(f.owner, { ...raw, ...patch }));
 for (const patch of [{ user_id: f.refund.id }, { active_count: 0 }, { version: 2 }, { original_minor: 0 }, { receipt_id: f.refund.id }, { cash_currency: 'KWD' }]) assert.throws(() => parseFxDependencies(f.owner, { ...raw, fx_blockers: [{ ...raw.fx_blockers[0], ...patch }] }));
 assert.throws(() => requireDependencySources(safe, f.catalog.transactions.slice(1), f.catalog.stamp));
 assert.throws(() => requireDependencySources(safe, f.catalog.transactions, '0'.repeat(32)));
});
test('split calculation blocks selected FX endpoints while preserving native bytes for unrelated candidates', () => {
 const f = splitRefundFixture(), expected = refundSplitReview(f.owner, f.intent, f.catalog);
 for (const selected of [f.original.id, f.second.id, f.refund.id]) {
  const context = parseFxDependencies(f.owner, sourceDependenciesFixture(f.owner, f.catalog.stamp, f.catalog.transactions, [selected]));
  assert.throws(() => refundSplitReview(f.owner, f.intent, { ...f.catalog, fx_dependencies: context }), /linked FX/);
 }
 const extra = { ...f.original, id: '00000000-0000-4000-8000-000000000999', source_row_id: '00000000-0000-4000-8000-000000000998' };
 const catalog = { ...f.catalog, transactions: [...f.catalog.transactions, extra] };
 const context = parseFxDependencies(f.owner, sourceDependenciesFixture(f.owner, catalog.stamp, catalog.transactions, [extra.id]));
 assert.deepEqual(refundSplitReview(f.owner, f.intent, { ...catalog, fx_dependencies: context }), expected);
});

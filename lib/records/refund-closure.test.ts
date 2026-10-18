import assert from 'node:assert/strict';
import test from 'node:test';
import { refundReversalClosure } from './refund-closure';
import { refundClosureFixture, refundFixtureId as id } from './refund-split-fixture';
import { canonicalJson } from '../tax/snapshot';

test('reversal follows transitive shared refunds, sibling originals and their other cash across imports', () => {
    const c = refundClosureFixture(), old = canonicalJson(c), r = refundReversalClosure(c.owner_id, { kind: 'original', id: id(100) }, c);
    assert.deepEqual(r.original_ids, [100, 101, 102].map(id)); assert.deepEqual(r.refund_ids, [110, 111, 112].map(id)); assert.deepEqual(r.link_ids, [600, 601, 602, 603, 604].map(id));
    assert.equal(r.observed_refund_cash_pence, 1100); assert.equal(r.expense_reduction_removed_pence, 670); assert.equal(r.income_reduction_removed_pence, 0); assert.equal(r.profit_delta_pence, -670);
    assert.equal(r.source_versions.length, 6); assert.equal(r.import_ids.length, 6); assert.equal(r.restored_prior_classifications, 0); assert.equal(r.financial_action, 'preview_only'); assert.equal(r.blocked, false);
    assert.equal(canonicalJson(c), old); assert.ok(!r.original_ids.includes(id(103))); assert.ok(!r.refund_ids.includes(id(113)));
});
test('root refund and source-import review resolve the same complete component and count shared cash once', () => {
    const c = refundClosureFixture(), root = refundReversalClosure(c.owner_id, { kind: 'original', id: id(100) }, c);
    for (const scope of [{ kind: 'refund' as const, id: id(111) }, { kind: 'import' as const, id: id(10) }, { kind: 'import' as const, id: id(21) }]) {
        const r = refundReversalClosure(c.owner_id, scope, c); assert.deepEqual(r.link_ids, root.link_ids); assert.equal(r.observed_refund_cash_pence, 1100); assert.equal(r.expense_delta_pence, 670);
    }
    assert.throws(() => refundReversalClosure(c.owner_id, { kind: 'original', id: id(110) }, c), /original payment/);
    assert.throws(() => refundReversalClosure(c.owner_id, { kind: 'refund', id: id(100) }, c), /refund cash/);
});
test('a sibling invoice assignment blocks the entire component while an unrelated one does not', () => {
    const c = refundClosureFixture(true);
    c.links[4].assignment_count = 1; c.assignments.push({ id: id(900), user_id: c.owner_id, refund_id: c.links[4].id, amount_pence: 50 });
    c.links[5].assignment_count = 1; c.assignments.push({ id: id(901), user_id: c.owner_id, refund_id: c.links[5].id, amount_pence: 50 });
    const r = refundReversalClosure(c.owner_id, { kind: 'original', id: id(100) }, c);
    assert.equal(r.blocked, true); assert.deepEqual(r.blocking_assignment_ids, [id(900)]); assert.equal(r.income_reduction_removed_pence, 1100); assert.equal(r.expense_reduction_removed_pence, 0);
    assert.equal(r.profit_delta_pence, 1100);
});
test('missing sibling edges, counts, source endpoints, effect provenance and assigned dependencies fail closed', () => {
    const owner = id(1), scope = { kind: 'original' as const, id: id(100) };
    for (const change of [
        (c: ReturnType<typeof refundClosureFixture>) => { c.links.splice(1, 1); },
        (c: ReturnType<typeof refundClosureFixture>) => { c.transactions.splice(1, 1); },
        (c: ReturnType<typeof refundClosureFixture>) => { c.transactions[1].original_link_count = 1; },
        (c: ReturnType<typeof refundClosureFixture>) => { c.links[0].record_id = null; },
        (c: ReturnType<typeof refundClosureFixture>) => { c.links[0].recognized_pence = 151; },
        (c: ReturnType<typeof refundClosureFixture>) => { c.links[0].amount_pence = 301; },
        (c: ReturnType<typeof refundClosureFixture>) => { c.links[0].assignment_count = 1; },
        (c: ReturnType<typeof refundClosureFixture>) => { c.links[1].record_id = c.links[0].record_id; },
        (c: ReturnType<typeof refundClosureFixture>) => { c.links[0].category_id = id(999); c.links[0].business_use_bps = 3000; },
    ]) { const c = refundClosureFixture(); change(c); assert.throws(() => refundReversalClosure(owner, scope, c)); }
});
test('unknown source/import identities, foreign rows, unsafe counts and wrong signs cannot form a review', () => {
    const c = refundClosureFixture(), scope = { kind: 'original' as const, id: id(100) };
    assert.throws(() => refundReversalClosure(id(99), scope, c));
    assert.throws(() => refundReversalClosure(c.owner_id, { kind: 'original', id: id(999) }, c));
    assert.throws(() => refundReversalClosure(c.owner_id, { kind: 'import', id: id(999) }, c));
    for (const key of ['transactions', 'links', 'imports'] as const) { const x = structuredClone(c); x[key][0].user_id = id(999); assert.throws(() => refundReversalClosure(c.owner_id, scope, x)); }
    const missing = structuredClone(c); missing.imports[0].transaction_count = 2;
    assert.throws(() => refundReversalClosure(c.owner_id, { kind: 'import', id: id(10) }, missing), /root-import/);
    const wrong = structuredClone(c); wrong.transactions[4].signed_amount_pence = -600; assert.throws(() => refundReversalClosure(c.owner_id, scope, wrong));
    const unsafe = structuredClone(c); unsafe.transactions[0].original_link_count = 1.5; assert.throws(() => refundReversalClosure(c.owner_id, scope, unsafe));
    const duplicated = structuredClone(c); duplicated.links.push(duplicated.links[0]); assert.throws(() => refundReversalClosure(c.owner_id, scope, duplicated));
});
test('removed relationships do not restore an older decision and unrelated observations remain outside closure', () => {
    const c = refundClosureFixture(); c.links = c.links.filter(l => l.refund_transaction_id !== id(110));
    c.transactions.find(t => t.id === id(100))!.original_link_count = 0; c.transactions.find(t => t.id === id(101))!.original_link_count = 1; c.transactions.find(t => t.id === id(110))!.refund_link_count = 0;
    const r = refundReversalClosure(c.owner_id, { kind: 'original', id: id(100) }, c);
    assert.deepEqual(r.link_ids, []); assert.equal(r.observed_refund_cash_pence, 0); assert.equal(r.restored_prior_classifications, 0);
});
test('zero-recognised portions retain graph cash and can connect the complete rounding-safe component', () => {
    const c = refundClosureFixture();
    c.transactions = c.transactions.filter(t => [id(100), id(101), id(110)].includes(t.id));
    Object.assign(c.transactions[0], { signed_amount_pence: -2, original_link_count: 1 }); Object.assign(c.transactions[1], { signed_amount_pence: -2, original_link_count: 1 }); Object.assign(c.transactions[2], { signed_amount_pence: 2, refund_link_count: 2 });
    c.links = c.links.slice(0, 2); Object.assign(c.links[0], { amount_pence: 1, recognized_pence: 0, business_use_bps: 3000, record_id: null }); Object.assign(c.links[1], { amount_pence: 1, recognized_pence: 1 });
    const r = refundReversalClosure(c.owner_id, { kind: 'original', id: id(100) }, c);
    assert.equal(r.observed_refund_cash_pence, 2); assert.equal(r.expense_reduction_removed_pence, 1); assert.equal(r.link_ids.length, 2); assert.equal(r.original_ids.length, 2);
});
test('closure is independent of input order, returns detached safe fields and retains selected source versions', () => {
    const c = refundClosureFixture(), scope = { kind: 'original' as const, id: id(100) }, a = refundReversalClosure(c.owner_id, scope, c);
    Object.assign(c.transactions[0], { raw_bank_pdf: 'PRIVATE', description: 'PRIVATE' }); Object.assign(c.links[0], { object_path: 'PRIVATE' });
    const b = refundReversalClosure(c.owner_id, scope, { ...c, transactions: [...c.transactions].reverse(), links: [...c.links].reverse(), imports: [...c.imports].reverse() });
    assert.equal(canonicalJson(a), canonicalJson(b)); assert.ok(!canonicalJson(b).includes('PRIVATE'));
    const before = canonicalJson(a); c.transactions[0].decision_version++; assert.equal(canonicalJson(a), before);
    assert.notEqual(canonicalJson(refundReversalClosure(c.owner_id, scope, c)), before);
});

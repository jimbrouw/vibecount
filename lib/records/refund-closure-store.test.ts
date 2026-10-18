import assert from 'node:assert/strict';
import test from 'node:test';
import { readRefundReversalClosure } from './refund-closure-store';
import { refundClosureFixture, refundFixtureId as id } from './refund-split-fixture';

test('refund closure reader uses the authenticated RPC and rejects failed, foreign or incomplete graphs', async () => {
    const graph = refundClosureFixture(), calls: unknown[] = [], scope = { kind: 'original' as const, id: id(100) };
    let data: unknown = graph, error: unknown = null;
    const db = { async rpc(name: string, args: unknown) { calls.push({ name, args }); return { data, error }; } } as unknown as Parameters<typeof readRefundReversalClosure>[0];
    const result = await readRefundReversalClosure(db, graph.owner_id, scope);
    assert.deepEqual(calls, [{ name: 'read_refund_reversal_graph', args: { p_kind: 'original', p_id: id(100) } }]);
    assert.equal(result.observed_refund_cash_pence, 1100); assert.equal(result.link_ids.length, 5);
    error = {}; await assert.rejects(readRefundReversalClosure(db, graph.owner_id, scope), /unavailable/); error = null;
    data = null; await assert.rejects(readRefundReversalClosure(db, graph.owner_id, scope), /unavailable/);
    data = { ...graph, owner_id: id(999) }; await assert.rejects(readRefundReversalClosure(db, graph.owner_id, scope), /unavailable/);
    data = { ...graph, links: graph.links.slice(1) }; await assert.rejects(readRefundReversalClosure(db, graph.owner_id, scope), /Complete connected|completely allocated|rounding/);
});

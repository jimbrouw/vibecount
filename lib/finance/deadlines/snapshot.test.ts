import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyFinancePlan } from '../defaults';
import { prepareFinancePlan, prepareCurrentFinancePlan } from '../snapshot';
import type { PlanRevision } from '../server';
import { canonicalJson, sha256 } from '../../tax/snapshot';
import { deadlineCatalogFromPlan, prepareDeadlineSnapshot, verifyDeadlineSnapshot, currentDeadlineReview, type SavedDeadlineSnapshot } from './snapshot';
import { syntheticCoverage, syntheticExternal } from '../../invoices/currency-coverage-fixture';
import { emptyDeadlinePlan } from './model';

const owner = '10000000-0000-4000-8000-000000000001', other = '20000000-0000-4000-8000-000000000002';
const doc = { id: '30000000-0000-4000-8000-000000000003', user_id: owner, file_sha256: 'd'.repeat(64) };
function finance(ordinal = 1): PlanRevision & { result: ReturnType<typeof prepareFinancePlan>['result'] } {
    const p = emptyFinancePlan('2026-10-17');
    p.obligations.push({ id: 'demand', label: 'Synthetic remaining HMRC commitment', kind: 'tax', tax_year_start: 2025, due_date: '2027-01-31', amount_pence: 150000 },
        { id: 'other-year', label: 'Current-year instalment', kind: 'tax', tax_year_start: 2026, due_date: '2027-07-31', amount_pence: 50000 },
        { id: 'unassigned', label: 'Resolve year first', kind: 'tax', tax_year_start: null, due_date: '2027-01-31', amount_pence: null },
        { id: 'supplier', label: 'Supplier is not tax', kind: 'other', tax_year_start: null, due_date: '2027-01-31', amount_pence: 8000 });
    const f = prepareFinancePlan(owner, p, '2026-10-17', { accounts: [], documents: [] });
    return { id: `40000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`, user_id: owner, ordinal, expected_ordinal: ordinal - 1, request_id: doc.id,
        context_stamp: 'a'.repeat(32), rationale: 'Synthetic reviewed commitment; no real payment', author: owner, created_at: '2026-10-17T12:00:00Z',
        input: f.input, result: f.result, input_canonical_json: f.inputJson, result_canonical_json: f.resultJson, rules_canonical_json: f.rulesJson,
        input_sha256: f.inputHash, result_sha256: f.resultHash, rules_sha256: f.rulesHash };
}
function fixture() {
    const revision = finance(), c = deadlineCatalogFromPlan(owner, 2025, revision, [doc]), p = emptyDeadlinePlan(2025, c);
    Object.assign(p.entries.find(e => e.id === 'calendar:online')!, { applicability: 'applies', date_basis: 'notice', notice_due_date: '2027-02-15', notice_document_id: doc.id });
    Object.assign(p.entries.find(e => e.id === 'commitment:demand')!, { applicability: 'applies', date_basis: 'saved_obligation' });
    const f = prepareDeadlineSnapshot(owner, p, '2027-01-31', c);
    const row: SavedDeadlineSnapshot = { input: f.input, result: f.result, input_canonical_json: f.inputJson, result_canonical_json: f.resultJson, rules_canonical_json: f.rulesJson, input_sha256: f.inputHash, result_sha256: f.resultHash, rules_sha256: f.rulesHash };
    return { c, row, revision, p };
}
test('deadline sources come from verified year-specific unpaid commitments, never forecasts, cash or supplier costs', () => {
    const { c, row } = fixture();
    assert.equal(c.obligations.length, 1); assert.equal(c.obligations[0].id, 'demand'); assert.equal(c.obligations[0].amount_pence, 150000);
    assert.equal(c.unassigned_tax_obligations, 1); assert.equal(c.finance_plan!.ordinal, 1);
    const verified = verifyDeadlineSnapshot(row, owner, c);
    assert.equal(verified.result.items.filter(i => i.amount_pence !== null).length, 1);
    const text = JSON.stringify(verified);
    for (const forbidden of ['monthly_pension', 'assets', 'accounts', 'object_path', 'unassigned"', 'supplier"', 'other-year"']) assert.ok(!text.includes(forbidden), forbidden);
    assert.equal(verified.input.sources.documents.length, 1); assert.equal(verified.input.sources.documents[0].file_sha256, doc.file_sha256);
    assert.throws(() => deadlineCatalogFromPlan(other, 2025, finance(), []));
    const bad = finance(); bad.result.forecast.annual_tax_pence = 0;
    assert.throws(() => deadlineCatalogFromPlan(owner, 2025, bad, []));
});
test('frozen deadline bytes and rules replay exactly and decoded results are detached', () => {
    const { c, row } = fixture(), old = JSON.stringify(row);
    const verified = verifyDeadlineSnapshot(row, owner, c);
    verified.input.plan.entries[0].applicability = 'not_applicable'; verified.result.active_count = 999;
    assert.equal(JSON.stringify(row), old);
    const fresh = verifyDeadlineSnapshot(row, owner, c);
    assert.notEqual(fresh.result.active_count, 999);
    assert.equal(sha256(canonicalJson(fresh.input)), row.input_sha256);
    assert.equal(sha256(canonicalJson(fresh.result)), row.result_sha256);
    assert.deepEqual(prepareDeadlineSnapshot(owner, { ...row.input.plan, entries: [...row.input.plan.entries].reverse() }, '2027-01-31', c).inputJson, row.input_canonical_json);
});
test('authoritative retained source comparison rejects self-consistent rehashed source/amount forgery', () => {
    const { c, row } = fixture(), forged = structuredClone(row);
    forged.input.sources.obligations[0].amount_pence = 1;
    const altered = prepareDeadlineSnapshot(owner, forged.input.plan, forged.input.evaluated_on, forged.input.sources);
    Object.assign(forged, { input: altered.input, result: altered.result, input_canonical_json: altered.inputJson, result_canonical_json: altered.resultJson, input_sha256: altered.inputHash, result_sha256: altered.resultHash });
    assert.throws(() => verifyDeadlineSnapshot(forged, owner, c), /sources or replay/);
    const result = structuredClone(row); result.result.items[0].phase = 'acknowledged'; result.result_canonical_json = canonicalJson(result.result); result.result_sha256 = sha256(result.result_canonical_json);
    assert.throws(() => verifyDeadlineSnapshot(result, owner, c));
    const version = structuredClone(row); version.rules_canonical_json = canonicalJson({ engine_version: 'future/2' }); version.rules_sha256 = sha256(version.rules_canonical_json);
    assert.throws(() => verifyDeadlineSnapshot(version, owner, c));
});
test('later cash revision or changed notice hash suppresses current reminders while historical export remains exact', () => {
    const { c, row } = fixture(), live = deadlineCatalogFromPlan(owner, 2025, finance(2), [doc]);
    const r = currentDeadlineReview(row, owner, c, live, '2027-02-01');
    assert.equal(r.stale, true); assert.equal(r.active_count, 0); assert.equal(r.result, null);
    assert.equal(canonicalJson(r.historical.result), row.result_canonical_json);
    assert.equal(currentDeadlineReview(row, owner, c, { ...c, documents: [{ ...doc, file_sha256: 'e'.repeat(64) }] }, '2027-02-01').stale, true);
    assert.equal(currentDeadlineReview(row, owner, c, { ...c, documents: [] }, '2027-02-01').stale, true);
    assert.throws(() => verifyDeadlineSnapshot(row, owner, live)); // Historical verifier must use the referenced source revision.
    const extra = { ...doc, id: '50000000-0000-4000-8000-000000000005' };
    assert.equal(currentDeadlineReview(row, owner, c, { ...c, documents: [extra, doc] }, '2027-02-01').stale, false);
});
test('current day reevaluates phases without rewriting history or restoring an acknowledged reminder', () => {
    const { c, row, p } = fixture();
    const r = currentDeadlineReview(row, owner, c, c, '2027-02-01');
    assert.equal(r.stale, false); assert.equal(r.result!.items.find(i => i.id === 'commitment:demand')!.phase, 'past_due');
    assert.equal(r.historical.result.items.find(i => i.id === 'commitment:demand')!.phase, 'due_today');
    const expired = currentDeadlineReview(row, owner, c, c, '2027-04-06');
    assert.equal(expired.result!.active_count, 0); assert.equal(expired.result!.items.find(i => i.id === 'commitment:demand')!.phase, 'rules_stale');
    Object.assign(p.entries.find(e => e.id === 'commitment:demand')!, { disposition: 'acknowledged' });
    const f = prepareDeadlineSnapshot(owner, p, '2027-01-31', c);
    const ack = { ...row, input: f.input, result: f.result, input_canonical_json: f.inputJson, result_canonical_json: f.resultJson, input_sha256: f.inputHash, result_sha256: f.resultHash };
    assert.equal(currentDeadlineReview(ack, owner, c, c, '2027-02-01').result!.items.find(i => i.id === 'commitment:demand')!.phase, 'acknowledged');
});
test('a no-source calendar remains explicit and selected evidence closure rejects added private data', () => {
    const c = deadlineCatalogFromPlan(owner, 2025, null, [doc]), p = emptyDeadlinePlan(2025, c);
    const f = prepareDeadlineSnapshot(owner, p, '2026-10-17', c);
    assert.deepEqual(f.input.sources.documents, []); assert.equal(f.input.sources.finance_plan, null);
    const row: SavedDeadlineSnapshot = { input: f.input, result: f.result, input_canonical_json: f.inputJson, result_canonical_json: f.resultJson, rules_canonical_json: f.rulesJson, input_sha256: f.inputHash, result_sha256: f.resultHash, rules_sha256: f.rulesHash };
    assert.equal(currentDeadlineReview(row, owner, c, deadlineCatalogFromPlan(owner, 2025, finance(), []), '2026-10-17').stale, true);
    const unsafeCatalog: unknown = { ...c, documents: [{ ...doc, private_path: 'SECRET' }] };
    assert.throws(() => prepareDeadlineSnapshot(owner, p, '2026-10-17', unsafeCatalog as typeof c));
    const mutated = structuredClone(row); (mutated.input as unknown as Record<string, unknown>).raw = 'PRIVATE'; mutated.input_canonical_json = canonicalJson(mutated.input); mutated.input_sha256 = sha256(mutated.input_canonical_json);
    assert.throws(() => verifyDeadlineSnapshot(mutated, owner, c));
});


test('current finance coverage withholding never turns scenario forecasts into deadline obligations', () => {
    const old = finance(), p = prepareCurrentFinancePlan(owner, old.input.plan, old.input.evaluated_on, old.input.sources, syntheticCoverage(owner, [syntheticExternal()]));
    const current: PlanRevision = { ...old, input: p.input, result: p.result, input_canonical_json: p.inputJson, result_canonical_json: p.resultJson, input_sha256: p.inputHash, result_sha256: p.resultHash };
    const before = deadlineCatalogFromPlan(owner, 2025, old, [doc]), after = deadlineCatalogFromPlan(owner, 2025, current, [doc]);
    assert.deepEqual(after.obligations, before.obligations); assert.equal(after.unassigned_tax_obligations, before.unassigned_tax_obligations);
    assert.equal(after.obligations.length, 1); assert.equal(after.obligations[0].amount_pence, 150000);
    assert.equal(p.result.status, 'incomplete'); assert.equal(p.result.additional_drawings_ceiling_pence, null);
});

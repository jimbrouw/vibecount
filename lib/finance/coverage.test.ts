import assert from 'node:assert/strict';
import test from 'node:test';
import { syntheticCoverage, syntheticExternal } from '../invoices/currency-coverage-fixture';
import { canonicalJson, sha256 } from '../tax/snapshot';
import { financeFixture } from './test-fixture';
import { prepareFinancePlan, prepareCurrentFinancePlan, verifyFinancePlan, type SavedFinancePlan } from './snapshot';
import { evaluateCoveredFinancePlan } from './coverage';
const today = '2026-10-17', catalog = { accounts: [], documents: [] };
const save = <I extends SavedFinancePlan['input'], R extends SavedFinancePlan['result']>(p: { input: I; result: R; inputJson: string; resultJson: string; rulesJson: string; inputHash: string; resultHash: string; rulesHash: string }): SavedFinancePlan<I, R> => ({ input: p.input, result: p.result, input_canonical_json: p.inputJson, result_canonical_json: p.resultJson, rules_canonical_json: p.rulesJson, input_sha256: p.inputHash, result_sha256: p.resultHash, rules_sha256: p.rulesHash });

test('current coverage wrapper retains exact manual GBP scenario and historical rules/date replay', () => {
  const plan = financeFixture(today), legacy = prepareFinancePlan('owner', plan, today, catalog), current = prepareCurrentFinancePlan('owner', plan, today, catalog, syntheticCoverage());
  assert.deepEqual(current.result.scenario, legacy.result); assert.equal(current.rulesJson, legacy.rulesJson);
  assert.equal(current.input.schema_version, 'finance-plan-input/2'); assert.equal(current.result.schema_version, 'finance-plan-result/2');
  assert.equal(current.result.scenario.actual_cash_pence, 3000000); assert.equal(current.result.scenario.pension_assets_pence, 4305500);
  assert.equal(current.result.additional_drawings_ceiling_pence, legacy.result.additional_drawings_ceiling_pence);
  assert.deepEqual(verifyFinancePlan(save(legacy), 'owner').result, legacy.result);
  assert.deepEqual(verifyFinancePlan(save(current), 'owner').result, current.result);
  plan.cash_complete = false;
  const incomplete = evaluateCoveredFinancePlan('owner', plan, today, syntheticCoverage());
  assert.equal(incomplete.status, 'incomplete'); assert.equal(incomplete.current_free_cash_pence, null); assert.equal(incomplete.additional_drawings_ceiling_pence, null);
});
test('external GBP, foreign and invalid representations withhold conditional drawings without converting original units', () => {
  const plan = financeFixture(today), original = prepareFinancePlan('owner', plan, today, catalog);
  for (const currency of ['GBP', 'USD', 'JPY', 'KWD']) {
    const current = prepareCurrentFinancePlan('owner', plan, today, catalog, syntheticCoverage('owner', [syntheticExternal(currency)]));
    assert.equal(current.result.status, 'incomplete'); assert.equal(current.result.additional_drawings_ceiling_pence, null); assert.equal(current.result.current_free_cash_pence, null);
    assert.deepEqual(current.result.scenario, original.result); assert.equal(current.rulesJson, original.rulesJson);
    assert.ok(current.result.scenario.additional_drawings_ceiling_pence! > 0); assert.ok(current.result.issues.some(i => i.code === 'invoice_currency_coverage'));
  }
  const invalid = { ...syntheticExternal(), origin: 'native_gbp', currency: 'GBP', amount: '12.00', original_total_minor: '0', representation: 'invalid' as const };
  assert.equal(evaluateCoveredFinancePlan('owner', plan, today, syntheticCoverage('owner', [invalid])).additional_drawings_ceiling_pence, null);
});
test('new snapshots freeze owned coverage and reject missing, private or inconsistent metadata', () => {
  const plan = financeFixture(today), coverage = syntheticCoverage('owner', [syntheticExternal()]);
  const current = prepareCurrentFinancePlan('owner', plan, today, catalog, coverage), frozen = canonicalJson(current.input);
  coverage.invoices[0].original_total_minor = '5'; coverage.stamp = 'f'.repeat(64);
  assert.equal(canonicalJson(current.input), frozen);
  for (const value of [undefined, {}, { ...syntheticCoverage(), owner_id: 'other' }, { ...syntheticCoverage(), invoice_count: 1 }, { ...syntheticCoverage(), object_path: 'PRIVATE' }])
    assert.throws(() => prepareCurrentFinancePlan('owner', plan, today, catalog, value as typeof coverage));
});
test('rehashed scenario, eligibility and coverage forgeries cannot change retained current review meaning', () => {
  const p = prepareCurrentFinancePlan('owner', financeFixture(today), today, catalog, syntheticCoverage('owner', [syntheticExternal()]));
  type Row = SavedFinancePlan<typeof p.input, typeof p.result>;
  for (const mutate of [
    (r: Row) => { r.result.additional_drawings_ceiling_pence = 1; },
    (r: Row) => { r.result.scenario.actual_cash_pence = 99999999; },
    (r: Row) => { r.result.invoice_coverage_stamp = 'f'.repeat(64); },
  ]) {
    const row = structuredClone(save(p)); mutate(row); row.result_canonical_json = canonicalJson(row.result); row.result_sha256 = sha256(row.result_canonical_json);
    assert.throws(() => verifyFinancePlan(row, 'owner'), /replay/);
  }
});

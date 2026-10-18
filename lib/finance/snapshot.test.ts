import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson, sha256 } from '../tax/snapshot.ts';
import { prepareFinancePlan, verifyFinancePlan, type PlanningCatalog, type LegacySavedFinancePlan } from './snapshot.ts';
import type { Plan } from './plan.ts';
function fixture() {
    const plan: Plan = { schema_version: 'finance-plan/1', as_of: '2026-10-17',
        assets: [{ id: 'cash', label: 'Synthetic balance', kind: 'cash', balance_pence: 1000000, account_id: 'bank', document_id: 'evidence' }],
        earmarks: [], obligations: [], cash_complete: true, unique_assets_checked: true, commitments_complete: true, cashflow_assumptions_checked: true,
        forecast: { tax_year_start: 2026, jurisdiction: 'england_wales_ni', annual_turnover_pence: 4000000, monthly_costs_pence: 40000,
            monthly_pension_pence: 0, pension_basis: 'none', pension_eligibility_checked: false, supported_tax_scope_checked: true,
            class2_election: 'unknown', tax_paid_pence: 0, tax_payments_checked: true, monthly_drawings_pence: 100000,
            billable_days_per_year: null, daily_rate_pence: null } };
    const catalog: PlanningCatalog = {
        accounts: [{ id: 'bank', user_id: 'owner', provider: 'starling', account_type: 'bank', currency: 'GBP', label: 'Synthetic bank', masked_identifier: '1234' }],
        documents: [{ id: 'evidence', user_id: 'owner', file_sha256: 'a'.repeat(64), media_type: 'application/pdf', size_bytes: 100 }],
    };
    return { plan, catalog };
}
function saved(): LegacySavedFinancePlan {
    const { plan, catalog } = fixture(), p = prepareFinancePlan('owner', plan, plan.as_of, catalog);
    return { input: p.input, result: p.result, input_canonical_json: p.inputJson, result_canonical_json: p.resultJson, rules_canonical_json: p.rulesJson,
        input_sha256: p.inputHash, result_sha256: p.resultHash, rules_sha256: p.rulesHash };
}
test('cash-plan snapshot freezes safe source provenance and replays using its retained date', () => {
    const { plan, catalog } = fixture();
    const enriched = { ...catalog, documents: [{ ...catalog.documents[0], object_path: 'private-path', raw_bank_account: 'secret' }] };
    const p = prepareFinancePlan('owner', plan, plan.as_of, enriched);
    assert.ok(!p.inputJson.includes('private-path'));
    assert.ok(!p.inputJson.includes('secret'));
    assert.equal(p.input.sources.documents[0].file_sha256, 'a'.repeat(64));
    const row = saved(), before = canonicalJson(row);
    const exportValue = verifyFinancePlan(row, 'owner');
    assert.equal(exportValue.result.status, 'estimate');
    assert.equal(exportValue.input.evaluated_on, '2026-10-17');
    assert.match(exportValue.document_status, /Draft.*not submitted/);
    catalog.accounts[0].label = 'Changed'; plan.assets[0].balance_pence = 0;
    assert.equal(canonicalJson(row), before);
    row.result.actual_cash_pence = 0;
    assert.equal(exportValue.result.actual_cash_pence, 1000000);
});
test('linked balances require owner provenance and correct account semantics, not credit limits or pension cash', () => {
    for (const mutate of [
        (c: PlanningCatalog) => { c.accounts[0].user_id = 'foreign'; },
        (c: PlanningCatalog) => { c.documents[0].user_id = 'foreign'; },
        (c: PlanningCatalog) => { c.accounts[0].account_type = 'credit_card'; },
        (c: PlanningCatalog) => { c.accounts[0].currency = 'EUR'; },
        (c: PlanningCatalog) => { c.accounts[0].masked_identifier = '12345678'; },
        (c: PlanningCatalog) => { c.accounts[0].label = Array<string>(6).fill('12345678').join(' '); },
        (c: PlanningCatalog) => { c.documents[0].file_sha256 = ''; },
    ]) {
        const { plan, catalog } = fixture(); mutate(catalog);
        assert.throws(() => prepareFinancePlan('owner', plan, plan.as_of, catalog));
    }
    const { plan, catalog } = fixture(); plan.assets[0].kind = 'pension';
    assert.throws(() => prepareFinancePlan('owner', plan, plan.as_of, catalog), /pension assets remain separate/);
    plan.assets[0].kind = 'liability'; catalog.accounts[0].account_type = 'credit_card';
    assert.equal(prepareFinancePlan('owner', plan, plan.as_of, catalog).result.liabilities_pence, 1000000);
});
test('snapshot integrity rejects owner swaps, altered outputs, substituted rules and recomputed hash forgeries', () => {
    assert.throws(() => verifyFinancePlan(saved(), 'foreign'), /integrity/);
    let row = saved(); row.result.actual_cash_pence = 99999999;
    assert.throws(() => verifyFinancePlan(row, 'owner'), /integrity/);
    row = saved(); row.result.actual_cash_pence = 99999999;
    row.result_canonical_json = canonicalJson(row.result); row.result_sha256 = sha256(row.result_canonical_json);
    assert.throws(() => verifyFinancePlan(row, 'owner'), /replay/);
    row = saved(); row.rules_canonical_json = canonicalJson({ id: 'forged' }); row.rules_sha256 = sha256(row.rules_canonical_json);
    assert.throws(() => verifyFinancePlan(row, 'owner'), /version/);
    row = saved(); row.input.sources.documents[0].user_id = 'foreign';
    row.input_canonical_json = canonicalJson(row.input); row.input_sha256 = sha256(row.input_canonical_json);
    assert.throws(() => verifyFinancePlan(row, 'owner'), /not owned/);
    row = saved(); row.input.evaluated_on = '2026-10-18'; row.input_canonical_json = canonicalJson(row.input); row.input_sha256 = sha256(row.input_canonical_json);
    assert.throws(() => verifyFinancePlan(row, 'owner'), /replay/);
});

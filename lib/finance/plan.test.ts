import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePlan, forecastAnnual, validatePlan, type Plan, type Forecast, type Asset } from './plan.ts';
import { rules2025 } from '../tax/rules.ts';
import { class4NI, incomeTaxBands } from '../tax/calculation.ts';
import { planningRules2026 } from './rules.ts';

// Synthetic handover scenarios; these are never production defaults or verified financial facts.
function forecast(): Forecast {
    return { tax_year_start: 2026, jurisdiction: 'england_wales_ni', annual_turnover_pence: 4000000, monthly_costs_pence: 40000,
        monthly_pension_pence: 46000, pension_basis: 'net_ras', pension_eligibility_checked: true, supported_tax_scope_checked: true,
        class2_election: 'no_voluntary_charge', tax_paid_pence: 0, tax_payments_checked: true, monthly_drawings_pence: 100000,
        billable_days_per_year: 100, daily_rate_pence: 40000 };
}
function asset(id: string, kind: Asset['kind'], amount: number | null): Asset {
    return { id, label: 'Synthetic ' + id, kind, balance_pence: amount, account_id: null, document_id: null };
}
function plan(): Plan {
    return { schema_version: 'finance-plan/1', as_of: '2026-10-17', assets: [asset('bank', 'cash', 3000000), asset('retirement', 'pension', 4305500)],
        earmarks: [
            { id: 'reserve', asset_id: 'bank', purpose: 'tax_reserve', tax_year_start: 2026, amount_pence: 592439 },
            { id: 'business', asset_id: 'bank', purpose: 'business_buffer', tax_year_start: null, amount_pence: 900000 },
            { id: 'emergency', asset_id: 'bank', purpose: 'emergency_buffer', tax_year_start: null, amount_pence: 680000 },
        ], obligations: [], cash_complete: true, unique_assets_checked: true, commitments_complete: true, cashflow_assumptions_checked: true, forecast: forecast() };
}
test('2026 planning goldens distinguish cash pension, gross relief, profit and NI in both jurisdictions', () => {
    const f = forecast();
    const r = forecastAnnual(f);
    assert.equal(r.status, 'estimate');
    assert.equal(r.profit_pence, 3520000);
    assert.equal(r.pension_cash_pence, 552000);
    assert.equal(r.pension_gross_pence, 690000);
    assert.equal(r.income_tax_pence, 452600); // (35,200 − 12,570) × 20%, no basic-rate deduction for RAS.
    assert.equal(r.class4_pence, 135780); // 22,630 × 6%, pension never reduces NI profits.
    assert.equal(r.annual_tax_pence, 588380);
    assert.equal(r.trace.filter(t => t.id.startsWith('income_tax_band_')).reduce((n, t) => n + t.pence!, 0), r.income_tax_pence);
    assert.equal(r.trace.find(t => t.id === 'remaining_tax')!.pence, r.remaining_tax_pence);
    assert.equal(r.class2_treatment, 'treated_paid_without_cash_charge');
    assert.equal(r.following_year_poa_each_pence, 294190);
    assert.equal(r.balancing_date, '2028-01-31');
    assert.equal(r.following_first_poa_date, '2028-01-31');
    assert.equal(r.following_second_poa_date, '2028-07-31');
    f.jurisdiction = 'scotland';
    assert.equal(forecastAnnual(f).income_tax_pence, 448633);
    assert.equal(forecastAnnual(f).annual_tax_pence, 584413);
    f.pension_basis = 'none'; f.monthly_pension_pence = 0;
    assert.equal(forecastAnnual(f).income_tax_pence, 454307);
    assert.equal(forecastAnnual(f).annual_tax_pence, 590087);
});
test('gross-versus-net pension choice changes accessible cash without becoming a trading expense', () => {
    const f = forecast(); f.pension_basis = 'gross_ras';
    const r = forecastAnnual(f);
    assert.equal(r.pension_gross_pence, 552000);
    assert.equal(r.pension_cash_pence, 441600);
    assert.equal(r.profit_pence, 3520000);
    assert.equal(r.class4_pence, 135780);
    assert.equal(r.income_tax_pence, 452600);
    f.pension_basis = 'unknown';
    assert.equal(forecastAnnual(f).annual_tax_pence, null);
    f.pension_basis = 'net_ras'; f.pension_eligibility_checked = false;
    assert.equal(forecastAnnual(f).annual_tax_pence, null);
    f.pension_eligibility_checked = true; f.monthly_pension_pence = 400000;
    assert.ok(forecastAnnual(f).issues.some(i => i.code === 'pension_earnings_limit'));
    assert.equal(forecastAnnual(f).annual_tax_pence, null);
});
test('annual forecast does not assume missing tax scope, jurisdiction, payments or another year', () => {
    for (const patch of [{ supported_tax_scope_checked: false }, { jurisdiction: 'unknown' }, { annual_turnover_pence: null }, { monthly_costs_pence: null }, { tax_year_start: 2027 }]) {
        const r = forecastAnnual({ ...forecast(), ...patch });
        assert.equal(r.annual_tax_pence, null);
        assert.equal(r.status, 'incomplete');
    }
    const r = forecastAnnual({ ...forecast(), tax_paid_pence: null });
    assert.equal(r.annual_tax_pence, 588380);
    assert.equal(r.remaining_tax_pence, null);
    assert.equal(r.status, 'incomplete');
    assert.equal(forecastAnnual({ ...forecast(), tax_paid_pence: 600000 }).remaining_tax_pence, 0);
    assert.equal(forecastAnnual({ ...forecast(), annual_turnover_pence: 10000 }).annual_tax_pence, null);
});
test('Class 2 lower-profit election is explicit and the 2026 threshold differs from 2025', () => {
    const f: Forecast = { ...forecast(), annual_turnover_pence: 710499, monthly_costs_pence: 0, pension_basis: 'none', monthly_pension_pence: 0, class2_election: 'unknown' };
    assert.equal(forecastAnnual(f).class2_pence, null);
    assert.ok(forecastAnnual(f).issues.some(i => i.code === 'class2_unknown'));
    f.class2_election = 'no_voluntary_charge';
    assert.equal(forecastAnnual(f).class2_pence, 0);
    assert.equal(forecastAnnual(f).class2_treatment, 'explicit_no_voluntary_charge');
    f.annual_turnover_pence = 710500; f.class2_election = 'unknown';
    assert.equal(forecastAnnual(f).class2_pence, 0);
    assert.equal(planningRules2026.ni.class2_small_profit_pence, 710500);
    assert.equal(rules2025.ni.class2_small_profit_pence, 684500);
    assert.equal(class4NI(4000000, []).pence, 164580);
    // 2,827×19% + 12,094×20% + 7,709×21% = £4,574.82 using unchanged 2025 defaults.
    assert.equal(incomeTaxBands(2263000, 'scotland', 0).reduce((n, b) => n + b.tax, 0), 457482);
});
test('actual cash, buffers and pensions remain distinct; earmarked tax protects once', () => {
    const p = plan(), r = evaluatePlan(p, p.as_of);
    assert.equal(r.status, 'estimate');
    assert.equal(r.actual_cash_pence, 3000000);
    assert.equal(r.pension_assets_pence, 4305500);
    assert.equal(r.actual_tax_reserve_pence, 592439);
    assert.equal(r.required_tax_protection_pence, 588380);
    assert.equal(r.additional_tax_reserve_pence, 0);
    // Cash − business buffer − emergency buffer − max(actual reserve, remaining liability).
    assert.equal(r.current_free_cash_pence, 827561);
    assert.equal(r.additional_drawings_ceiling_pence, 827561);
    assert.equal(r.cashflow.length, 6);
    assert.equal(r.cashflow[0].date, '2026-11-05');
    assert.equal(r.cashflow.at(-1)!.date, '2027-04-05');
    assert.equal(r.forecast.remaining_tax_pence, 588380); // A reserve is never a tax payment.
    p.assets[1].balance_pence = 99000000;
    assert.equal(evaluatePlan(p, p.as_of).current_free_cash_pence, r.current_free_cash_pence);
    p.assets.push(asset('locked', 'restricted', 10000000));
    assert.equal(evaluatePlan(p, p.as_of).current_free_cash_pence, r.current_free_cash_pence);
});
test('allocation capacity is checked across every purpose and tax year, and inaccessible money cannot fund it', () => {
    const p = plan();
    p.earmarks.push({ id: 'prior', asset_id: 'bank', purpose: 'tax_reserve', tax_year_start: 2025, amount_pence: 900000 });
    assert.throws(() => validatePlan(p), /fit the physical/);
    p.earmarks.pop(); p.earmarks[0].asset_id = 'retirement';
    assert.throws(() => validatePlan(p), /known accessible/);
    p.earmarks[0].asset_id = 'bank'; p.assets[0].balance_pence = null;
    assert.throws(() => validatePlan(p), /known accessible/);
    p.assets[0].balance_pence = -100;
    assert.throws(() => validatePlan(p), /fit the physical/);
    p.assets[0].balance_pence = 3000000; p.assets[0].account_id = 'same-account';
    p.assets[1].account_id = 'same-account';
    assert.throws(() => validatePlan(p), /only once/);
});
test('unallocated reserve year, unknown debts, missing completeness, stale and future balances withhold drawings', () => {
    const mutations: ((p: Plan) => void)[] = [
        p => { p.earmarks[0].tax_year_start = null; },
        p => { p.assets.push(asset('unknown-debt', 'liability', null)); },
        p => { p.cash_complete = false; }, p => { p.unique_assets_checked = false; },
        p => { p.commitments_complete = false; }, p => { p.cashflow_assumptions_checked = false; },
        p => { p.as_of = '2026-10-16'; }, p => { p.as_of = '2026-10-18'; },
        p => { p.forecast.monthly_drawings_pence = null; },
        p => { p.as_of = '2026-04-05'; },
    ];
    for (const mutate of mutations) {
        const p = plan(); mutate(p); const r = evaluatePlan(p, '2026-10-17');
        assert.equal(r.additional_drawings_ceiling_pence, null);
        assert.equal(r.current_free_cash_pence, null);
        assert.equal(r.cashflow.length, 0);
        assert.equal(r.actual_tax_reserve_pence, 592439);
        assert.equal(r.pension_assets_pence, 4305500);
    }
    const p = plan(); p.assets[1].balance_pence = null;
    assert.equal(evaluatePlan(p, p.as_of).additional_drawings_ceiling_pence, 827561); // Unknown inaccessible assets do not invent cash.
});
test('prior-year tax and actual payments stay separate; funded obligations are not deducted twice', () => {
    const p = plan(); p.earmarks[0].tax_year_start = 2025;
    p.obligations.push({ id: 'prior-demand', label: 'Synthetic prior balancing demand', kind: 'tax', tax_year_start: 2025, due_date: '2027-01-31', amount_pence: 500000 });
    let r = evaluatePlan(p, p.as_of);
    assert.equal(r.required_tax_protection_pence, 1088380);
    assert.equal(r.additional_tax_reserve_pence, 588380);
    assert.equal(r.current_free_cash_pence, 239181);
    const before = r.cashflow.find(row => row.date === '2027-01-05')!, after = r.cashflow.find(row => row.date === '2027-02-05')!;
    assert.equal(after.obligations_pence, 500000);
    assert.equal(after.protected_pence, before.protected_pence - 500000);
    assert.equal(after.free_cash_pence - before.free_cash_pence, after.receipts_pence - 40000 - 46000 - 100000);
    // These are current-year POA demands from a prior assessment, not calculated from the forecast.
    p.obligations.push({ id: 'current-demand', label: 'Synthetic assessed current-year POA', kind: 'tax', tax_year_start: 2026, due_date: '2027-01-31', amount_pence: 100000 });
    r = evaluatePlan(p, p.as_of);
    assert.equal(r.required_tax_protection_pence, 1088380); // max(current forecast liability, known current demand).
    assert.equal(r.forecast.following_first_poa_date, '2028-01-31');
    p.forecast.tax_paid_pence = 100000;
    assert.equal(evaluatePlan(p, p.as_of).forecast.remaining_tax_pence, 488380);
});
test('known liabilities, overdrafts and unpaid non-tax commitments reduce headroom exactly once', () => {
    const p = plan(); p.assets.push(asset('card-debt', 'liability', 100000), asset('overdrawn', 'cash', -50000));
    p.obligations.push({ id: 'supplier', label: 'Synthetic separate unpaid supplier', kind: 'other', tax_year_start: null, due_date: '2027-01-15', amount_pence: 200000 });
    const r = evaluatePlan(p, p.as_of);
    assert.equal(r.net_cash_pence, 2850000);
    assert.equal(r.current_free_cash_pence, 477561);
    assert.equal(r.cashflow[0].closing_cash_pence, 3097333); // Physical cash includes the overdraft; card debt is a separate hold.
    assert.equal(r.cashflow[0].closing_cash_pence - r.cashflow[0].protected_pence, r.cashflow[0].free_cash_pence);
    const before = r.cashflow.find(row => row.date === '2027-01-05')!, after = r.cashflow.find(row => row.date === '2027-02-05')!;
    assert.equal(after.protected_pence, before.protected_pence - 200000);
    assert.equal(after.obligations_pence, 200000);
    p.forecast.monthly_drawings_pence = 1000000;
    const deficit = evaluatePlan(p, p.as_of);
    assert.equal(deficit.additional_drawings_ceiling_pence, 0);
    assert.ok(deficit.cashflow.at(-1)!.free_cash_pence < 0);
});
test('unknown or overdue obligations block projections rather than pretending they are paid or zero', () => {
    for (const patch of [{ amount_pence: null }, { tax_year_start: null }, { due_date: '2026-10-16' }]) {
        const p = plan(); p.obligations.push({ id: 'tax', label: 'Synthetic unresolved tax', kind: 'tax', tax_year_start: 2025, due_date: '2027-01-31', amount_pence: 10000, ...patch });
        const r = evaluatePlan(p, p.as_of);
        assert.equal(r.additional_drawings_ceiling_pence, null);
        assert.equal(r.cashflow.length, 0);
    }
});
test('full tax-year monthly schedule preserves all turnover pennies without adding old receipts to current cash', () => {
    const p = plan(); p.as_of = '2026-04-06'; p.forecast.annual_turnover_pence = 4000001; p.forecast.daily_rate_pence = 40001;
    const copy = structuredClone(p), r = evaluatePlan(p, p.as_of);
    assert.equal(r.cashflow.length, 12);
    assert.equal(r.cashflow[0].date, '2026-05-05');
    assert.equal(r.cashflow.at(-1)!.date, '2027-04-05');
    assert.equal(r.cashflow.reduce((n, row) => n + row.receipts_pence, 0), 4000001);
    assert.equal(r.cashflow.reduce((n, row) => n + row.pension_cash_pence, 0), 552000);
    assert.equal(r.actual_cash_pence, 3000000);
    assert.deepEqual(p, copy);
});
test('billable targets round upwards and disclose capacity gaps; zero rate does not divide by zero', () => {
    const f = forecast(); f.billable_days_per_year = 99; f.daily_rate_pence = 30000;
    const r = forecastAnnual(f);
    assert.equal(r.required_daily_rate_pence, 40405);
    assert.equal(r.required_billable_days, 134);
    assert.equal(r.billable_capacity_turnover_pence, 2970000);
    assert.equal(r.turnover_gap_pence, 1030000);
    assert.ok(r.issues.some(i => i.code === 'turnover_capacity_gap'));
    const p = plan(); p.forecast = f;
    assert.equal(evaluatePlan(p, p.as_of).additional_drawings_ceiling_pence, null);
    f.daily_rate_pence = 0;
    assert.equal(forecastAnnual(f).required_billable_days, null);
    f.daily_rate_pence = null; f.billable_days_per_year = null;
    assert.equal(forecastAnnual(f).required_daily_rate_pence, null);
    assert.equal(forecastAnnual(f).billable_capacity_turnover_pence, null);
});
test('strict validation rejects extra raw evidence, fractional money, malformed dates and duplicate identities', () => {
    assert.throws(() => validatePlan({ ...plan(), raw_bank_pdf: 'private' }), /unknown fields/);
    assert.throws(() => forecastAnnual({ ...forecast(), monthly_costs_pence: 0.5 }), /integer pence/);
    assert.throws(() => forecastAnnual({ ...forecast(), monthly_costs_pence: -1 }), /integer pence/);
    assert.throws(() => forecastAnnual({ ...forecast(), pension_basis: 'none' }), /explicit zero/);
    assert.throws(() => evaluatePlan(plan(), '2026-02-30'), /date/);
    assert.throws(() => evaluatePlan({ ...plan(), cash_complete: 'yes' }, '2026-10-17'), /completeness/);
    const p = plan(); p.assets.push(structuredClone(p.assets[0]));
    assert.throws(() => validatePlan(p), /unique identity/);
    p.assets.pop(); p.assets[0].label = 'Account 12345678 12-34-56';
    assert.equal(validatePlan(p).assets[0].label, 'Account [redacted account number] [redacted sort code]');
    const obligation = { id: 'one', label: 'Same demand', kind: 'tax' as const, tax_year_start: 2025, due_date: '2027-01-31', amount_pence: 10000 };
    p.obligations = [obligation, { ...obligation, id: 'two' }];
    assert.throws(() => validatePlan(p), /duplicate unpaid/);
});

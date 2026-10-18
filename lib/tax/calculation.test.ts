import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateTax, class4NI, incomeTaxBands, paymentsOnAccount, type CalculationInput, type CalculationRecord } from './calculation.ts';
import { factKinds, type TaxFact } from './facts.ts';
import { emptyScope, validateScope } from './scope.ts';
// Synthetic inputs, deliberately independent expected arithmetic. No actual taxpayer data.
function fixture(): CalculationInput {
    return {
        schema_version: 'tax-calculation-input/1', owner_id: 'owner', tax_year_start: 2025, financial_stamp: 'ledger-v1',
        profile: { id: 'profile', profile_id: 'profile-family', financial_stamp: 'ledger-v1', ledger_is_current: true, ordinal: 1, state: 'reviewed', data: { jurisdiction: 'england_wales_ni', accounting_basis: 'cash', business_structure: 'sole_trader', vat_registered: 'no', student_loan: 'none', residency: 'uk_full_year', special_reliefs: 'none', ledger_completeness: 'complete' }, rationale: 'Synthetic', created_at: '2026-10-17' },
        scope: { input_stamp: 'synthetic', is_current: true, id: 'scope', ordinal: 1, state: 'reviewed', data: { assessment_adjustments: 'none', class4_status: 'not_exempt', class2_election: 'no_voluntary_charge', class2_amount_pence: 0, pension_scope: 'none', net_pay_scope: 'not_applicable', employment_scope: 'none', termination_scope: 'none', payments_scope: 'none', vehicle_scope: 'none', trade_treatment: 'reviewed_no_unmodelled_adjustments', ni_adjustments: 'none', gift_aid_scope: 'none', cash_dates: 'bank_posting_dates_reviewed' }, evidence_document_id: null, document_snapshot: null, rationale: 'Synthetic', author: 'owner', created_at: '2026-10-17' },
        facts: [], sources: [], sections: factKinds.map(kind => ({ id: 'section-' + kind, kind, verdict: 'none', fact_digest: 'synthetic', is_current: true })), records: [], observations: [],
    };
}
function record(id: string, type: 'income' | 'expense', pence: number, sign: 1 | -1 = 1): CalculationRecord {
    return { id, record_type: type, record_date: '2025-08-01', amount_pence: pence, effect_sign: sign, status: 'approved', category: type === 'expense' ? { id: 'category', name: 'Synthetic expense', record_type: 'expense', sa103_box: null, valid: true } : null, bank_transaction_id: null, original_bank_transaction_id: null, source_type: 'manual' };
}
function fact(input: CalculationInput, kind: TaxFact['kind'], data: TaxFact['data'], id: string = kind) {
    const value: TaxFact = { id, family_id: id + '-family', ordinal: 1, kind, label: 'Synthetic ' + id, tax_year_start: 2025, state: 'verified', data, rationale: 'Synthetic evidence review', created_at: '2026-10-17' };
    input.facts.push(value);
    input.sources.push({ id: id + '-source', revision_id: id, document_id: id + '-document', record_id: null, transaction_id: null, snapshot: { id: id + '-document', file_sha256: 'a'.repeat(64) }, current_recognized_pence: 0, source_unresolved: false });
    input.sections.find(s => s.kind === kind)!.verdict = 'complete';
    return value;
}
function employment(input: CalculationInput, band: number | null = 0) {
    input.scope!.data.employment_scope = 'distinct_employments_cumulative_totals_checked';
    return fact(input, 'employment', { taxable_pay_pence: 1403352, income_tax_withheld_pence: 154260, class1_band_earnings_pence: band, statement_basis: 'p45_current_employment', period_start: '2025-04-06', period_end: '2026-04-05' });
}
test('reviewed empty inputs are distinct from missing inputs and wrong-year rules', () => {
    const input = fixture();
    assert.equal(calculateTax(input).status, 'estimate');
    assert.equal(calculateTax(input).totals.net_balance, 0);
    input.sections = [];
    let result = calculateTax(input);
    assert.equal(result.status, 'incomplete');
    assert.equal(result.totals.net_balance, null);
    input.tax_year_start = 2026;
    result = calculateTax(input);
    assert.ok(result.issues.some(i => i.code === 'unsupported_year'));
    assert.equal(result.totals.income_tax, null);
    assert.throws(() => validateScope(emptyScope(), 'reviewed'), /provisional/);
});
test('cash profit, PAYE pence, partial actual credits and conditional POA stay separate', () => {
    const input = fixture();
    input.records = [record('income', 'income', 4000000)];
    employment(input, 146352);
    let result = calculateTax(input);
    assert.equal(result.status, 'estimate');
    // 54,033 − 12,570 = 41,463; 37,700×20% + 3,763×40% = 9,045.20.
    assert.equal(result.totals.income_tax, 904520);
    assert.equal(result.totals.class4, 164580);
    assert.equal(result.totals.tax_withheld, 154260);
    assert.equal(result.totals.net_balance, 914840);
    assert.equal(result.totals.poa_each, 457420);
    input.scope!.data.payments_scope = 'distinct_identified_allocations_checked';
    fact(input, 'tax_payment', { payment_reference: 'Synthetic allocation', paid_total_pence: 200000, allocated_pence: 125001, allocation_type: 'first_payment_on_account', payment_date: '2026-01-31' });
    result = calculateTax(input);
    assert.equal(result.totals.net_balance, 789839);
    assert.equal(result.totals.poa_each, 457420);
    assert.equal(result.totals.january_combined, 1247259);
    assert.deepEqual(result.deadlines, { balancing: '2027-01-31', first_poa: '2027-01-31', second_poa: '2027-07-31' });
});
test('historic scenario uses receipts once, mixed-use already apportioned, and reviewed exempt termination', () => {
    const input = fixture();
    input.records = [record('nas1', 'income', 25000), record('nas2', 'income', 27500), record('nc', 'income', 150000), record('car', 'expense', 18909)];
    employment(input);
    input.scope!.data.termination_scope = 'separate_taxable_pay_and_withholding_checked';
    fact(input, 'termination', { gross_pence: 1025525, taxable_pence: 0, income_tax_withheld_pence: 0, payment_date: '2025-08-01', treatment: 'evidence_reviewed' });
    const result = calculateTax(input);
    assert.equal(result.status, 'estimate');
    assert.equal(result.totals.trade_profit, 183591);
    assert.equal(result.totals.taxable_trade_profit, 183500);
    assert.equal(result.totals.income_tax, 65960);
    assert.equal(result.totals.net_balance, -88300);
    assert.equal(result.totals.poa_each, 0);
    assert.match(result.document_status, /Draft.*not submitted/);
    assert.ok(result.trace.find(t => t.id === 'ledger_income')!.source_ids.includes('nc'));
});
test('NI thresholds, Reg100 employment cap and unknown Class1 earnings use independent boundaries', () => {
    assert.equal(class4NI(1256999, []).pence, 0);
    assert.equal(class4NI(1257100, []).pence, 6);
    assert.equal(class4NI(5027000, []).pence, 226200);
    assert.equal(class4NI(6000000, []).pence, 245660);
    // Full PT–UEL employment earnings: ordinary 1,045.80 capped to 17,430×2% = 348.60.
    assert.equal(class4NI(3000000, [3770000]).pence, 34860);
    assert.equal(class4NI(6000000, [3770000]).pence, 94860);
    const input = fixture();
    input.records = [record('income', 'income', 3000000)];
    const pay = employment(input, null);
    let result = calculateTax(input);
    assert.equal(result.totals.class4, null);
    assert.equal(result.totals.net_balance, null);
    assert.ok(result.issues.some(i => i.code === 'class1_earnings_missing'));
    delete pay.data.class1_band_earnings_pence;
    result = calculateTax(input);
    assert.equal(result.totals.class4, null);
});
test('POA minimum and 80 percent withheld exemption use strict equality and floor half-penny instalments', () => {
    assert.deepEqual(paymentsOnAccount(99999, 0), { relevant: 99999, each: 0 });
    assert.equal(paymentsOnAccount(100000, 0).each, 50000);
    assert.equal(paymentsOnAccount(500000, 400001).each, 0);
    assert.equal(paymentsOnAccount(500000, 400000).each, 50000);
    assert.equal(paymentsOnAccount(500005, 400004).each, 50000);
    assert.equal(paymentsOnAccount(100001, 0).each, 50000);
});
test('pension and Gift Aid extend bands without reducing trading profit; excess relief stays unresolved', () => {
    const input = fixture();
    input.records = [record('income', 'income', 6000000)];
    input.scope!.data.pension_scope = 'eligible_registered_under75_no_unmodelled_charge';
    fact(input, 'pension', { net_paid_pence: 800000, gross_contribution_pence: 1000000, method: 'relief_at_source', period_start: '2025-04-06', period_end: '2026-04-05' });
    let result = calculateTax(input);
    assert.equal(result.status, 'estimate');
    assert.equal(result.totals.trade_profit, 6000000);
    assert.equal(result.totals.income_tax, 948600);
    assert.equal(result.totals.class4, 245660);
    input.scope!.data.gift_aid_scope = 'eligibility_and_tax_cover_checked';
    fact(input, 'gift_aid', { net_donation_pence: 80000, payment_date: '2025-08-01' });
    result = calculateTax(input);
    assert.equal(result.totals.income_tax, 948600); // All taxable income already inside extended basic band.
    input.facts[0].data.gross_contribution_pence = 7000000;
    result = calculateTax(input);
    assert.ok(result.issues.some(i => i.code === 'pension_earnings_cap'));
    assert.equal(result.totals.income_tax, null);
    assert.equal(result.totals.net_balance, null);
});
test('Scottish band widths, pension extension and personal allowance taper use year-specific arithmetic', () => {
    const sum = (lines: ReturnType<typeof incomeTaxBands>) => lines.reduce((n, b) => n + b.tax, 0);
    assert.equal(sum(incomeTaxBands(3770000, 'scotland', 0)), 912720); // 2827×19% +12094×20% +16171×21% +6608×42%.
    const bands = incomeTaxBands(3770000, 'scotland', 1000000);
    assert.equal(bands[0].base, 282700);
    assert.equal(bands[1].base, 2209400);
    assert.equal(sum(bands), 763952);
    const input = fixture();
    input.records = [record('income', 'income', 10000100)];
    assert.equal(calculateTax(input).totals.personal_allowance, 1257000);
    input.records[0].amount_pence = 10000200;
    assert.equal(calculateTax(input).totals.personal_allowance, 1256900);
    input.records[0].amount_pence = 12514000;
    assert.equal(calculateTax(input).totals.personal_allowance, 0);
});
test('mileage replaces linked actual expenses including refunds and is not apportioned twice', () => {
    const input = fixture();
    const cost = record('car-cost', 'expense', 18909), refund = record('car-refund', 'expense', 900, -1);
    cost.bank_transaction_id = 'original';
    refund.bank_transaction_id = 'refund';
    refund.original_bank_transaction_id = 'original';
    input.records = [record('income', 'income', 2000000), cost, refund];
    input.scope!.data.vehicle_scope = 'all_costs_method_history_and_capital_checked';
    const v = fact(input, 'vehicle', { vehicle_type: 'car', method: 'simplified_mileage', business_use_bps: 3000, business_miles_hundredths: 1200000, period_start: '2025-04-06', period_end: '2026-04-05' });
    input.sources.push({ id: 'car-link', revision_id: v.id, document_id: null, record_id: cost.id, transaction_id: null, snapshot: { id: cost.id }, current_recognized_pence: 18909, source_unresolved: false });
    const result = calculateTax(input);
    assert.equal(result.status, 'estimate');
    assert.equal(result.totals.trade_profit, 1500000); // £4,500 + £500 mileage; actual costs fully replaced.
    input.facts[0].data.method = 'actual_costs';
    assert.equal(calculateTax(input).totals.trade_profit, 1981991);
});
test('trading allowance never hides negative receipt effects; unresolved evidence never becomes a zero claim', () => {
    const input = fixture();
    input.records = [record('refund', 'income', 10000, -1)];
    fact(input, 'trade_adjustment', { adjustment_type: 'trading_allowance', amount_pence: 100000, treatment: 'evidence_reviewed' });
    let result = calculateTax(input);
    assert.ok(result.issues.some(i => i.code === 'trading_loss'));
    assert.equal(result.totals.net_balance, null);
    input.records = [record('income', 'income', 2000000)];
    input.sources[0].source_unresolved = true;
    result = calculateTax(input);
    assert.equal(result.totals.taxable_trade_profit, null);
    assert.equal(result.totals.income_tax, null);
});
test('voluntary Class2 needs an explicit evidenced amount and is excluded from POA', () => {
    const input = fixture();
    input.records = [record('income', 'income', 500000)];
    input.scope!.data.class2_election = 'verified_amount';
    input.scope!.data.class2_amount_pence = 17500;
    let result = calculateTax(input);
    assert.equal(result.totals.class2, null);
    assert.equal(result.totals.net_balance, null);
    input.scope!.evidence_document_id = 'nicl2';
    result = calculateTax(input);
    assert.equal(result.totals.class2, 17500);
    assert.equal(result.totals.net_balance, 17500);
    assert.equal(result.totals.poa_each, 0);
});
test('changed scope and assessment collection adjustments withhold affected balances', () => {
    const input = fixture();
    input.records = [record('income', 'income', 4000000)];
    input.scope!.is_current = false;
    let result = calculateTax(input);
    assert.equal(result.status, 'incomplete');
    assert.equal(result.totals.income_tax, null);
    assert.equal(result.totals.net_balance, null);
    input.scope!.is_current = true;
    input.scope!.data.assessment_adjustments = 'requires_review';
    result = calculateTax(input);
    assert.equal(result.totals.income_tax, 548600);
    assert.equal(result.totals.net_balance, null);
    assert.equal(result.totals.poa_each, null);
    assert.ok(result.issues.some(i => i.code === 'assessment_adjustments'));
});

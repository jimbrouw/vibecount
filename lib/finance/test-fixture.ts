/** Synthetic engineering fixture only. Application code must use emptyFinancePlan. */
import { emptyFinancePlan } from './defaults';
export function financeFixture(today: string) {
    const p = emptyFinancePlan(today);
    p.assets = [{ id: 'synthetic-cash', label: 'Synthetic cash', kind: 'cash', balance_pence: 3000000, account_id: null, document_id: null }, { id: 'synthetic-pension', label: 'Synthetic pension', kind: 'pension', balance_pence: 4305500, account_id: null, document_id: null }];
    p.earmarks = [{ id: 'synthetic-reserve', asset_id: 'synthetic-cash', purpose: 'tax_reserve', tax_year_start: 2026, amount_pence: 592439 }];
    p.cash_complete = true; p.unique_assets_checked = true; p.commitments_complete = true; p.cashflow_assumptions_checked = true;
    Object.assign(p.forecast, { jurisdiction: 'england_wales_ni', annual_turnover_pence: 4000000, monthly_costs_pence: 40000, monthly_pension_pence: 46000, pension_basis: 'net_ras', pension_eligibility_checked: true, supported_tax_scope_checked: true, class2_election: 'no_voluntary_charge', tax_paid_pence: 0, tax_payments_checked: true, monthly_drawings_pence: 100000, billable_days_per_year: 100, daily_rate_pence: 40000 });
    return p;
}

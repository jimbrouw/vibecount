import type { Plan } from './plan';
/** No scenario amounts or completeness declarations are production defaults. */
export function emptyFinancePlan(today: string): Plan {
    return { schema_version: 'finance-plan/1', as_of: today, assets: [], earmarks: [], obligations: [], cash_complete: false,
        unique_assets_checked: false, commitments_complete: false, cashflow_assumptions_checked: false,
        forecast: { tax_year_start: 2026, jurisdiction: 'unknown', annual_turnover_pence: null, monthly_costs_pence: null,
            monthly_pension_pence: null, pension_basis: 'unknown', pension_eligibility_checked: false, supported_tax_scope_checked: false,
            class2_election: 'unknown', tax_paid_pence: null, tax_payments_checked: false, monthly_drawings_pence: null,
            billable_days_per_year: null, daily_rate_pence: null } };
}
export function londonPlanningDate(date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const part = (type: string) => parts.find(p => p.type === type)!.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
}

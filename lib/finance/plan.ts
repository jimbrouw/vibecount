import { sumPence } from '../money';
import { redactBankDetailsForPrompt } from '../ai/redaction';
import { class4NI, incomeTaxBands, paymentsOnAccount, ratio } from '../tax/arithmetic';
import { planningRules2026 as rules } from './rules';

export const PLAN_VERSION = 'finance-plan/1';
export const PLAN_CAVEAT = 'Draft planning estimate — not tax advice, a bank balance confirmation or a payment instruction. Not submitted to HMRC. Independent tax review is pending. Drawings depend on the stated balances, completeness and future cash assumptions.';
export type Asset = {
    id: string; label: string; kind: 'cash' | 'liability' | 'pension' | 'restricted';
    balance_pence: number | null; account_id: string | null; document_id: string | null;
};
export type Earmark = {
    id: string; asset_id: string; purpose: 'tax_reserve' | 'business_buffer' | 'emergency_buffer';
    tax_year_start: number | null; amount_pence: number;
};
export type Obligation = {
    id: string; label: string; kind: 'tax' | 'other'; tax_year_start: number | null;
    due_date: string; amount_pence: number | null;
};
export type Forecast = {
    tax_year_start: number; jurisdiction: 'unknown' | 'england_wales_ni' | 'scotland';
    annual_turnover_pence: number | null; monthly_costs_pence: number | null;
    monthly_pension_pence: number | null; pension_basis: 'unknown' | 'none' | 'net_ras' | 'gross_ras';
    pension_eligibility_checked: boolean; supported_tax_scope_checked: boolean;
    class2_election: 'unknown' | 'no_voluntary_charge'; tax_paid_pence: number | null;
    tax_payments_checked: boolean; monthly_drawings_pence: number | null;
    billable_days_per_year: number | null; daily_rate_pence: number | null;
};
export type Plan = {
    schema_version: typeof PLAN_VERSION; as_of: string; assets: Asset[]; earmarks: Earmark[]; obligations: Obligation[];
    cash_complete: boolean; unique_assets_checked: boolean; commitments_complete: boolean;
    cashflow_assumptions_checked: boolean; forecast: Forecast;
};
export type PlanningIssue = { code: string; message: string };
export type ForecastTrace = { id: string; pence: number | null; formula: string; input_fields: string[]; rule_refs: string[] };
export type ForecastResult = {
    ruleset_id: string; status: 'incomplete' | 'estimate'; issues: PlanningIssue[];
    trace: ForecastTrace[]; class2_treatment: string;
    profit_pence: number | null; pension_cash_pence: number | null; pension_gross_pence: number | null;
    income_tax_pence: number | null; class4_pence: number | null; class2_pence: number | null;
    annual_tax_pence: number | null; remaining_tax_pence: number | null;
    following_year_poa_each_pence: number | null;
    balancing_date: string; following_first_poa_date: string; following_second_poa_date: string;
    required_daily_rate_pence: number | null; required_billable_days: number | null;
    billable_capacity_turnover_pence: number | null; turnover_gap_pence: number | null;
};
const MAX = 999999999999;
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
        throw new Error('Use a plain planning input object.');
    const result = value as Record<string, unknown>;
    if (Object.keys(result).length !== keys.length || keys.some(k => !Object.hasOwn(result, k)))
        throw new Error('Review every planning field; unknown fields are not retained.');
    return result;
}
function choice<T extends string>(value: unknown, options: readonly T[]): T {
    if (typeof value !== 'string' || !options.includes(value as T)) throw new Error('Review the planning choice.');
    return value as T;
}
function bool(value: unknown): boolean {
    if (typeof value !== 'boolean') throw new Error('Review the completeness answers.');
    return value;
}
function pence(value: unknown, signed = false): number | null {
    if (value === null) return null;
    if (!Number.isSafeInteger(value) || (value as number) > MAX || (value as number) < (signed ? -MAX : 0))
        throw new Error('Enter exact, bounded integer pence or leave the amount unknown.');
    return value as number;
}
function identifier(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new Error('Review planning identity.');
    return value;
}
function optionalId(value: unknown): string | null { return value === null ? null : identifier(value); }
function label(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value))
        throw new Error('Use a short asset or obligation label, without account details.');
    const safe = redactBankDetailsForPrompt(value.trim());
    if (safe.length > 120) throw new Error('Use a shorter label without account details.');
    return safe;
}
export function planningDate(value: unknown): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Review the planning date.');
    const n = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value || value < '2000-01-01' || value > '2101-12-31')
        throw new Error('Review the planning date.');
    return value;
}
function year(value: unknown): number | null {
    if (value === null) return null;
    if (!Number.isInteger(value) || (value as number) < 2000 || (value as number) > 2100) throw new Error('Review tax-year allocation.');
    return value as number;
}
function list(value: unknown): unknown[] {
    if (!Array.isArray(value) || value.length > 100) throw new Error('Review at most 100 rows in each planning section.');
    return value;
}
function unique(values: string[], message: string) { if (new Set(values).size !== values.length) throw new Error(message); }
const forecastKeys = ['tax_year_start', 'jurisdiction', 'annual_turnover_pence', 'monthly_costs_pence', 'monthly_pension_pence', 'pension_basis', 'pension_eligibility_checked', 'supported_tax_scope_checked', 'class2_election', 'tax_paid_pence', 'tax_payments_checked', 'monthly_drawings_pence', 'billable_days_per_year', 'daily_rate_pence'] as const;
export function validateForecast(value: unknown): Forecast {
    const f = object(value, forecastKeys), days = f.billable_days_per_year;
    if (days !== null && (!Number.isInteger(days) || (days as number) < 1 || (days as number) > 366)) throw new Error('Choose 1 to 366 billable days or leave them unknown.');
    const result: Forecast = {
        tax_year_start: year(f.tax_year_start) ?? (() => { throw new Error('Choose a forecast tax year.'); })(),
        jurisdiction: choice(f.jurisdiction, ['unknown', 'england_wales_ni', 'scotland']),
        annual_turnover_pence: pence(f.annual_turnover_pence), monthly_costs_pence: pence(f.monthly_costs_pence),
        monthly_pension_pence: pence(f.monthly_pension_pence), pension_basis: choice(f.pension_basis, ['unknown', 'none', 'net_ras', 'gross_ras']),
        pension_eligibility_checked: bool(f.pension_eligibility_checked), supported_tax_scope_checked: bool(f.supported_tax_scope_checked),
        class2_election: choice(f.class2_election, ['unknown', 'no_voluntary_charge']), tax_paid_pence: pence(f.tax_paid_pence),
        tax_payments_checked: bool(f.tax_payments_checked), monthly_drawings_pence: pence(f.monthly_drawings_pence),
        billable_days_per_year: days as number | null, daily_rate_pence: pence(f.daily_rate_pence),
    };
    if (result.pension_basis === 'none' && result.monthly_pension_pence !== 0) throw new Error('No pension contribution requires an explicit zero amount.');
    return result;
}
/** Validates the whole owner-wide plan so the same cash cannot be earmarked in separate year plans. */
export function validatePlan(value: unknown): Plan {
    const p = object(value, ['schema_version', 'as_of', 'assets', 'earmarks', 'obligations', 'cash_complete', 'unique_assets_checked', 'commitments_complete', 'cashflow_assumptions_checked', 'forecast']);
    if (p.schema_version !== PLAN_VERSION) throw new Error('Unsupported planning schema.');
    const assets: Asset[] = list(p.assets).map(value => {
        const a = object(value, ['id', 'label', 'kind', 'balance_pence', 'account_id', 'document_id']);
        const kind = choice(a.kind, ['cash', 'liability', 'pension', 'restricted']);
        return { id: identifier(a.id), label: label(a.label), kind, balance_pence: pence(a.balance_pence, kind === 'cash'), account_id: optionalId(a.account_id), document_id: optionalId(a.document_id) };
    });
    unique(assets.map(a => a.id), 'Each physical asset needs one unique identity.');
    unique(assets.flatMap(a => a.account_id ? [a.account_id] : []), 'A linked account can appear only once, across all asset kinds.');
    const earmarks: Earmark[] = list(p.earmarks).map(value => {
        const e = object(value, ['id', 'asset_id', 'purpose', 'tax_year_start', 'amount_pence']);
        const purpose = choice(e.purpose, ['tax_reserve', 'business_buffer', 'emergency_buffer']);
        const taxYear = year(e.tax_year_start), amount = pence(e.amount_pence);
        if (amount === null || (purpose !== 'tax_reserve' && taxYear !== null)) throw new Error('Review the cash earmark amount and year.');
        return { id: identifier(e.id), asset_id: identifier(e.asset_id), purpose, tax_year_start: taxYear, amount_pence: amount };
    });
    unique(earmarks.map(e => e.id), 'Cash earmark identities must be unique.');
    for (const e of earmarks) {
        const asset = assets.find(a => a.id === e.asset_id);
        if (!asset || asset.kind !== 'cash' || asset.balance_pence === null) throw new Error('Only a known accessible cash balance can fund an earmark.');
    }
    for (const a of assets) {
        if (sumPence(earmarks.filter(e => e.asset_id === a.id).map(e => e.amount_pence)) > Math.max(a.balance_pence ?? 0, 0))
            throw new Error('All earmarks across purposes and tax years must fit the physical cash balance.');
    }
    const obligations: Obligation[] = list(p.obligations).map(value => {
        const o = object(value, ['id', 'label', 'kind', 'tax_year_start', 'due_date', 'amount_pence']);
        const kind = choice(o.kind, ['tax', 'other']), taxYear = year(o.tax_year_start);
        if (kind === 'other' && taxYear !== null) throw new Error('Only tax obligations have a tax year.');
        return { id: identifier(o.id), label: label(o.label), kind, tax_year_start: taxYear, due_date: planningDate(o.due_date), amount_pence: pence(o.amount_pence) };
    });
    unique(obligations.map(o => o.id), 'Unpaid obligation identities must be unique.');
    unique(obligations.map(o => JSON.stringify([o.label.toLowerCase(), o.kind, o.tax_year_start, o.due_date])), 'Review duplicate unpaid obligations.');
    return { schema_version: PLAN_VERSION, as_of: planningDate(p.as_of), assets, earmarks, obligations,
        cash_complete: bool(p.cash_complete), unique_assets_checked: bool(p.unique_assets_checked), commitments_complete: bool(p.commitments_complete),
        cashflow_assumptions_checked: bool(p.cashflow_assumptions_checked), forecast: validateForecast(p.forecast) };
}
const floorPound = (n: number) => Math.floor(n / 100) * 100;
const ceilPound = (n: number) => Math.ceil(n / 100) * 100;
const annual = (n: number) => sumPence(Array<number>(12).fill(n));
/** Hypothetical annual run rate. Never fabricates ledger rows, verified facts or actual payments. */
export function forecastAnnual(value: unknown): ForecastResult {
    const f = validateForecast(value), issues: PlanningIssue[] = [];
    const issue = (code: string, message: string) => issues.push({ code, message });
    if (f.tax_year_start !== rules.tax_year_start) issue('unsupported_year', 'No planning rules for this tax year.');
    if (f.jurisdiction === 'unknown') issue('jurisdiction_unknown', 'Choose the applicable tax jurisdiction.');
    if (!f.supported_tax_scope_checked) issue('tax_scope_unknown', 'Confirm full-year UK sole-trader cash basis, non-VAT, no other income, loans, losses, special reliefs or NI exceptions, and eligible business costs.');
    const profit = f.annual_turnover_pence === null || f.monthly_costs_pence === null ? null : sumPence([f.annual_turnover_pence, -annual(f.monthly_costs_pence)]);
    if (profit === null) issue('profit_unknown', 'Enter turnover and eligible business costs; missing is not zero.');
    else if (profit < 0) issue('loss_branch', 'A trading loss needs a separate reviewed relief scenario.');
    let pensionCash: number | null = null, pensionGross: number | null = null;
    if (f.monthly_pension_pence === null || f.pension_basis === 'unknown') issue('pension_basis_unknown', 'State whether the pension amount is net cash or gross relief-at-source, or explicitly none.');
    else if (f.pension_basis === 'none') { pensionCash = 0; pensionGross = 0; }
    else {
        // Rounded per monthly contribution; annual cash matches the monthly cash-flow schedule.
        pensionCash = annual(f.pension_basis === 'net_ras' ? f.monthly_pension_pence : ratio(f.monthly_pension_pence, 4, 5, true));
        pensionGross = annual(f.pension_basis === 'gross_ras' ? f.monthly_pension_pence : ratio(f.monthly_pension_pence, 5, 4, true));
        if (!f.pension_eligibility_checked) issue('pension_eligibility_unknown', 'Review registered RAS, under-75 eligibility, relevant earnings and absence of unmodelled annual allowance/MPAA charges.');
        if (profit !== null && pensionGross > Math.max(rules.minimum_pension_earnings_pence, Math.max(profit, 0))) issue('pension_earnings_limit', 'Proposed gross contributions exceed supported relevant-earnings relief.');
    }
    let incomeTax: number | null = null, class4: number | null = null, class2: number | null = null;
    const trace: ForecastTrace[] = [
        { id: 'annual_profit', pence: profit, formula: 'annual_turnover_pence − 12 × monthly_costs_pence; pension is not a trading cost', input_fields: ['annual_turnover_pence', 'monthly_costs_pence'], rule_refs: [] },
        { id: 'pension_cash', pence: pensionCash, formula: '12 × monthly cash contribution; gross RAS input × 4/5 rounded up to penny per month', input_fields: ['monthly_pension_pence', 'pension_basis'], rule_refs: ['pension-ras'] },
        { id: 'pension_gross', pence: pensionGross, formula: '12 × gross contribution; net RAS input × 5/4 rounded up to penny per month', input_fields: ['monthly_pension_pence', 'pension_basis'], rule_refs: ['pension-ras'] },
    ];
    if (profit !== null && profit >= 0 && profit < rules.ni.class2_small_profit_pence && f.class2_election === 'unknown') issue('class2_unknown', 'Review voluntary Class 2 treatment; no weeks or charge are assumed.');
    if (issues.length === 0 && profit !== null && pensionGross !== null) {
        const trade = floorPound(profit), extension = ceilPound(pensionGross), ani = Math.max(0, trade - extension);
        const allowance = Math.max(0, rules.allowance_pence - floorPound(ratio(Math.max(0, ani - rules.allowance_taper_start_pence), 1, 2)));
        const bands = incomeTaxBands(Math.max(0, trade - allowance), f.jurisdiction, extension, rules);
        incomeTax = sumPence(bands.map(b => b.tax));
        class4 = class4NI(trade, [], rules).pence;
        class2 = 0; // Above SPT: treated paid. Below SPT: only explicit no-voluntary-charge is supported.
        trace.push(
            { id: 'taxable_trade_basis', pence: trade, formula: 'annual profit rounded down to whole pounds', input_fields: ['annual_turnover_pence', 'monthly_costs_pence'], rule_refs: ['income-tax'] },
            { id: 'adjusted_net_income', pence: ani, formula: 'max(0, whole-pound trade profit − gross RAS contribution rounded up to whole pounds)', input_fields: ['monthly_pension_pence', 'pension_basis'], rule_refs: ['income-tax', 'pension-bands'] },
            { id: 'personal_allowance', pence: allowance, formula: '£12,570 less £1 per £2 adjusted net income above £100,000, with whole-pound taper; floor at zero', input_fields: ['jurisdiction'], rule_refs: ['income-tax'] },
            ...bands.map((b, i) => ({ id: 'income_tax_band_' + (i + 1), pence: b.tax, formula: `${b.base} taxable pence × ${b.rate_bps}/10000, rounded down to penny; eligible gross RAS extends bands`, input_fields: ['jurisdiction', 'monthly_pension_pence', 'pension_basis'], rule_refs: [f.jurisdiction === 'scotland' ? 'scottish-tax' : 'income-tax', 'pension-bands'] })),
        );
    }
    const annualTax = incomeTax === null || class4 === null || class2 === null ? null : sumPence([incomeTax, class4, class2]);
    let remaining: number | null = null;
    if (!f.tax_payments_checked || f.tax_paid_pence === null) issue('tax_payments_unknown', 'Review actual payments already allocated to this forecast year; cash reserves are not credits.');
    else if (annualTax !== null) remaining = Math.max(0, annualTax - f.tax_paid_pence);
    const capacity = f.billable_days_per_year === null || f.daily_rate_pence === null ? null : sumPence(Array<number>(f.billable_days_per_year).fill(f.daily_rate_pence));
    if (capacity !== null && f.annual_turnover_pence !== null && capacity < f.annual_turnover_pence)
        issue('turnover_capacity_gap', 'Entered billable days and daily rate do not cover the turnover forecast. Resolve the gap before relying on drawings.');
    trace.push(
        { id: 'income_tax', pence: incomeTax, formula: 'sum of applicable non-savings income-tax bands', input_fields: ['jurisdiction'], rule_refs: ['income-tax', 'scottish-tax'] },
        { id: 'class4', pence: class4, formula: '6% of whole-pound profit over £12,570 to £50,270, plus 2% above; no pension deduction or employment NI assumed', input_fields: ['annual_turnover_pence', 'monthly_costs_pence', 'supported_tax_scope_checked'], rule_refs: ['self-employed-ni'] },
        { id: 'class2', pence: class2, formula: 'No cash charge above £7,105; below that only an explicit no-voluntary-charge decision is supported', input_fields: ['class2_election'], rule_refs: ['self-employed-ni'] },
        { id: 'annual_tax', pence: annualTax, formula: 'income tax + Class 4 + Class 2; annual scenario, not an HMRC demand', input_fields: ['supported_tax_scope_checked'], rule_refs: ['income-tax', 'self-employed-ni'] },
        { id: 'remaining_tax', pence: remaining, formula: 'max(0, annual scenario tax − checked actual payments already allocated to this year); reserve cash is not a credit', input_fields: ['tax_paid_pence', 'tax_payments_checked'], rule_refs: ['poa'] },
    );
    return {
        ruleset_id: rules.id, status: issues.length ? 'incomplete' : 'estimate', issues, trace,
        class2_treatment: class2 === null ? 'unresolved' : profit! >= rules.ni.class2_small_profit_pence ? 'treated_paid_without_cash_charge' : 'explicit_no_voluntary_charge', profit_pence: profit,
        pension_cash_pence: pensionCash, pension_gross_pence: pensionGross, income_tax_pence: incomeTax,
        class4_pence: class4, class2_pence: class2, annual_tax_pence: annualTax, remaining_tax_pence: remaining,
        following_year_poa_each_pence: annualTax === null ? null : paymentsOnAccount(annualTax, 0, rules).each,
        balancing_date: `${f.tax_year_start + 2}-01-31`, following_first_poa_date: `${f.tax_year_start + 2}-01-31`, following_second_poa_date: `${f.tax_year_start + 2}-07-31`,
        required_daily_rate_pence: f.annual_turnover_pence === null || f.billable_days_per_year === null ? null : ratio(f.annual_turnover_pence, 1, f.billable_days_per_year, true),
        required_billable_days: f.annual_turnover_pence === null || f.daily_rate_pence === null || f.daily_rate_pence === 0 ? null : ratio(f.annual_turnover_pence, 1, f.daily_rate_pence, true),
        billable_capacity_turnover_pence: capacity, turnover_gap_pence: f.annual_turnover_pence === null || capacity === null ? null : sumPence([f.annual_turnover_pence, -capacity]),
    };
}
export type CashflowRow = { date: string; receipts_pence: number; business_costs_pence: number; pension_cash_pence: number; drawings_pence: number; obligations_pence: number; closing_cash_pence: number; protected_pence: number; free_cash_pence: number };
export type PlanResult = {
    engine_version: string; caveat: string; evaluated_on: string; status: 'incomplete' | 'estimate'; issues: PlanningIssue[];
    actual_cash_pence: number | null; liabilities_pence: number | null; net_cash_pence: number | null;
    pension_assets_pence: number | null; restricted_assets_pence: number | null; actual_tax_reserve_pence: number;
    business_buffer_pence: number; emergency_buffer_pence: number; required_tax_protection_pence: number | null;
    additional_tax_reserve_pence: number | null; current_free_cash_pence: number | null; additional_drawings_ceiling_pence: number | null;
    forecast: ForecastResult; cashflow: CashflowRow[];
};
/** Uses a supplied evaluation date, retained in a snapshot, rather than changing old results with today's clock. */
export function evaluatePlan(value: unknown, evaluatedOn: string): PlanResult {
    const p = validatePlan(value), evaluated = planningDate(evaluatedOn), forecast = forecastAnnual(p.forecast);
    const issues: PlanningIssue[] = [...forecast.issues], issue = (code: string, message: string) => issues.push({ code, message });
    if (p.as_of > evaluated) issue('future_balance', 'Actual balances cannot be dated in the future.');
    else if (p.as_of < evaluated) issue('stale_balance', 'Refresh balances before relying on current drawings. Historical inputs remain visible.');
    if (!p.cash_complete) issue('cash_incomplete', 'Confirm all accessible cash and debts are included.');
    if (!p.unique_assets_checked) issue('physical_identity_unchecked', 'Confirm manual entries are distinct physical assets, not duplicate pots within an account.');
    if (!p.commitments_complete) issue('commitments_incomplete', 'Review all remaining unpaid obligations, including prior/current-year HMRC demands, without duplicating monthly costs or debts.');
    if (!p.cashflow_assumptions_checked) issue('cashflow_unreviewed', 'Confirm future receipts, costs, pension and drawings occur on the fifth of each future month; balances already include all earlier movements.');
    const totals = (kind: Asset['kind']) => {
        const assets = p.assets.filter(a => a.kind === kind);
        return assets.some(a => a.balance_pence === null) ? null : sumPence(assets.map(a => a.balance_pence!));
    };
    const cash = totals('cash'), debt = totals('liability'), netCash = cash === null || debt === null ? null : sumPence([cash, -debt]);
    if (netCash === null) issue('cash_unknown', 'An accessible cash or debt balance is unknown.');
    const reserve = sumPence(p.earmarks.filter(e => e.purpose === 'tax_reserve').map(e => e.amount_pence));
    const buffer = (purpose: Earmark['purpose']) => sumPence(p.earmarks.filter(e => e.purpose === purpose).map(e => e.amount_pence));
    const business = buffer('business_buffer'), emergency = buffer('emergency_buffer');
    if (p.earmarks.some(e => e.purpose === 'tax_reserve' && e.tax_year_start === null && e.amount_pence > 0)) issue('reserve_year_unknown', 'Allocate actual tax cash to tax years before estimating drawings.');
    if (p.obligations.some(o => o.amount_pence === null || (o.kind === 'tax' && o.tax_year_start === null))) issue('obligation_unknown', 'Resolve unpaid obligation amounts and tax years.');
    if (p.obligations.some(o => o.due_date <= p.as_of && o.amount_pence !== 0)) issue('overdue_obligation', 'Review the timing of remaining unpaid obligations already due; projected payment timing is unresolved.');
    const start = `${p.forecast.tax_year_start}-04-06`, end = `${p.forecast.tax_year_start + 1}-04-05`;
    if (p.as_of < start || p.as_of > end) issue('cashflow_year_mismatch', 'The balance date must be inside the forecast tax year.');
    if (p.forecast.monthly_drawings_pence === null) issue('drawings_unknown', 'Enter proposed monthly drawings, including an explicit zero if none.');
    // A known reserve and a liability protect the same cash once: max, never reserve + whole liability.
    const protection = (paid: Set<string>) => {
        const years = new Set<number>([p.forecast.tax_year_start]);
        for (const e of p.earmarks) if (e.purpose === 'tax_reserve' && e.tax_year_start !== null) years.add(e.tax_year_start);
        for (const o of p.obligations) if (o.kind === 'tax' && o.tax_year_start !== null) years.add(o.tax_year_start);
        let required = 0, additional = 0, protectedTax = 0;
        for (const y of years) {
            const paidTax = sumPence(p.obligations.filter(o => paid.has(o.id) && o.kind === 'tax' && o.tax_year_start === y).map(o => o.amount_pence!));
            const earmarked = Math.max(0, sumPence(p.earmarks.filter(e => e.purpose === 'tax_reserve' && e.tax_year_start === y).map(e => e.amount_pence)) - paidTax);
            const knownUnpaid = sumPence(p.obligations.filter(o => !paid.has(o.id) && o.kind === 'tax' && o.tax_year_start === y).map(o => o.amount_pence!));
            const forecastRemaining = y === p.forecast.tax_year_start ? Math.max(0, forecast.remaining_tax_pence! - paidTax) : 0;
            const need = Math.max(knownUnpaid, forecastRemaining);
            required = sumPence([required, need]); additional = sumPence([additional, Math.max(0, need - earmarked)]);
            protectedTax = sumPence([protectedTax, Math.max(earmarked, need)]);
        }
        const other = sumPence(p.obligations.filter(o => !paid.has(o.id) && o.kind === 'other').map(o => o.amount_pence!));
        return { required, additional, total: sumPence([protectedTax, business, emergency, other]) };
    };
    let required: number | null = null, additional: number | null = null, free: number | null = null, ceiling: number | null = null;
    const rows: CashflowRow[] = [];
    if (!issues.length && netCash !== null && forecast.remaining_tax_pence !== null) {
        const paid = new Set<string>(), initial = protection(paid);
        required = initial.required; additional = initial.additional; free = sumPence([netCash, -initial.total]);
        let balance = cash!, minimum = free;
        // Twelve tax-year months end on May 5 ... April 5; distribute every annual receipt penny exactly once.
        for (let i = 0; i < 12; i++) {
            const date = new Date(Date.UTC(p.forecast.tax_year_start, 4 + i, 5)).toISOString().slice(0, 10);
            if (date <= p.as_of || date > end) continue;
            const receipts = Math.floor(p.forecast.annual_turnover_pence! / 12) + (i < p.forecast.annual_turnover_pence! % 12 ? 1 : 0);
            const due = p.obligations.filter(o => !paid.has(o.id) && o.due_date <= date);
            const payments = sumPence(due.map(o => o.amount_pence!));
            due.forEach(o => paid.add(o.id));
            const pension = forecast.pension_cash_pence! / 12, costs = p.forecast.monthly_costs_pence!, drawings = p.forecast.monthly_drawings_pence!;
            balance = sumPence([balance, receipts, -costs, -pension, -drawings, -payments]);
            // Keep physical closing cash distinct from the hold for existing debts.
            const held = sumPence([protection(paid).total, debt!]), available = sumPence([balance, -held]);
            minimum = Math.min(minimum, available);
            rows.push({ date, receipts_pence: receipts, business_costs_pence: costs, pension_cash_pence: pension, drawings_pence: drawings, obligations_pence: payments, closing_cash_pence: balance, protected_pence: held, free_cash_pence: available });
        }
        ceiling = Math.max(0, minimum);
    }
    return { engine_version: rules.engine_version, caveat: PLAN_CAVEAT, evaluated_on: evaluated, status: issues.length ? 'incomplete' : 'estimate', issues,
        actual_cash_pence: cash, liabilities_pence: debt, net_cash_pence: netCash, pension_assets_pence: totals('pension'), restricted_assets_pence: totals('restricted'),
        actual_tax_reserve_pence: reserve, business_buffer_pence: business, emergency_buffer_pence: emergency,
        required_tax_protection_pence: required, additional_tax_reserve_pence: additional, current_free_cash_pence: free, additional_drawings_ceiling_pence: ceiling, forecast, cashflow: rows };
}

import {receiptCashEffect,type ReceiptDimensions} from './receipt-cash';
import { positive, floorPound, ceilPound, exact, ratio, incomeTaxBands, class4NI, paymentsOnAccount } from './arithmetic';
export { ratio, incomeTaxBands, class4NI, paymentsOnAccount } from './arithmetic';
import { sumPence } from '../money';
import { factKinds, validateFact, validateProfile, type TaxFact, type TaxProfileRevision } from './facts';
import { validateScope, type CalculationScope } from './scope';
import { rules2025, type TaxRules } from './rules';
import { parseInvoiceCurrencyCoverage, invoiceCoverageBlocks, INVOICE_COVERAGE_LIMITATION, type InvoiceCurrencyCoverage } from '../invoices/currency-coverage';
import { bankAccountingTaxScope } from './bank-accounting-scope';
import type { BankAccountingCoverageInput } from '../records/bank-accounting-coverage';
import {bankTaxScope,BANK_TAX_LIMITATION,type TaxBankCoverage} from './bank-source-coverage';
export type CalculationRecord = {
    id: string;
    record_type: 'income' | 'expense';
    record_date: string;
    amount_pence: number;
    effect_sign: 1 | -1;
    status: string;
    category: {
        id: string;
        name: string;
        record_type: string;
        sa103_box: string | null;
        valid: boolean;
    } | null;
    bank_transaction_id: string | null;
    refund_link_id?: string | null;
    project_id?: string | null;
    original_bank_transaction_id: string | null;
    source_type: string;
    receipt_dimensions?: ReceiptDimensions|null;
};
export type Observation = {
    account_id: string;
    account: {
        id: string;
        provider: string;
        account_type: string;
        masked_identifier: string;
    };
    id: string;
    import_id: string;
    source_row_id: string;
    file_hash: string;
    row_hash: string;
    row_number: number;
    transaction_date: string;
    signed_amount_pence: number | null;
    currency: string;
    classification: string;
    decision_version: number;
    business_use_bps: number;
    dedupe_status: string;
    import_status: string;
    recognized_pence: number;
    has_financial_dependencies: boolean;
};
export type CalculationSource = {
    id: string;
    revision_id: string;
    document_id: string | null;
    transaction_id: string | null;
    record_id: string | null;
    snapshot: Record<string, unknown>;
    current_recognized_pence: number;
    source_unresolved: boolean;
};
export type CalculationSection = {
    id: string;
    kind: string;
    verdict: string;
    fact_digest: string;
    is_current: boolean;
};
export type CalculationInput = {
    owner_id: string;
    tax_year_start: number;
    financial_stamp: string;
    profile: TaxProfileRevision | null;
    scope: CalculationScope | null;
    facts: TaxFact[];
    sections: CalculationSection[];
    sources: CalculationSource[];
    records: CalculationRecord[];
    observations: Observation[];
} & ({ schema_version: 'tax-calculation-input/1'; invoice_coverage?: never } | { schema_version: 'tax-calculation-input/2'; invoice_coverage: InvoiceCurrencyCoverage } | {schema_version:'tax-calculation-input/3';invoice_coverage:InvoiceCurrencyCoverage;bank_source_coverage:TaxBankCoverage} | {schema_version:'tax-calculation-input/4'|'tax-calculation-input/5';invoice_coverage:InvoiceCurrencyCoverage;bank_source_coverage:BankAccountingCoverageInput});
export type CalculationIssue = {
    code: string;
    message: string;
    severity: 'blocking' | 'review';
    source_ids: string[];
};
export type CalculationTrace = {
    id: string;
    label: string;
    pence: number | null;
    formula: string;
    source_ids: string[];
    rule_refs: string[];
};
export type CalculationResult = {
    engine_version: string;
    ruleset_id: string;
    tax_year_start: number;
    status: 'incomplete' | 'estimate';
    document_status: string;
    caveat: string;
    issues: CalculationIssue[];
    trace: CalculationTrace[];
    totals: Record<string, number | null>;
    deadlines: {
        balancing: string;
        first_poa: string;
        second_poa: string;
    };
    class2_treatment: string;
};
export function calculateTax(input: CalculationInput, rules: TaxRules = rules2025): CalculationResult {
    if (!['tax-calculation-input/1', 'tax-calculation-input/2','tax-calculation-input/3','tax-calculation-input/4','tax-calculation-input/5'].includes(input.schema_version) || !Number.isInteger(input.tax_year_start) || !input.owner_id)
        throw new Error('Invalid calculation input schema.');
    const year = input.tax_year_start, issues: CalculationIssue[] = [], trace: CalculationTrace[] = [], totals: Record<string, number | null> = {}, issue = (code: string, message: string, ids: string[] = [], severity: 'blocking' | 'review' = 'blocking') => issues.push({ code, message, severity, source_ids: ids }), line = (id: string, label: string, pence: number | null, formula: string, ids: string[] = [], refs: string[] = ['hmrc-calculation']) => {
        if (pence !== null)
            exact(pence);
        trace.push({ id, label, pence, formula, source_ids: ids, rule_refs: refs });
        totals[id] = pence;
    };
    let tradeReady = true, incomeReady = true, niReady = true, paymentsReady = true;
    const coverage = input.schema_version !== 'tax-calculation-input/1' ? parseInvoiceCurrencyCoverage(input.invoice_coverage, input.owner_id) : null;
    const invoiceCoverageBlocked = coverage !== null && invoiceCoverageBlocks(coverage);
    if (invoiceCoverageBlocked) {
        issue('invoice_currency_coverage', INVOICE_COVERAGE_LIMITATION, coverage!.invoices.filter(i => i.representation !== 'native_gbp').map(i => i.id));
        tradeReady = incomeReady = niReady = false;
    }
    const accountingBank=(input.schema_version==='tax-calculation-input/4'||input.schema_version==='tax-calculation-input/5')?bankAccountingTaxScope(input,input.bank_source_coverage):null;
    const bank=input.schema_version==='tax-calculation-input/3'?bankTaxScope(input,input.bank_source_coverage):accountingBank;
    if(bank?.blocks){issue('bank_source_coverage',BANK_TAX_LIMITATION,bank.blocked_ids);tradeReady=incomeReady=niReady=paymentsReady=false;}
    const profile = input.profile, scope = input.scope;
    const d = profile?.data, s = scope?.data;
    if (year !== rules.tax_year_start) {
        issue('unsupported_year', 'No reviewed ruleset for this tax year.');
        tradeReady = incomeReady = niReady = paymentsReady = false;
    }
    if (!profile || profile.state !== 'reviewed') {
        issue('profile_missing', 'Review the tax-year profile.');
        tradeReady = incomeReady = niReady = false;
    }
    else {
        validateProfile(d, true);
        if (!profile.ledger_is_current || d!.ledger_completeness !== 'complete') {
            issue('ledger_review_stale', 'Recheck ledger completeness after financial inputs changed.', [profile.id]);
            tradeReady = incomeReady = niReady = false;
        }
    }
    if (d && (d.accounting_basis !== 'cash' || d.business_structure !== 'sole_trader' || d.vat_registered !== 'no' || d.residency !== 'uk_full_year' || d.special_reliefs !== 'none')) {
        issue('profile_requires_branch', 'This profile needs an additional accounting, VAT, residence, structure or special-relief branch.', profile ? [profile.id] : []);
        tradeReady = incomeReady = niReady = false;
    }
    if (d && d.student_loan !== 'none') {
        issue('loan_branch', 'Student/postgraduate loan repayment calculation remains required.', profile ? [profile.id] : []);
        incomeReady = false;
    }
    if (!scope || scope.state !== 'reviewed' || !scope.is_current) {
        issue('scope_missing', 'Review NI, pension, trading and source-identity scope.');
        tradeReady = incomeReady = niReady = paymentsReady = false;
    }
    else
        validateScope(s, 'reviewed');
    const verified = input.facts.filter(f => f.state === 'verified'), active = input.facts.filter(f => !['withdrawn', 'excluded'].includes(f.state));
    for (const f of input.facts) {
        if (f.tax_year_start !== year)
            throw new Error('Cross-year fact in calculation.');
        validateFact(f.kind, f.data, year, f.state);
    }
    for (const kind of factKinds) {
        const section = input.sections.find(c => c.kind === kind);
        if (!section?.is_current || !['none', 'complete'].includes(section.verdict)) {
            issue('section_' + kind, `Review the ${kind.replaceAll('_', ' ')} collection.`, section ? [section.id] : []);
            if (kind === 'tax_payment')
                paymentsReady = false;
            else
                incomeReady = false;
            if (['vehicle', 'trade_adjustment', 'employment'].includes(kind))
                tradeReady = niReady = false;
        }
    }
    for (const f of active.filter(f => f.state === 'provisional')) {
        issue('provisional_fact', 'A provisional fact cannot be treated as a known amount.', [f.id]);
        if (f.kind === 'tax_payment')
            paymentsReady = false;
        else
            incomeReady = false;
        if (['vehicle', 'trade_adjustment'].includes(f.kind))
            tradeReady = niReady = false;
    }
    const sourceByFact = (id: string) => input.sources.filter(source => source.revision_id === id), factsOf = (kind: string) => verified.filter(f => f.kind === kind), amount = (f: TaxFact, key: string) => exact(f.data[key]);
    for (const f of verified) {
        const sources = sourceByFact(f.id);
        if (!sources.length) {
            issue('missing_fact_source', 'Verified fact source is missing.', [f.id]);
            incomeReady = false;
            if (['vehicle', 'trade_adjustment'].includes(f.kind))
                tradeReady = niReady = false;
            if (f.kind === 'tax_payment')
                paymentsReady = false;
        }
        if (sources.some(source => source.source_unresolved)) {
            issue('stale_fact_source', 'A fact source changed or was reversed after review.', [f.id]);
            incomeReady = false;
            if (['vehicle', 'trade_adjustment'].includes(f.kind))
                tradeReady = niReady = false;
            if (f.kind === 'tax_payment')
                paymentsReady = false;
        }
        if (!['vehicle', 'trade_adjustment'].includes(f.kind) && sources.some(source => source.current_recognized_pence !== 0)) {
            issue('nontrading_overlap', 'A non-trading fact source is still included in business income/expenses. Correct it explicitly.', [f.id, ...sources.flatMap(source => source.transaction_id ? [source.transaction_id] : source.record_id ? [source.record_id] : [])]);
            tradeReady = incomeReady = niReady = false;
        }
    }
    for (const o of input.observations) {
        if (o.import_status === 'discarded' || o.dedupe_status === 'duplicate')
            continue;
        if (o.classification === 'Unknown' || o.dedupe_status !== 'clear' || (['Transfer', 'Refund'].includes(o.classification) && !o.has_financial_dependencies)) {
            issue('unresolved_observation', 'An unmatched/unclassified source remains; it is not silently claimed.', [o.id]);
            tradeReady = incomeReady = niReady = false;
        }
        if (o.currency !== 'GBP' && !accountingBank?.eligible(o.id)) {
            issue('currency_branch', 'Review foreign currency and FX provenance.', [o.id]);
            tradeReady = incomeReady = niReady = false;
        }
    }
    const receiptAware=input.schema_version==='tax-calculation-input/5';
    const cashEffect=(r:CalculationRecord)=>receiptAware?receiptCashEffect(r):r.status==='approved'?r.amount_pence*r.effect_sign:null;
    const records = input.records.filter(r => cashEffect(r)!==null);
    for (const r of input.records) {
        exact(r.amount_pence);
        if (r.amount_pence < 0 || ![1, -1].includes(r.effect_sign))
            throw new Error('Invalid ledger effect.');
        if (['review', 'draft'].includes(r.status)) {
            issue('unreviewed_record', 'A trading record still needs review.', [r.id]);
            tradeReady = incomeReady = niReady = false;
        }
        if(receiptAware&&r.status==='approved'&&r.receipt_dimensions&&r.receipt_dimensions.currency!=='GBP'){
            issue('receipt_currency','Review the original currency and GBP valuation before recognising this receipt.',[r.id]);
            tradeReady=incomeReady=niReady=false;
        }
        if (cashEffect(r)!==null && r.record_type === 'expense' && (!r.category || !r.category.valid)) {
            issue('unreviewed_category', 'Review the approved expense category and its meaning.', [r.id]);
            tradeReady = incomeReady = niReady = false;
        }
        if (r.status === 'approved' && r.source_type !== 'manual' && !r.bank_transaction_id) {
            issue('legacy_source_link', 'Imported/invoice-derived record lacks a preserved receipt/source link; review duplication and provenance.', [r.id]);
            tradeReady = incomeReady = niReady = false;
        }
    }
    const effect = (r: CalculationRecord) => cashEffect(r)??0;
    const income = sumPence(records.filter(r => r.record_type === 'income').map(effect)), expenses = sumPence(records.filter(r => r.record_type === 'expense').map(effect));
    line('ledger_income', 'Recognised trading income', income, receiptAware?'Sum approved GBP cash income; unpaid receipts excluded':'Sum signed approved income records', records.filter(r => r.record_type === 'income').map(r => r.id), ['hmrc-cash']);
    line('ledger_expenses', 'Candidate trading expenses', expenses, receiptAware?'Sum approved GBP cash expenses less refunds; unpaid receipts excluded; tax treatment still subject to review':'Sum signed approved expense records; tax treatment still subject to review', records.filter(r => r.record_type === 'expense').map(r => r.id), ['hmrc-cash']);
    if (s && (s.trade_treatment !== 'reviewed_no_unmodelled_adjustments' || s.cash_dates !== 'bank_posting_dates_reviewed')) {
        issue('trade_scope', 'Review tax eligibility and cash-date conventions.');
        tradeReady = incomeReady = niReady = false;
    }
    if (s && s.ni_adjustments !== 'none') {
        issue('ni_adjustments', 'NIC-specific adjustments/transition profits need a separate reviewed branch.');
        niReady = false;
    }
    const relatedRecords = (f: TaxFact) => {
        const sources = sourceByFact(f.id), recordIds = new Set(sources.flatMap(source => source.record_id ? [source.record_id] : [])), bankIds = new Set(sources.flatMap(source => source.transaction_id ? [source.transaction_id] : []));
        for (const r of records)
            if (recordIds.has(r.id) && r.bank_transaction_id)
                bankIds.add(r.bank_transaction_id);
        return records.filter(r => r.record_type === 'expense' && (recordIds.has(r.id) || (r.bank_transaction_id !== null && bankIds.has(r.bank_transaction_id)) || (r.original_bank_transaction_id !== null && bankIds.has(r.original_bank_transaction_id))));
    };
    let vehicleDelta = 0;
    const usedCosts = new Set<string>();
    const vehicles = factsOf('vehicle');
    if (s && ((vehicles.length > 0 && s.vehicle_scope !== 'all_costs_method_history_and_capital_checked') || (vehicles.length === 0 && s.vehicle_scope !== 'none'))) {
        issue('vehicle_scope', 'Confirm vehicle-cost coverage, eligibility and method history.');
        tradeReady = incomeReady = niReady = false;
    }
    for (const v of vehicles) {
        const costs = relatedRecords(v);
        if (costs.some(r => usedCosts.has(r.id))) {
            issue('vehicle_cost_reuse', 'A cost is linked to multiple vehicle elections.', [v.id]);
            tradeReady = incomeReady = niReady = false;
        }
        costs.forEach(r => usedCosts.add(r.id));
        if (v.data.method === 'simplified_mileage') {
            const miles = amount(v, 'business_miles_hundredths');
            let claim = 0;
            if (['car', 'van'].includes(String(v.data.vehicle_type))) {
                const first = Math.min(miles, rules.mileage.car_van_first_miles_hundredths);
                claim = sumPence([ratio(first, rules.mileage.car_van_first_pence_per_mile, 100), ratio(miles - first, rules.mileage.car_van_later_pence_per_mile, 100)]);
            }
            else if (v.data.vehicle_type === 'motorcycle')
                claim = ratio(miles, rules.mileage.motorcycle_pence_per_mile, 100);
            else {
                issue('bicycle_mileage', 'Sole-trader bicycles require actual-cost treatment.', [v.id]);
                tradeReady = incomeReady = niReady = false;
            }
            const removed = sumPence(costs.map(effect));
            vehicleDelta = sumPence([vehicleDelta, claim, -removed]);
            line('vehicle_' + v.id, 'Mileage replaces linked actual costs', claim - removed, `${miles}/100 business miles; remove linked signed costs ${removed}p, add mileage ${claim}p; business miles are not multiplied by private-use percentage`, [v.id, ...costs.map(r => r.id)], ['hmrc-mileage']);
        }
        else
            line('vehicle_' + v.id, 'Actual-cost election retained', sumPence(costs.map(effect)), 'Existing mixed-use signed effects retained once; not apportioned again', [v.id, ...costs.map(r => r.id)], ['hmrc-cash']);
    }
    let adjustment = 0;
    const adjustments = factsOf('trade_adjustment'), allowances = adjustments.filter(f => f.data.adjustment_type === 'trading_allowance');
    if (allowances.length > 1 || sumPence(allowances.map(f => amount(f, 'amount_pence'))) > 100000) {
        issue('trading_allowance_limit', 'Review the single trading-allowance election and £1,000 annual limit.', allowances.map(f => f.id));
        tradeReady = incomeReady = niReady = false;
    }
    for (const f of adjustments.filter(f => f.data.adjustment_type !== 'trading_allowance')) {
        const n = amount(f, 'amount_pence'), kind = f.data.adjustment_type;
        if (kind === 'loss_brought_forward') {
            issue('loss_ni_branch', 'Loss carry-forward needs reviewed trade-specific Income Tax/NI treatment.', [f.id]);
            tradeReady = incomeReady = niReady = false;
            continue;
        }
        if (allowances.length) {
            issue('allowance_expense_conflict', 'Trading allowance cannot be combined with actual expense/allowance deductions.', [f.id, ...allowances.map(a => a.id)]);
            tradeReady = incomeReady = niReady = false;
        }
        const costs = relatedRecords(f);
        if (kind === 'add_back') {
            adjustment = sumPence([adjustment, n]);
            line('adjustment_' + f.id, 'Reviewed add-back', n, 'Increase candidate profit by the reviewed disallowance', [f.id, ...costs.map(r => r.id)]);
        }
        else {
            if (costs.some(r => usedCosts.has(r.id))) {
                issue('adjustment_cost_reuse', 'A cost is claimed by another vehicle/adjustment.', [f.id]);
                tradeReady = incomeReady = niReady = false;
            }
            costs.forEach(r => usedCosts.add(r.id));
            const removed = sumPence(costs.map(effect));
            adjustment = sumPence([adjustment, removed, -n]);
            line('adjustment_' + f.id, 'Reviewed deduction replaces linked costs', removed - n, `Remove linked cost deduction ${removed}p, then apply reviewed ${kind} ${n}p`, [f.id, ...costs.map(r => r.id)]);
        }
    }
    const rawProfit = allowances.length ? income - Math.min(positive(income), amount(allowances[0], 'amount_pence')) : sumPence([income, -expenses, -vehicleDelta, adjustment]);
    if (allowances.length && vehicles.some(v => v.data.method === 'simplified_mileage')) {
        issue('allowance_mileage_conflict', 'Do not combine trading allowance and vehicle mileage.', allowances.map(f => f.id));
        tradeReady = incomeReady = niReady = false;
    }
    line('trade_profit', 'Candidate adjusted trading profit', invoiceCoverageBlocked || bank?.blocks ? null : rawProfit, allowances.length ? 'Trading receipts less elected allowance; actual expenses are not also deducted' : 'Income − candidate expenses − net mileage substitution + reviewed adjustments', records.map(r => r.id));
    if (rawProfit < 0) {
        issue('trading_loss', 'Review loss relief/election; do not silently assume a loss claim or zero profits.');
        tradeReady = incomeReady = niReady = false;
    }
    const tradeBase = floorPound(positive(rawProfit));
    line('taxable_trade_profit', 'Trading base after whole-pound rounding', tradeReady ? tradeBase : null, 'Floor positive adjusted profit to whole pounds for calculation-stage trade/NI input', records.map(r => r.id));
    if (!tradeReady)
        incomeReady = niReady = false;
    const employment = factsOf('employment'), termination = factsOf('termination'), pensions = factsOf('pension'), other = factsOf('other_income'), gifts = factsOf('gift_aid'), payments = factsOf('tax_payment');
    const scopeMatches = (count: number, value: string | undefined, required: string, code: string) => {
        if (value !== (count ? required : 'none')) {
            issue(code, 'Review distinct fact identities and collection scope.');
            return false;
        }
        return true;
    };
    if (s && !scopeMatches(employment.length, s.employment_scope, 'distinct_employments_cumulative_totals_checked', 'employment_identity'))
        incomeReady = niReady = false;
    if (s && !scopeMatches(termination.length, s.termination_scope, 'separate_taxable_pay_and_withholding_checked', 'termination_overlap'))
        incomeReady = false;
    if (s && !scopeMatches(payments.length, s.payments_scope, 'distinct_identified_allocations_checked', 'payment_identity'))
        paymentsReady = false;
    if (s && !scopeMatches(gifts.length, s.gift_aid_scope, 'eligibility_and_tax_cover_checked', 'gift_aid_scope'))
        incomeReady = false;
    if (pensions.length && s?.pension_scope !== 'eligible_registered_under75_no_unmodelled_charge') {
        issue('pension_eligibility', 'Review pension eligibility, registration, age and any annual-allowance/MPAA charge.', pensions.map(f => f.id));
        incomeReady = false;
    }
    if (!pensions.length && s && s.pension_scope !== 'none') {
        issue('pension_scope', 'Confirm whether any pension contributions exist.');
        incomeReady = false;
    }
    if (pensions.some(f => ['net_pay', 'salary_sacrifice'].includes(String(f.data.method))) && s?.net_pay_scope !== 'already_reflected_in_taxable_pay') {
        issue('net_pay_double_relief', 'Confirm net-pay/salary-sacrifice relief is already reflected in taxable pay.', pensions.map(f => f.id));
        incomeReady = false;
    }
    if (other.some(f => !['other_non_savings', 'pension_income'].includes(String(f.data.income_type)))) {
        issue('other_income_branch', 'Savings/dividend/property/foreign income needs its specific tax branch.', other.map(f => f.id));
        incomeReady = false;
    }
    const employmentPay = sumPence(employment.map(f => floorPound(amount(f, 'taxable_pay_pence')))), terminationPay = sumPence(termination.map(f => floorPound(amount(f, 'taxable_pence')))), otherPay = sumPence(other.filter(f => ['other_non_savings', 'pension_income'].includes(String(f.data.income_type))).map(f => floorPound(amount(f, 'gross_pence'))));
    line('employment_taxable_pay', 'Employment taxable pay', employmentPay, 'Sum each employment after rounding its taxable pay down to pounds', employment.map(f => f.id));
    line('termination_taxable_pay', 'Separate taxable termination components', terminationPay, 'Only reviewed taxable components, separate from employment totals', termination.map(f => f.id));
    const grossIncome = sumPence([tradeBase, employmentPay, terminationPay, otherPay]), rasGross = ceilPound(sumPence(pensions.filter(f => f.data.method === 'relief_at_source').map(f => amount(f, 'gross_contribution_pence')))), earnings = sumPence([tradeBase, employmentPay]), eligibleRas = Math.min(rasGross, Math.max(rules.minimum_pension_earnings_pence, earnings));
    if (rasGross > 0 && terminationPay > 0) {
        issue('termination_pension_earnings', 'Review whether termination components are relevant UK earnings before applying pension relief.', termination.map(f => f.id));
        incomeReady = false;
    }
    if (rasGross > eligibleRas) {
        issue('pension_earnings_cap', 'Gross RAS contribution exceeds the supported relevant-earnings cap; review excess relief/charges.', pensions.map(f => f.id));
        incomeReady = false;
    }
    const giftNet = ceilPound(sumPence(gifts.map(f => amount(f, 'net_donation_pence')))), giftGross = ceilPound(ratio(giftNet, 5, 4, true)), extension = sumPence([eligibleRas, giftGross]), ani = sumPence([grossIncome, -extension]), allowance = positive(rules.allowance_pence - floorPound(ratio(positive(ani - rules.allowance_taper_start_pence), 1, 2))), taxable = positive(grossIncome - allowance);
    line('pension_band_extension', 'Eligible gross RAS pension relief', incomeReady ? eligibleRas : null, 'Gross contribution ceiling to pounds, capped by greater of £3,600 and supported relevant UK earnings; not a trading expense', pensions.map(f => f.id), ['hmrc-pension', 'hmrc-calculation']);
    line('gift_aid_gross', 'Gross Gift Aid band extension', incomeReady ? giftGross : null, 'Round total eligible net donations up to pounds; gross ×5/4 and round up to pounds', gifts.map(f => f.id));
    line('adjusted_net_income', 'Adjusted net income', incomeReady ? ani : null, 'Taxable income before allowance minus eligible gross RAS/Gift Aid extension', verified.map(f => f.id));
    line('personal_allowance', 'Personal Allowance', incomeReady ? allowance : null, '£12,570 less floor-to-pound of half ANI above £100,000, minimum zero', profile ? [profile.id] : []);
    const bands = incomeTaxBands(taxable, d?.jurisdiction ?? 'england_wales_ni', extension, rules);
    bands.forEach((b, i) => line('income_band_' + i, `Income Tax band ${i + 1}`, incomeReady ? b.tax : null, `${b.base}p × ${b.rate_bps}/10000, floor pennies`, verified.map(f => f.id), ['hmrc-calculation', ...(d?.jurisdiction === 'scotland' ? ['hmrc-scotland'] : [])]));
    const incomeTax = sumPence(bands.map(b => b.tax));
    line('income_tax', 'Income Tax estimate', incomeReady ? incomeTax : null, 'Sum supported non-savings tax bands after allowance and band extension', verified.map(f => f.id));
    let ni: number | null = null, c2: number | null = null, class2Treatment = 'Unresolved';
    if (niReady) {
        if (s?.class4_status === 'exempt')
            ni = 0;
        else if (s?.class4_status !== 'not_exempt') {
            issue('ni_status', 'Review Class 4 exemption/age applicability.');
        }
        else if (tradeBase > rules.ni.lower_pence && employment.some(f => f.data.class1_band_earnings_pence == null)) {
            issue('class1_earnings_missing', 'Class 1 NICable PT-to-UEL earnings need separate evidence; taxable PAYE pay cannot establish them.', employment.filter(f => f.data.class1_band_earnings_pence == null).map(f => f.id));
        }
        else {
            const calculation = class4NI(tradeBase, employment.map(f => f.data.class1_band_earnings_pence == null ? 0 : amount(f, 'class1_band_earnings_pence')), rules);
            ni = calculation.pence;
            line('class4_ordinary', 'Class 4 before employment adjustment', calculation.ordinary, '6%/2% portions rounded down separately to pennies');
            line('class4_reg100_cap', 'Reg100 Class 4 cap', calculation.reg100_cap, 'Stage 16 c16.20–31: each Class 1 band earning rounded up to pounds; standard equivalent rounded up to pennies', employment.map(f => f.id));
        }
        if (tradeBase >= rules.ni.class2_small_profit_pence) {
            c2 = 0;
            class2Treatment = 'Treated as paid; no ordinary cash charge.';
            if (s?.class2_election === 'verified_amount' && s.class2_amount_pence)
                issue('class2_treated_paid', 'Declared voluntary amount is not added above the small-profits threshold.', [], 'review');
        }
        else if (s?.class2_election === 'no_voluntary_charge') {
            c2 = 0;
            class2Treatment = 'No voluntary charge elected; entitlement/eligibility remains for review.';
        }
        else if (s?.class2_election === 'verified_amount' && s.class2_amount_pence !== null && scope?.evidence_document_id) {
            c2 = s.class2_amount_pence;
            class2Treatment = 'Explicit evidenced voluntary Class 2 amount; weeks were not assumed.';
        }
        else
            issue('class2_election', 'Review voluntary Class 2 election and separately evidenced amount.');
    }
    line('class4', 'Class 4 NI estimate', ni, 'Lower of ordinary Class 4 and applicable Reg100 cap; exemption explicit', employment.map(f => f.id));
    line('class2', 'Class 2 cash charge', c2, class2Treatment, scope ? [scope.id] : []);
    const withholding = sumPence([...employment, ...termination, ...other].map(f => amount(f, 'income_tax_withheld_pence')));
    line('tax_withheld', 'Income Tax already withheld', incomeReady ? withholding : null, 'Separate PAYE/other income withholding, never Class 1 NI', [...employment, ...termination, ...other].map(f => f.id));
    if (s && s.assessment_adjustments !== 'none') {
        issue('assessment_adjustments', 'Review coding-out, prior-year adjustments, repayments and payment-on-account reduction claims.');
        paymentsReady = false;
    }
    const actual = sumPence(payments.map(f => amount(f, 'allocated_pence')));
    line('actual_tax_payments', 'Actual tax-year payment allocations', paymentsReady ? actual : null, 'Only verified allocated amounts for this tax year; reserves excluded', payments.map(f => f.id), ['hmrc-poa']);
    const liability = incomeReady && ni !== null && c2 !== null ? sumPence([incomeTax, ni, c2]) : null, net = liability === null || !paymentsReady ? null : sumPence([liability, -withholding, -actual]);
    line('assessed_liability', 'Assessed Income Tax and self-employed NI estimate', liability, 'Income Tax + Class 4 + explicit Class 2, before withholding/payments');
    line('net_balance', 'Estimated balance after withholding and actual payments', net, 'Assessed liability − withholding − allocated actual payments; negative indicates potential repayment', payments.map(f => f.id), ['hmrc-poa']);
    const poa = incomeReady && ni !== null && s?.assessment_adjustments === 'none' ? paymentsOnAccount(sumPence([incomeTax, ni]), withholding, rules) : null;
    line('poa_relevant', 'Relevant amount for following-year POA', poa?.relevant ?? null, 'Income Tax + Class 4 − qualifying withholding, minimum zero; exclude Class 2 and actual prior payments', [], ['hmrc-poa']);
    line('poa_each', 'Each ordinary following-year payment on account', poa?.each ?? null, 'Half relevant amount, rounded down to pennies per instalment, unless below £1,000 or below 20% of assessed Income Tax + Class 4; no reduction claim assumed', [], ['hmrc-poa']);
    line('january_combined', 'Estimated January balance plus first following-year POA', net !== null && poa ? sumPence([net, poa.each]) : null, 'Balance after actual payments + first ordinary following-year POA', [], ['hmrc-poa']);
    return { engine_version: rules.engine_version, ruleset_id: rules.id, tax_year_start: year, status: issues.some(i => i.severity === 'blocking') ? 'incomplete' : 'estimate', document_status: 'Draft — not submitted to HMRC', caveat: 'Estimate and review aid, not tax advice, filing approval or HMRC submission. Independent tax review and annual form mapping remain required.', issues, trace, totals, deadlines: { balancing: `${year + 2}-01-31`, first_poa: `${year + 2}-01-31`, second_poa: `${year + 2}-07-31` }, class2_treatment: class2Treatment };
}

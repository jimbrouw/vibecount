import {receiptCashEffect} from './receipt-cash';
import { bankAccountingTaxScope } from './bank-accounting-scope';
import { parseBankAccountingCoverage, type BankAccountingCoverageInput } from '../records/bank-accounting-coverage';
import { parseFxProvenance, type FxProvenance } from '../fx/provenance';
import {bankTaxScope,validateTaxBankObservation,BANK_TAX_LIMITATION,type TaxBankCoverage} from './bank-source-coverage';
import { validateFilingFxContext } from './filing-fx-context';
import { canonicalJson, sha256, verifySavedCalculation, type SavedCalculation } from './snapshot';
import { formMapping2025 as currentMapping, formMapping2025Legacy } from './form-mapping';
import { sumPence } from '../money';
import { formatPounds, signedAmountToWords } from '../invoices/money';
import { escapeCsv } from '../records/export-csv';
import { parseInvoiceCurrencyCoverage, invoiceCoverageBlocks, INVOICE_COVERAGE_LIMITATION, type InvoiceCurrencyCoverage } from '../invoices/currency-coverage';
import { invoiceOriginalAmount } from '../invoices/reporting';
import { fxAggregateReadback } from '../fx/readback';
type Row = {
    id: string;
    [key: string]: unknown;
};
type Event = {
    id: string;
    kind: string;
    data: Record<string, unknown>;
};
export type FilingPackInput = {
    owner_id: string;
    tax_year_start: number;
    calculation: SavedCalculation;
    rules: {
        id: string;
        canonical_json: string;
        sha256: string;
    };
    calculation_is_current: boolean;
    observations: Row[];
    imports: Row[];
    classifications: Row[];
    source_events: Row[];
    invoice_balances: Row[];
    receipt_balances: Row[];
    reconciliation: Event[];
    merchant: Event[];
    documents: Row[];
    document_batches: Row[];
    document_items: Row[];
    invoice_revisions: Row[];
    legacy_changes: Row[];
    legacy_attachments: Row[];
} & ({ schema_version: 'filing-pack-input/1'; invoice_coverage?: never } | { schema_version: 'filing-pack-input/2'; invoice_coverage: InvoiceCurrencyCoverage } | { schema_version: 'filing-pack-input/3'; invoice_coverage: InvoiceCurrencyCoverage; fx_provenance: FxProvenance } | {schema_version:'filing-pack-input/4';invoice_coverage:InvoiceCurrencyCoverage;fx_provenance:FxProvenance;bank_source_coverage:TaxBankCoverage} | {schema_version:'filing-pack-input/5';invoice_coverage:InvoiceCurrencyCoverage;fx_provenance:FxProvenance;bank_source_coverage:BankAccountingCoverageInput} | {schema_version:'filing-pack-input/6';invoice_coverage:InvoiceCurrencyCoverage;fx_provenance:FxProvenance;bank_source_coverage:BankAccountingCoverageInput;documents:(Row & {source_available:boolean})[]});
function hasFilingFx(input:FilingPackInput):input is Extract<FilingPackInput,{schema_version:'filing-pack-input/3'|'filing-pack-input/4'|'filing-pack-input/5'|'filing-pack-input/6'}>{return input.schema_version==='filing-pack-input/3'||input.schema_version==='filing-pack-input/4'||input.schema_version==='filing-pack-input/5'||input.schema_version==='filing-pack-input/6'}
function filingBankConnections(input:FilingPackInput){return input.observations.filter(o=>o.import_status!=='discarded'||o.in_tax_year!==true).map(o=>o.id)}
function hasFilingBank(input:FilingPackInput):input is Extract<FilingPackInput,{schema_version:'filing-pack-input/4'|'filing-pack-input/5'|'filing-pack-input/6'}>{return input.schema_version==='filing-pack-input/4'||input.schema_version==='filing-pack-input/5'||input.schema_version==='filing-pack-input/6'}
function filingBankScope(input:Extract<FilingPackInput,{schema_version:'filing-pack-input/4'|'filing-pack-input/5'|'filing-pack-input/6'}>){return (input.schema_version==='filing-pack-input/5'||input.schema_version==='filing-pack-input/6')?bankAccountingTaxScope(input.calculation.input,input.bank_source_coverage,filingBankConnections(input)):bankTaxScope(input.calculation.input,input.bank_source_coverage,filingBankConnections(input))}
export const filingSteps = ['profile', 'sources', 'income', 'expenses', 'paye', 'other', 'pension', 'estimate', 'exceptions', 'review'] as const;
export type FilingStep = typeof filingSteps[number];
export const stepNames: Record<FilingStep, string> = { profile: 'Profile', sources: 'Sources', income: 'Income', expenses: 'Expenses', paye: 'PAYE', other: 'Redundancy and other income', pension: 'Pension and Gift Aid', estimate: 'Tax estimate', exceptions: 'Exceptions', review: 'Final review' };
export type StepReview = {
    id: string;
    step: FilingStep;
    digest: string;
    data: Record<string, unknown>;
    reason: string;
    author: string;
    created_at: string;
};
export type PackIssue = {
    code: string;
    message: string;
    blocking: boolean;
    source_ids: string[];
};
export type WorksheetLine = {
    id: string;
    form: string;
    box: string | null;
    label: string;
    pence: number | null;
    paper_pounds: number | null;
    rounding: string;
    source_ids: string[];
    note: string;
};
const number = (value: unknown) => { if (!Number.isSafeInteger(value))
    throw new Error('Pack amount must be exact integer pence.'); return value as number; };
const facts = (input: FilingPackInput, kinds: string[]) => input.calculation.input.facts.filter(f => kinds.includes(f.kind) && f.state === 'verified');
const totals = (input: FilingPackInput) => input.calculation.result.totals;
const matchingReceipts = (input: FilingPackInput) => input.receipt_balances.filter(r => r.in_tax_year === true && r.record_status === 'approved' && ['Business', 'Mixed'].includes(String(r.classification)) && number(r.unallocated_pence) > 0 && input.observations.some(o => o.id === r.id && o.record_type === 'income'));
function guardPrivate(value: unknown) { if (!value || typeof value !== 'object')
    return; for (const [key, child] of Object.entries(value)) {
    if (['object_path', 'pdf_path', 'key_id', 'raw_encrypted', 'original_filename', 'original_name_encrypted', 'bank_details'].includes(key))
        throw new Error('Private evidence fields cannot enter a filing pack.');
    guardPrivate(child);
} }
export function validatePackInput(input: FilingPackInput) {
    if (!['filing-pack-input/1', 'filing-pack-input/2', 'filing-pack-input/3','filing-pack-input/4','filing-pack-input/5','filing-pack-input/6'].includes(input.schema_version) || !input.owner_id || input.tax_year_start !== input.calculation.tax_year_start || input.calculation.input.owner_id !== input.owner_id)
        throw new Error('Invalid owned pack input.');
    if (input.schema_version === 'filing-pack-input/6' && input.documents.some(document => typeof document.source_available !== 'boolean'))
        throw new Error('Document source availability must be an explicit boolean.');
    verifySavedCalculation(input.calculation, input.rules);
    if(hasFilingBank(input)){
        if(new Set(input.observations.map(o=>o.id)).size!==input.observations.length)throw new Error('Unique bank source observations required.');
        const bank=filingBankScope(input).bank_source_coverage;
        const byId=new Map(bank.observations.map(r=>[r.id,r]));
        for(const row of input.observations){const source=byId.get(row.id)!;validateTaxBankObservation(row,source);if(row.in_tax_year!==(source.tax_year_start===input.tax_year_start))throw new Error('Bank observation cash-year scope disagrees.');}
        if((input.schema_version==='filing-pack-input/5'||input.schema_version==='filing-pack-input/6')){
            const accounting=parseBankAccountingCoverage(input.bank_source_coverage,input.owner_id);
            const effects=new Map(accounting.accounting.map(a=>[a.transaction_id,a]));
            for(const row of input.observations){const effect=effects.get(row.id);if(effect&&(row.business_use_bps!==(effect.decision?.intent.business_use_bps??0)||row.recognized_pence!==effect.recognized_income_pence+effect.recognized_expense_pence))throw new Error('Filing foreign accounting projection differs.');}
        }
        if(input.calculation_is_current&&(!((input.schema_version==='filing-pack-input/5'||input.schema_version==='filing-pack-input/6')?['tax-calculation-input/4',...(input.schema_version==='filing-pack-input/6'?['tax-calculation-input/5']:[])]:['tax-calculation-input/3']).includes(input.calculation.input.schema_version)||!('bank_source_coverage' in input.calculation.input)||canonicalJson(input.calculation.input.bank_source_coverage)!==canonicalJson(input.bank_source_coverage)))throw new Error('Current pack bank coverage does not match its calculation.');
    }
    if (input.schema_version !== 'filing-pack-input/1') {
        const coverage = parseInvoiceCurrencyCoverage(input.invoice_coverage, input.owner_id);
        if (input.calculation_is_current && (!['tax-calculation-input/2','tax-calculation-input/3','tax-calculation-input/4','tax-calculation-input/5'].includes(input.calculation.input.schema_version) || canonicalJson(input.calculation.input.invoice_coverage) !== canonicalJson(coverage))) throw new Error('Current pack invoice coverage does not match its calculation.');
    }
    if (hasFilingFx(input)) {
        if(new TextEncoder().encode(JSON.stringify(input)).length>4_000_000)throw new Error('Complete filing input exceeds direct review capacity.');
        validateFilingFxContext(input);
    }
    guardPrivate(input);
    canonicalJson(input);
    const observations = new Map(input.observations.map(o => [o.id, o]));
    for (const original of input.calculation.input.observations) {
        const row = observations.get(original.id);
        if (!row || row.in_tax_year !== true || row.file_hash !== original.file_hash || row.row_hash !== original.row_hash)
            throw new Error('Incomplete year/source closure.');
    }
    for (const row of input.observations)
        if (!/^[a-f0-9]{64}$/.test(String(row.file_hash)) || !/^[a-f0-9]{64}$/.test(String(row.row_hash)))
            throw new Error('Source hashes are unavailable.');
    for (const record of input.calculation.input.records)
        if (record.bank_transaction_id && !observations.has(record.bank_transaction_id)) throw new Error('Incomplete financial-record source closure.');
}
export function defaultStepData(step: FilingStep): Record<string, unknown> { switch (step) {
    case 'profile': return { trade_form: 'unknown', short_eligibility: 'unknown' };
    case 'sources': return { all_sources_reviewed: false };
    case 'income': return { all_receipts_are_turnover: false, no_invoice_expected_ids: [] };
    case 'expenses': return { category_boxes: {}, capital_boxes: {} };
    case 'other': return { termination_exempt_pence: {} };
    case 'pension': return { one_off_pension_gross_pence: null, one_off_gift_aid_net_pence: null };
    default: return {};
} }
export function validateStepData(input: FilingPackInput, step: FilingStep, value: unknown) {
    const formMapping2025 = input.schema_version === 'filing-pack-input/6' ? currentMapping : formMapping2025Legacy;
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Review typed step answers.');
    const data = value as Record<string, unknown>, allowed = Object.keys(defaultStepData(step));
    if (Object.keys(data).length !== allowed.length || Object.keys(data).some(k => !allowed.includes(k)))
        throw new Error('Review supported step answers.');
    if (step === 'profile' && (!['unknown', 'short', 'full'].includes(String(data.trade_form)) || !['unknown', 'full_year_simple', 'requires_full'].includes(String(data.short_eligibility))))
        throw new Error('Review form and annualised turnover eligibility.');
    if (step === 'sources' && typeof data.all_sources_reviewed !== 'boolean')
        throw new Error('Review source completeness.');
    if (step === 'income') {
        if (typeof data.all_receipts_are_turnover !== 'boolean' || !Array.isArray(data.no_invoice_expected_ids))
            throw new Error('Review income identities.');
        const candidates = new Set(matchingReceipts(input).map(r => r.id)), ids = data.no_invoice_expected_ids as unknown[];
        if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !candidates.has(id)))
            throw new Error('Choose only current unmatched business receipts.');
    }
    for (const key of step === 'expenses' ? ['category_boxes', 'capital_boxes'] : step === 'other' ? ['termination_exempt_pence'] : []) {
        const map = data[key];
        if (!map || typeof map !== 'object' || Array.isArray(map))
            throw new Error('Review supported source mappings.');
        for (const [id, value] of Object.entries(map)) {
            if (key === 'category_boxes') {
                if (!input.calculation.input.records.some(r => r.category?.id === id) || !Object.keys(formMapping2025.full_expenses).includes(String(value)))
                    throw new Error('Review each owned category mapping.');
            }
            else if (key === 'capital_boxes') {
                if (!facts(input, ['trade_adjustment']).some(f => f.id === id && f.data.adjustment_type === 'capital_allowance') || ![...formMapping2025.short.capital, ...formMapping2025.full.capital].includes(value as never))
                    throw new Error('Review the specific capital allowance box.');
            }
            else {
                const f = facts(input, ['termination']).find(f => f.id === id);
                if (!f || (value !== null && (number(value) < 0 || number(value) > number(f.data.gross_pence) - number(f.data.taxable_pence))))
                    throw new Error('Review the evidenced exempt termination component.');
            }
        }
    }
    if (step === 'pension') {
        const cap = [sumPence(facts(input, ['pension']).filter(f => f.data.method === 'relief_at_source').map(f => number(f.data.gross_contribution_pence))), sumPence(facts(input, ['gift_aid']).map(f => number(f.data.net_donation_pence)))];
        for (const [i, key] of ['one_off_pension_gross_pence', 'one_off_gift_aid_net_pence'].entries())
            if (data[key] !== null && (number(data[key]) < 0 || number(data[key]) > cap[i]))
                throw new Error('One-off amount exceeds the verified annual amount.');
    }
    canonicalJson(data);
    return data;
}
function stepBase(input: FilingPackInput, step: FilingStep) { const c = input.calculation.input; switch (step) {
    case 'profile': return { profile: c.profile, turnover: totals(input).ledger_income };
    case 'sources': return { imports: input.imports, documents: input.documents, batches: input.document_batches, items: input.document_items, attachments: input.legacy_attachments, rows: input.observations.map(o => ({ id: o.id, file_hash: o.file_hash, row_hash: o.row_hash, account_id: o.account_id, masked_identifier: o.masked_identifier })) };
    case 'income': return { records: c.records.filter(r => r.record_type === 'income'), receipts: matchingReceipts(input) };
    case 'expenses': return { records: c.records.filter(r => r.record_type === 'expense'), facts: facts(input, ['vehicle', 'trade_adjustment']) };
    case 'paye': return { facts: c.facts.filter(f => f.kind === 'employment'), sections: c.sections.filter(s => s.kind === 'employment') };
    case 'other': return { facts: c.facts.filter(f => ['termination', 'other_income'].includes(f.kind)), sections: c.sections.filter(s => ['termination', 'other_income'].includes(s.kind)) };
    case 'pension': return { facts: c.facts.filter(f => ['pension', 'gift_aid'].includes(f.kind)), sections: c.sections.filter(s => ['pension', 'gift_aid'].includes(s.kind)) };
    case 'estimate': return { input: c, result: input.calculation.result, rules: input.rules.sha256 };
    default: return input;
} }
export function buildFilingReview(input: FilingPackInput, history: StepReview[]) {
    const formMapping2025 = input.schema_version === 'filing-pack-input/6' ? currentMapping : formMapping2025Legacy;
    validatePackInput(input);
    const current: StepReview[] = [], answers: Partial<Record<FilingStep, Record<string, unknown>>> = {}, steps = filingSteps.map(step => {
        const dependencies = step === 'review' || step === 'exceptions' ? current.map(r => ({ step: r.step, digest: r.digest, data: r.data })) : step === 'expenses' ? [{ step: 'profile', data: answers.profile ?? defaultStepData('profile') }] : [];
        const digest = sha256(canonicalJson({ year: input.tax_year_start, mapping: formMapping2025.id, step, input: stepBase(input, step), ...(input.schema_version !== 'filing-pack-input/1' ? { input_version: input.schema_version, invoice_coverage: input.invoice_coverage } : {}), ...(hasFilingFx(input) ? { fx_provenance: input.fx_provenance } : {}), ...(hasFilingBank(input)?{bank_source_coverage:input.bank_source_coverage}:{}), dependencies }));
        const review = history.find(r => r.step === step && r.digest === digest);
        if (review) {
            validateStepData(input, step, review.data);
            current.push(review);
            answers[step] = review.data;
        }
        else
            answers[step] = defaultStepData(step);
        return { id: step, name: stepNames[step], digest, review: review ?? null, data: answers[step]! };
    });
    const worksheet = buildWorksheet(input, answers), issues: PackIssue[] = [...input.calculation.result.issues.map(i => ({ code: i.code, message: i.message, blocking: i.severity === 'blocking', source_ids: i.source_ids })), ...worksheet.issues];
    const issue = (code: string, message: string, ids: string[] = [], blocking = true) => issues.push({ code, message, blocking, source_ids: ids });
    if (input.schema_version !== 'filing-pack-input/1' && invoiceCoverageBlocks(input.invoice_coverage) && !issues.some(i => i.code === 'invoice_currency_coverage'))
        issue('invoice_currency_coverage', INVOICE_COVERAGE_LIMITATION, input.invoice_coverage.invoices.filter(i => i.representation !== 'native_gbp').map(i => i.id));
    if(hasFilingBank(input)){
        const scope=filingBankScope(input);
        if(scope.blocks&&!issues.some(i=>i.code==='bank_source_coverage'))issue('bank_source_coverage',BANK_TAX_LIMITATION,scope.blocked_ids);
    }
    if (input.schema_version === 'filing-pack-input/6') {
        const unavailable = input.documents.filter(document => !document.source_available).map(document => document.id);
        if (unavailable.length) issue('document_source_unavailable', 'Original document evidence is missing or marked for deletion. Review source availability before completeness attestation.', unavailable);
    }
    if (!input.calculation_is_current)
        issue('calculation_stale', 'Save a current calculation before creating this pack.');
    const observationsById = new Map(input.observations.map(o => [o.id, o]));
    for (const record of input.calculation.input.records.filter(r => r.status === 'approved' && r.bank_transaction_id)) {
        const observation = observationsById.get(record.bank_transaction_id!)!;
        if (observation.in_tax_year !== true || observation.transaction_date !== record.record_date)
            issue('posting_source_date', 'The accounting date differs from the observed cash date/year. Review cash-basis timing before completeness attestation.', [record.id, observation.id]);
    }
    if (answers.sources?.all_sources_reviewed !== true)
        issue('sources_completeness', 'Confirm all relevant accounts, source periods and employment/other documents were reviewed.');
    if (answers.income?.all_receipts_are_turnover !== true)
        issue('turnover_scope', 'Confirm which trading receipts are turnover; other trading income needs a separate mapping.');
    const noInvoice = new Set(answers.income?.no_invoice_expected_ids as string[] ?? []);
    for (const receipt of matchingReceipts(input))
        if (!noInvoice.has(receipt.id))
            issue('unmatched_receipt', 'Match this receipt or explicitly review that no invoice is expected.', [receipt.id]);
    for (const a of input.legacy_attachments)
        issue('legacy_evidence_hash', 'Legacy attachment has no original content hash; preserve it through reviewed evidence intake before claiming complete evidence.', [a.id]);
    for (const revision of input.invoice_revisions)
        if (!revision.pdf_sha256)
            issue('invoice_hash_unavailable', 'Historical invoice PDF hash is unavailable; its amount remains contextual evidence for review.', [revision.id], false);
    for (const step of steps)
        if (!step.review)
            issue('step_' + step.id, `Review the current ${step.name.toLowerCase()} step.`);
    return { steps, current, answers, worksheet: worksheet.lines, issues, inputHash: sha256(canonicalJson(input)), canAttest: !issues.some(i => i.blocking) };
}
function buildWorksheet(input: FilingPackInput, answers: Partial<Record<FilingStep, Record<string, unknown>>>) {
    const formMapping2025 = input.schema_version === 'filing-pack-input/6' ? currentMapping : formMapping2025Legacy;
    const lines: WorksheetLine[] = [], issues: PackIssue[] = [], c = input.calculation.input, t = totals(input), profile = answers.profile ?? defaultStepData('profile'), expense = answers.expenses ?? defaultStepData('expenses'), other = answers.other ?? defaultStepData('other'), pension = answers.pension ?? defaultStepData('pension');
    const issue = (code: string, message: string, ids: string[] = []) => issues.push({ code, message, blocking: true, source_ids: ids });
    const add = (id: string, form: string, box: string | null, label: string, pence: number | null, rounding: string, ids: string[], note = '') => { const paper = pence === null || rounding === 'review' || (rounding === 'tax_paid_up' && pence < 0) ? null : rounding === 'income_down' ? Math.floor(pence / 100) : Math.ceil(pence / 100); lines.push({ id, form, box, label, pence, paper_pounds: paper, rounding, source_ids: ids, note }); };
    if (input.tax_year_start !== formMapping2025.tax_year_start)
        issue('mapping_year', 'No source-verified form mapping for this tax year.');
    for (const f of facts(input, ['employment'])) {
        add(f.id + '-pay', 'SA102', 'E1:1', 'Employment taxable pay', number(f.data.taxable_pay_pence), 'income_down', [f.id], 'One employment page per distinct job; employer identity comes from original evidence.');
        add(f.id + '-tax', 'SA102', 'E1:2', 'PAYE Income Tax', number(f.data.income_tax_withheld_pence), 'tax_paid_up', [f.id], 'Signed refund stays signed. Never add National Insurance.');
    }
    for (const f of facts(input, ['termination'])) {
        add(f.id + '-taxable', 'SA101', 'Ai2:5', 'Separate taxable termination component', number(f.data.taxable_pence), 'income_down', [f.id]);
        add(f.id + '-tax', 'SA101', 'Ai2:6', 'Tax withheld only on this component', number(f.data.income_tax_withheld_pence), 'tax_paid_up', [f.id], 'Requires the reviewed scope confirming tax was not repeated in SA102.');
        const exempt = (other.termination_exempt_pence as Record<string, number | null> ?? {})[f.id] ?? null;
        if (exempt === null)
            issue('termination_exempt_mapping', 'Review the employer breakdown before identifying the SA101 exempt component.', [f.id]);
        add(f.id + '-exempt', 'SA101', 'Ai2:9', 'Evidenced exempt termination amount', exempt, 'income_down', [f.id], 'Gross minus taxable is not automatically assumed to be exempt.');
    }
    const ras = facts(input, ['pension']).filter(f => f.data.method === 'relief_at_source'), gifts = facts(input, ['gift_aid']);
    if (ras.length) {
        add('ras', 'SA100', 'TR4:1', 'Gross personal RAS contributions', sumPence(ras.map(f => number(f.data.gross_contribution_pence))), 'review', ras.map(f => f.id), 'Includes provider relief; excludes employer/net-pay/salary-sacrifice contributions.');
        const once = pension.one_off_pension_gross_pence as number | null;
        if (once === null)
            issue('pension_one_off', 'Review the gross one-off pension subset for TR4 box 1.1.');
        add('ras-once', 'SA100', 'TR4:1.1', 'Gross one-off subset', once, 'review', ras.map(f => f.id));
    }
    if (gifts.length) {
        add('gift', 'SA100', 'TR4:5', 'Net Gift Aid donations actually paid', sumPence(gifts.map(f => number(f.data.net_donation_pence))), 'review', gifts.map(f => f.id), 'Actual net donations, not the gross band extension. Carry-back elections require further review.');
        const once = pension.one_off_gift_aid_net_pence as number | null;
        if (once === null)
            issue('gift_one_off', 'Review the actual one-off Gift Aid subset for TR4 box 6.');
        add('gift-once', 'SA100', 'TR4:6', 'Net one-off Gift Aid subset', once, 'review', gifts.map(f => f.id));
    }
    if (facts(input, ['other_income']).length)
        issue('other_income_mapping', 'Other income needs its specific annual form/page/box classification.', facts(input, ['other_income']).map(f => f.id));
    const form = profile.trade_form === 'full' ? 'SA103F' : 'SA103S', short = form === 'SA103S', mapping = short ? formMapping2025.short : formMapping2025.full;
    if (profile.trade_form === 'unknown')
        issue('trade_form', 'Choose the self-employment form after checking the annual notes.');
    if (short && (profile.short_eligibility !== 'full_year_simple' || t.ledger_income === null || t.ledger_income >= formMapping2025.short_turnover_limit_pence))
        issue('short_eligibility', 'Short-form eligibility needs turnover below the annual limit and confirmed full-year/simple affairs. Partial-year annualisation or complex affairs require further review.');
    const adjustments = facts(input, ['trade_adjustment']), capital = adjustments.filter(f => f.data.adjustment_type === 'capital_allowance'), allowance = adjustments.find(f => f.data.adjustment_type === 'trading_allowance'), addbacks = sumPence(adjustments.filter(f => f.data.adjustment_type === 'add_back').map(f => number(f.data.amount_pence)));
    for (const f of adjustments.filter(f => ['other_deduction', 'loss_brought_forward'].includes(String(f.data.adjustment_type))))
        issue('adjustment_mapping', 'This trade adjustment needs a specific form treatment, not a guessed deduction box.', [f.id]);
    const delta = sumPence(facts(input, ['vehicle']).filter(f => f.data.method === 'simplified_mileage').map(f => number(t['vehicle_' + f.id]))), removedCapital = sumPence(capital.map(f => sumPence([number(t['adjustment_' + f.id]), number(f.data.amount_pence)]))), capTotal = sumPence(capital.map(f => number(f.data.amount_pence)));
    const expenseTotal = t.ledger_expenses === null ? null : allowance ? 0 : sumPence([t.ledger_expenses, delta, -removedCapital, short ? -addbacks : 0]);
    const accountingProfit = t.ledger_income === null || expenseTotal === null ? null : sumPence([t.ledger_income, -expenseTotal]);
    if (expenseTotal !== null && expenseTotal < 0)
        issue('negative_expense_mapping', 'Net expense refunds exceed current-year expenses; review their annual form treatment before copying a negative expense total.');
    add('trade-turnover', form, mapping.turnover, 'Cash-basis business turnover', t.ledger_income ?? null, 'income_down', c.records.filter(r => r.record_type === 'income').map(r => r.id));
    if (!(input.schema_version === 'filing-pack-input/6' && allowance))
        add('trade-expenses', form, mapping.expenses, short ? 'Candidate allowable expense total' : 'Accounts expense total before add-backs', expenseTotal, 'expense_up', c.records.filter(r => r.record_type === 'expense').map(r => r.id), 'Vehicle substitution and capital-cost removal are traced separately; paper totals need reconciliation.');
    add('trade-profit', form, accountingProfit !== null && accountingProfit < 0 ? mapping.loss : mapping.profit, accountingProfit !== null && accountingProfit < 0 ? 'Loss before capital/allowance adjustments' : 'Profit before capital/allowance adjustments', accountingProfit === null ? null : Math.abs(accountingProfit), 'review', c.records.map(r => r.id), 'Exact amount only. Recompute paper arithmetic from consistently rounded paper inputs.');
    if (allowance)
        add('trading-allowance', form, mapping.allowance, 'Elected trading allowance', number(allowance.data.amount_pence), 'review', [allowance.id], 'No actual-expense/capital deductions are also claimed.');
    if (!short && !allowance) {
        add('trade-addbacks', form, formMapping2025.full.add_backs, 'Reviewed disallowable add-backs', addbacks, 'review', adjustments.filter(f => f.data.adjustment_type === 'add_back').map(f => f.id));
        const categoryMap = expense.category_boxes as Record<string, string> ?? {};
        for (const r of c.records.filter(r => r.status === 'approved' && r.record_type === 'expense'))
            if (!r.category || !categoryMap[r.category.id])
                issue('full_expense_mapping', 'Review the annual full-form expense category mapping.', [r.id]);
        for (const box of [...new Set(Object.values(categoryMap))].sort()) {
            const records = c.records.filter(r => r.status === 'approved' && r.record_type === 'expense' && r.category && categoryMap[r.category.id] === box);
            add('expense-box-' + box, form, box, 'Reviewed expense box total', sumPence(records.map(r => r.amount_pence * r.effect_sign)), 'expense_up', records.map(r => r.id), 'Grouped before rounding. Reconcile vehicle/capital substitutions before copying paper boxes.');
        }
        if (addbacks)
            issue('full_disallowable_mapping', 'Allocate add-backs to the corresponding disallowable expense boxes before copying full-form totals.');
        if (delta || removedCapital)
            issue('full_substitution_mapping', 'Allocate mileage/capital substitutions across the full-form expense boxes before copying the worksheet.');
    }
    for (const f of capital) {
        const box = (expense.capital_boxes as Record<string, string> ?? {})[f.id], allowed = short ? formMapping2025.cash_basis_car_capital.short : formMapping2025.cash_basis_car_capital.full;
        if (!box || !(allowed as readonly string[]).includes(box))
            issue('capital_mapping', 'Review the evidenced car allowance and a cash-basis capital box for the selected form.', [f.id]);
        add('capital-' + f.id, form, box ?? null, 'Reviewed capital allowance', number(f.data.amount_pence), 'review', [f.id], 'Cash-basis capital allowances generally concern cars; eligibility remains source review.');
    }
    if (!short) {
        if (!(input.schema_version === 'filing-pack-input/6' && allowance && capital.length === 0))
            add('capital-total', form, formMapping2025.full.capital_total, 'Capital allowance total', capTotal, 'review', capital.map(f => f.id));
        const correctedLosses = input.schema_version === 'filing-pack-input/6';
        const netTaxProfit = accountingProfit === null ? null : sumPence([accountingProfit, addbacks, -capTotal]);
        add('net-tax-profit', form, correctedLosses && netTaxProfit !== null && netTaxProfit < 0 ? currentMapping.full.net_tax_loss : formMapping2025.full.net_tax_profit, correctedLosses && netTaxProfit !== null && netTaxProfit < 0 ? 'Loss for tax before trading allowance' : 'Profit for tax before trading allowance', netTaxProfit === null ? null : (correctedLosses ? Math.abs(netTaxProfit) : netTaxProfit), 'review', c.records.map(r => r.id));
        const adjusted = t.trade_profit ?? null;
        add('adjusted-profit', form, correctedLosses && adjusted !== null && adjusted < 0 ? currentMapping.full.adjusted_loss : formMapping2025.full.adjusted_profit, correctedLosses && adjusted !== null && adjusted < 0 ? 'Adjusted loss for review' : 'Adjusted profit after allowance', adjusted === null ? null : (correctedLosses ? Math.abs(adjusted) : adjusted), 'review', c.records.map(r => r.id));
    }
    else {
        const correctedLosses = input.schema_version === 'filing-pack-input/6';
        const taxProfit = t.trade_profit ?? null;
        add('short-tax-profit', form, correctedLosses && taxProfit !== null && taxProfit < 0 ? currentMapping.short.tax_loss : formMapping2025.short.tax_profit, correctedLosses && taxProfit !== null && taxProfit < 0 ? 'Net business loss for tax' : 'Net business profit for tax', taxProfit === null ? null : (correctedLosses ? Math.abs(taxProfit) : taxProfit), 'review', c.records.map(r => r.id));
    }
    add('taxable-profit', form, mapping.taxable_profit, 'Taxable business profit candidate', t.taxable_trade_profit ?? null, 'review', c.records.map(r => r.id), 'Engine exact-pence rounding is retained separately from paper return arithmetic.');
    return { lines, issues };
}
const html = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const money = (value: number | null) => value === null ? 'Unresolved' : `${formatPounds(value)} (${signedAmountToWords(value)})`;
const draft = 'Draft — not submitted to HMRC';
function csv(rows: Record<string, unknown>[], meta: {
    input_sha256: string;
    request_id: string;
}) { if (!rows.length)
    rows = [{ row_kind: 'no_rows', note: 'No rows in this frozen scope.' }]; const header = ['document_status', 'input_sha256', 'review_request_id', ...new Set(rows.flatMap(r => Object.keys(r)).sort())]; return [header, ...rows.map(r => header.map(key => key === 'document_status' ? draft : key === 'input_sha256' ? meta.input_sha256 : key === 'review_request_id' ? meta.request_id : r[key] ?? ''))].map(row => row.map(value => escapeCsv(typeof value === 'object' ? canonicalJson(value) : String(value))).join(',')).join('\r\n'); }
export type PackArtifact = {
    name: string;
    content_type: string;
    body: string;
    sha256: string;
    size_bytes: number;
};
function reconciliationRows(input: FilingPackInput, fx: FxProvenance | null) {
    const reconciliation: Record<string, unknown>[] = [...input.invoice_balances.map(r => ({ ...r, row_kind: 'invoice_balance', balance_scope: 'All-time balance as of snapshot; not year income' })), ...input.receipt_balances.map(r => ({ ...r, row_kind: 'receipt_balance' })), ...input.reconciliation.map(e => ({ row_kind: e.kind, id: e.id, ...e.data, year_trading_effect_pence: 0, context_scope: 'Relationship history; year income comes only from ledger' }))];
    if (input.schema_version !== 'filing-pack-input/1') for (const row of input.invoice_coverage.invoices) {
        const original = row.representation === 'invalid' ? null : invoiceOriginalAmount(row);
        reconciliation.push({ ...row, row_kind: 'invoice_document_coverage', original_amount_readback: original ? fxAggregateReadback(original.minor, original.currency) : 'Unresolved', balance_scope: 'Original document metadata; not cash, GBP valuation or tax-year income' });
    }
    if (fx) reconciliation.push(...fx.lots.map(l => ({ ...l, row_kind: 'fx_lot_provenance', year_trading_effect_pence: 0, context_scope: fx.scope })), ...fx.events.map(e => ({ ...e, row_kind: 'fx_settlement_event', original_portion_readback: fxAggregateReadback(e.invoice_minor,e.invoice_currency), actual_gbp_cash_readback: fxAggregateReadback(e.amount_pence,'GBP'), year_trading_effect_pence: 0, context_scope: fx.scope })));
    return reconciliation;
}
function ledgerRows(input:FilingPackInput){
    type Posting = typeof input.calculation.input.records[number];
    const recordsByBank = new Map<string, Posting[]>();
    for (const record of input.calculation.input.records) if (record.bank_transaction_id) {
        const rows = recordsByBank.get(record.bank_transaction_id) ?? []; rows.push(record); recordsByBank.set(record.bank_transaction_id, rows);
    }
    const receiptAware=input.calculation.input.schema_version==='tax-calculation-input/5';
    const cashEffect=(r:Posting)=>receiptAware?(receiptCashEffect(r)??0):r.amount_pence*r.effect_sign;
    const effects = (records: Posting[]) => {
        const income = sumPence(records.filter(r => r.status === 'approved' && r.record_type === 'income').map(cashEffect));
        const expense = sumPence(records.filter(r => r.status === 'approved' && r.record_type === 'expense').map(cashEffect));
        return { year_effect_pence: sumPence([income, expense]), year_income_pence: income, year_expense_pence: expense, year_profit_effect_pence: sumPence([income, -expense]) };
    };
    const ledgerRow=(o:Row,row_kind='bank_observation') => {
        const records = [...(recordsByBank.get(o.id) ?? [])].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        return { ...o, row_kind, ...effects(records), context_only: o.in_tax_year !== true && records.length === 0,
            year_record_count: records.length, year_financial_records: records.map(r => ({ id: r.id, record_type: r.record_type, record_date: r.record_date,
                amount_pence: r.amount_pence, effect_sign: r.effect_sign, status: r.status, category_id: r.category?.id ?? null,
                bank_transaction_id: r.bank_transaction_id, original_bank_transaction_id: r.original_bank_transaction_id,
                refund_link_id: r.refund_link_id ?? null, project_id: r.project_id ?? null, ...(receiptAware?{receipt_dimensions:r.receipt_dimensions,recognized_cash_effect_pence:receiptCashEffect(r)}:{}) })) };
    };
    const bank=hasFilingBank(input)?filingBankScope(input).bank_source_coverage:null;
    const accounting=(input.schema_version==='filing-pack-input/5'||input.schema_version==='filing-pack-input/6')?parseBankAccountingCoverage(input.bank_source_coverage,input.owner_id):null;
    const proofs=new Map(accounting?.proof.observations.map(r=>[r.id,r])??[]);
    const bankById=new Map(bank?.observations.map(r=>[r.id,r])??[]);
    const ledger:Record<string,unknown>[]=input.observations.map(o=>{const b=bankById.get(o.id);return ledgerRow(b?{...o,original_signed_minor:b.original_signed_minor,source_units_ruleset:b.ruleset_id,bank_source_representation:b.representation,source_available:b.source_available,valuation_status:b.valuation_status,retained_valuation:b.valuation}:o)});
    if(hasFilingBank(input)){
        const present=new Set(input.observations.map(o=>o.id));
        for(const row of bank!.observations)if(!present.has(row.id))ledger.push(ledgerRow({...row,transaction_date:row.cash_date,in_tax_year:row.tax_year_start===input.tax_year_start,
            context_scope:'Complete owned bank source context; original units and valuations are not recognised GBP effects'},'bank_source_coverage_context'));
    }
    if(accounting)for(const row of ledger){const proof=proofs.get(String(row.id));if(proof){row.foreign_classification_history=proof.classification_history;row.bank_valuation_history=proof.valuation_history;row.accounting_status=accounting.accounting.find(a=>a.transaction_id===proof.id)!.status;}}
    for (const r of input.calculation.input.records.filter(r => !r.bank_transaction_id))
        ledger.push({ row_kind: 'manual_or_legacy_record', ...r, ...effects([r]), context_only: false, provenance: r.source_type === 'manual' ? 'Explicit manual entry; no original file hash asserted' : 'Legacy source link requires review' });
    return ledger;
}
function decisionRows(input:FilingPackInput):Record<string,unknown>[]{
    const rows:Record<string,unknown>[]=[...input.classifications.map(r => ({ ...r, row_kind: 'classification' })), ...input.merchant.map(e => ({ id: e.id, row_kind: 'merchant_' + e.kind, ...e.data })), ...input.legacy_changes.map(r => ({ ...r, row_kind: 'legacy_record_change' }))];
    if((input.schema_version==='filing-pack-input/5'||input.schema_version==='filing-pack-input/6')){const coverage=parseBankAccountingCoverage(input.bank_source_coverage,input.owner_id);for(const row of coverage.proof.observations)for(const decision of row.classification_history)rows.push({row_kind:'foreign_classification_proof',transaction_id:row.id,currency:row.currency,original_signed_minor:row.original_signed_minor,...decision});}
    return rows;
}
export function buildFilingPack(input: FilingPackInput, history: StepReview[], request: string, attest: boolean) {
    const formMapping2025 = input.schema_version === 'filing-pack-input/6' ? currentMapping : formMapping2025Legacy;
    const review = buildFilingReview(input, history);
    const fx = hasFilingFx(input) ? parseFxProvenance(input.owner_id, input.fx_provenance, input.observations) : null;
    if (!input.calculation_is_current)
        throw new Error('Save a current calculation before assembling a pack.');
    if (attest && !review.canAttest)
        throw new Error('Unresolved inputs or current step reviews prevent completeness attestation.');
    const meta = { input_sha256: review.inputHash, request_id: request };
    const ledger=ledgerRows(input);
    const reconciliation = reconciliationRows(input, fx);
    const decisions=decisionRows(input);
    const status = attest ? 'draft_reviewed' : 'draft_incomplete';
    const worksheet = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>VibeCount draft worksheet ${input.tax_year_start}</title><style>body{font:16px system-ui;max-width:70rem;margin:2rem auto;padding:1rem}table{border-collapse:collapse;width:100%}th,td{border:1px solid #777;padding:.5rem;text-align:left;vertical-align:top}h1{font-size:1.6rem}.draft{font-weight:bold;border:2px solid;padding:1rem}@media print{body{margin:0;font-size:10pt}thead{display:table-header-group}tr{break-inside:avoid}.draft{position:static}}</style></head><body><h1>${draft}</h1><p class="draft">${status === 'draft_reviewed' ? 'Financial review completeness attested by the user.' : 'Incomplete draft — unresolved inputs or reviews remain.'} This worksheet is not a completed HMRC form, tax advice or filing approval.</p><p>Tax year ${input.tax_year_start}/${input.tax_year_start + 1}; input SHA-256 ${meta.input_sha256}; review ${html(request)}.</p><p>${html(formMapping2025.paper_rounding)} Employer/identity details and fields outside the supported mapping must be completed from original evidence before any separate filing.</p><table><thead><tr><th>Form / box</th><th>Review line</th><th>Exact amount</th><th>Paper candidate (£)</th><th>Evidence and notes</th></tr></thead><tbody>${review.worksheet.map(line => `<tr><td>${html(line.form)} ${html(line.box ?? 'Unresolved')}</td><td>${html(line.label)}</td><td>${html(money(line.pence))}</td><td>${html(line.paper_pounds ?? 'Needs rounding review')}</td><td>${html(line.source_ids.join(', '))}<br>${html(line.note)}</td></tr>`).join('')}</tbody></table><h2>Estimate from exact inputs</h2><ul>${Object.entries(input.calculation.result.totals).filter(([key,value])=>key!=='class4_reg100_cap'||value!==null).map(([key, value]) => `<li>${html(key.replaceAll('_', ' '))}: ${html(money(value))}</li>`).join('')}</ul><h2>Exceptions and review notes</h2><ul>${review.issues.map(i => `<li>${i.blocking ? 'Unresolved: ' : 'Note: '}${html(i.message)} ${html(i.source_ids.join(', '))}</li>`).join('') || '<li>No current financial blockers detected; independent tax and paper form review still required.</li>'}</ul><h2>Annual mapping sources</h2><ul>${Object.entries(formMapping2025.sources).map(([key, url]) => `<li><a href="${html(url)}">${html(key)}</a></li>`).join('')}</ul></body></html>`;
    const evidence = { document_status: draft, ...meta, tax_year_start: input.tax_year_start, scope: 'Frozen recorded provenance; hashes are not authenticity signatures, continued blob availability or a full backup.', imports: input.imports, rows: input.observations.map(o => ({ id: o.id, source_row_id: o.source_row_id, row_number: o.row_number, row_hash: o.row_hash, file_hash: o.file_hash, import_id: o.import_id, account_id: o.account_id, in_tax_year: o.in_tax_year })), documents: input.documents, document_batches: input.document_batches, document_items: input.document_items, invoice_revisions: input.invoice_revisions, legacy_attachments: input.legacy_attachments, tax_fact_sources: input.calculation.input.sources, source_events: input.source_events, ...(input.schema_version !== 'filing-pack-input/1' ? { invoice_coverage: input.invoice_coverage } : {}), ...(fx ? { fx_provenance: fx } : {}), ...(hasFilingBank(input)?{bank_source_coverage:input.bank_source_coverage}: {}) };
    const bodies: [
        string,
        string,
        string
    ][] = [['worksheet.html', 'text/html; charset=utf-8', worksheet], ['normalized-ledger.csv', 'text/csv; charset=utf-8', csv(ledger, meta)], ['invoice-payment-reconciliation.csv', 'text/csv; charset=utf-8', csv(reconciliation, meta)], ['expense-decisions.csv', 'text/csv; charset=utf-8', csv(decisions, meta)], ['exceptions.csv', 'text/csv; charset=utf-8', csv(review.issues.map(i => ({ ...i })), meta)], ['calculation-trace.json', 'application/json', canonicalJson({ document_status: draft, ...meta, calculation: input.calculation, rules: JSON.parse(input.rules.canonical_json), mapping: formMapping2025, worksheet: review.worksheet, ...(fx ? { fx_provenance: fx } : {}), ...(hasFilingBank(input)?{bank_source_coverage:input.bank_source_coverage}: {}) })], ['evidence-manifest.json', 'application/json', canonicalJson(evidence)]];
    const artifacts: PackArtifact[] = bodies.map(([name, content_type, body]) => ({ name, content_type, body, sha256: sha256(body), size_bytes: Buffer.byteLength(body, 'utf8') }));
    const result = { schema_version: input.schema_version==='filing-pack-input/6'?'draft-filing-pack/7':input.schema_version==='filing-pack-input/5'?'draft-filing-pack/6':input.schema_version==='filing-pack-input/4'?'draft-filing-pack/5':hasFilingFx(input) ? 'draft-filing-pack/4' : input.schema_version === 'filing-pack-input/2' ? 'draft-filing-pack/3' : 'draft-filing-pack/2', document_status: draft, tax_year_start: input.tax_year_start, ...meta, review_status: status, completeness_attested: attest, mapping_version: formMapping2025.id, mapping: formMapping2025, mapping_canonical_json: canonicalJson(formMapping2025), mapping_sha256: sha256(canonicalJson(formMapping2025)), blocking_issues: review.issues.filter(i => i.blocking), reviews: review.current, artifacts };
    if(hasFilingFx(input)&&Buffer.byteLength(canonicalJson(result),'utf8')>4_000_000)throw new Error('Complete filing bundle exceeds direct capture capacity.');
    return result;
}
export type FilingBundle = ReturnType<typeof buildFilingPack>;
export type SavedFilingPack = {
    id: string;
    tax_year_start: number;
    input: FilingPackInput;
    input_canonical_json: string;
    input_sha256: string;
    bundle: FilingBundle;
    bundle_canonical_json: string;
    bundle_sha256: string;
    reason: string;
    author: string;
    created_at: string;
    request_id: string;
};
export function verifyFilingPack(row: SavedFilingPack) {
    const b = row.bundle, expected = ['worksheet.html', 'normalized-ledger.csv', 'invoice-payment-reconciliation.csv', 'expense-decisions.csv', 'exceptions.csv', 'calculation-trace.json', 'evidence-manifest.json'];
    if (canonicalJson(row.input) !== row.input_canonical_json || sha256(row.input_canonical_json) !== row.input_sha256 || canonicalJson(b) !== row.bundle_canonical_json || sha256(row.bundle_canonical_json) !== row.bundle_sha256 || !['draft-filing-pack/1', 'draft-filing-pack/2', 'draft-filing-pack/3', 'draft-filing-pack/4','draft-filing-pack/5','draft-filing-pack/6','draft-filing-pack/7'].includes(b.schema_version) || b.input_sha256 !== row.input_sha256 || b.tax_year_start !== row.tax_year_start || row.input.tax_year_start !== row.tax_year_start || b.request_id !== row.request_id || b.document_status !== draft || b.artifacts.length !== 7 || new Set(b.artifacts.map(a => a.name)).size !== 7 || b.artifacts.some(a => !expected.includes(a.name)))
        throw new Error('Saved pack integrity check failed.');
    if (canonicalJson(b.mapping) !== b.mapping_canonical_json || sha256(b.mapping_canonical_json) !== b.mapping_sha256 || b.mapping.id !== b.mapping_version || b.mapping.tax_year_start !== row.tax_year_start || !['draft_incomplete', 'draft_reviewed'].includes(b.review_status) || b.completeness_attested !== (b.review_status === 'draft_reviewed') || (b.completeness_attested && (b.blocking_issues.length > 0 || b.reviews.length !== 10 || new Set(b.reviews.map(r => r.step)).size !== 10 || row.input.calculation.result.status !== 'estimate')))
        throw new Error('Saved pack mapping or review integrity check failed.');
    const expectedVersion = row.input.schema_version==='filing-pack-input/6'?['draft-filing-pack/7']:row.input.schema_version==='filing-pack-input/5'?['draft-filing-pack/6']:row.input.schema_version==='filing-pack-input/4'?['draft-filing-pack/5']:hasFilingFx(row.input) ? ['draft-filing-pack/4'] : row.input.schema_version === 'filing-pack-input/2' ? ['draft-filing-pack/3'] : ['draft-filing-pack/1','draft-filing-pack/2'];
    if (!expectedVersion.includes(b.schema_version) || (row.input.schema_version !== 'filing-pack-input/1' && invoiceCoverageBlocks(row.input.invoice_coverage) && b.completeness_attested))
        throw new Error('Saved pack currency coverage integrity check failed.');
    if(hasFilingBank(row.input)){
        if(filingBankScope(row.input).blocks&&b.completeness_attested)throw new Error('Saved bank source coverage prevents completeness.');
        for(const name of ['calculation-trace.json','evidence-manifest.json'])if(canonicalJson(JSON.parse(b.artifacts.find(a=>a.name===name)!.body).bank_source_coverage)!==canonicalJson(row.input.bank_source_coverage))throw new Error('Saved bank artifact provenance integrity check failed.');
    }
    validatePackInput(row.input);
    if (row.input.schema_version === 'filing-pack-input/6') {
        if (row.input.documents.some(document => !document.source_available) && b.completeness_attested) throw new Error('Saved document source availability prevents completeness.');
        const evidence = JSON.parse(b.artifacts.find(artifact => artifact.name === 'evidence-manifest.json')!.body);
        if (canonicalJson(evidence.documents) !== canonicalJson(row.input.documents)) throw new Error('Saved document availability provenance integrity check failed.');
    }
    guardPrivate(b);
    for (const artifact of b.artifacts)
        if (sha256(artifact.body) !== artifact.sha256 || Buffer.byteLength(artifact.body, 'utf8') !== artifact.size_bytes)
            throw new Error('Saved artifact integrity check failed.');
    if(hasFilingBank(row.input)&&b.artifacts.find(a=>a.name==='normalized-ledger.csv')!.body!==csv(ledgerRows(row.input),{input_sha256:b.input_sha256,request_id:b.request_id}))throw new Error('Saved bank ledger artifact integrity check failed.');
    if((row.input.schema_version==='filing-pack-input/5'||row.input.schema_version==='filing-pack-input/6')&&b.artifacts.find(a=>a.name==='expense-decisions.csv')!.body!==csv(decisionRows(row.input),{input_sha256:b.input_sha256,request_id:b.request_id}))throw new Error('Saved foreign decision artifact integrity check failed.');
    if (hasFilingFx(row.input)) {
        const fx = parseFxProvenance(row.input.owner_id, row.input.fx_provenance, row.input.observations);
        if(b.artifacts.find(a=>a.name==='invoice-payment-reconciliation.csv')!.body!==csv(reconciliationRows(row.input,fx),{input_sha256:b.input_sha256,request_id:b.request_id}))throw new Error('Saved FX reconciliation artifact integrity check failed.');
        for (const name of ['calculation-trace.json','evidence-manifest.json']) {
            const body = JSON.parse(b.artifacts.find(a => a.name === name)!.body);
            if (canonicalJson(body.fx_provenance) !== canonicalJson(fx)) throw new Error('Saved FX artifact provenance integrity check failed.');
        }
    }
    return b;
}

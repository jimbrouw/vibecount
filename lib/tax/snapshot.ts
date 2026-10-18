import { createHash } from 'node:crypto';
import { calculateTax, type CalculationInput, type CalculationResult } from './calculation';
import { rules2025, type TaxRules } from './rules';
import { parseInvoiceCurrencyCoverage, invoiceCoverageBlocks } from '../invoices/currency-coverage';
import { bankAccountingTaxScope } from './bank-accounting-scope';
import {bankTaxScope,assertBankWithholding} from './bank-source-coverage';
/** Stable JSON for exact, independently hashable snapshots; never coerce missing or unsafe values. */
export function canonicalJson(value: unknown): string {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value))
            throw new Error('Snapshots require exact safe integers.');
        return JSON.stringify(value);
    }
    if (Array.isArray(value))
        return '[' + value.map(canonicalJson).join(',') + ']';
    if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson((value as Record<string, unknown>)[key])).join(',') + '}';
    }
    throw new Error('Unsupported snapshot value.');
}
export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
export function prepareCalculation(input: CalculationInput, rules: TaxRules = rules2025) {
    const result = calculateTax(input, rules), inputJson = canonicalJson(input), resultJson = canonicalJson(result), rulesJson = canonicalJson(rules);
    return { input, result, rules, inputJson, resultJson, rulesJson, inputHash: sha256(inputJson), resultHash: sha256(resultJson), rulesHash: sha256(rulesJson) };
}
export type SavedCalculation = {
    id: string;
    tax_year_start: number;
    ruleset_id: string;
    engine_version: string;
    input: CalculationInput;
    result: CalculationResult;
    input_canonical_json: string;
    result_canonical_json: string;
    input_sha256: string;
    result_sha256: string;
    rationale: string;
    author: string;
    request_id: string;
    created_at: string;
};
/** Validate bytes before presenting a historical result; never replace it with current figures. */
export function verifySavedCalculation(row: SavedCalculation, rules: {
    canonical_json: string;
    sha256: string;
    id: string;
}) {
    if (sha256(row.input_canonical_json) !== row.input_sha256 || sha256(row.result_canonical_json) !== row.result_sha256 || sha256(rules.canonical_json) !== rules.sha256 || rules.id !== row.ruleset_id || canonicalJson(row.input) !== row.input_canonical_json || canonicalJson(row.result) !== row.result_canonical_json)
        throw new Error('Saved calculation integrity check failed.');
    const parsed = JSON.parse(rules.canonical_json);
    if (canonicalJson(parsed) !== rules.canonical_json || parsed.id !== row.ruleset_id || parsed.engine_version !== row.engine_version || row.result.ruleset_id !== row.ruleset_id || row.result.engine_version !== row.engine_version || row.result.tax_year_start !== row.tax_year_start || row.input.tax_year_start !== row.tax_year_start || row.result.document_status !== 'Draft — not submitted to HMRC')
        throw new Error('Saved calculation version check failed.');
    if (row.input.schema_version !== 'tax-calculation-input/1') {
        const coverage = parseInvoiceCurrencyCoverage(row.input.invoice_coverage, row.input.owner_id);
        if (invoiceCoverageBlocks(coverage) && (row.result.status !== 'incomplete' || ['trade_profit', 'taxable_trade_profit', 'income_tax', 'class4', 'assessed_liability', 'net_balance', 'poa_each', 'january_combined'].some(key => row.result.totals[key] !== null))) throw new Error('Saved calculation currency coverage is inconsistent.');
    }
    if(row.input.schema_version==='tax-calculation-input/3')assertBankWithholding(row.result,bankTaxScope(row.input,row.input.bank_source_coverage));
    if(row.input.schema_version==='tax-calculation-input/4'||row.input.schema_version==='tax-calculation-input/5')assertBankWithholding(row.result,bankAccountingTaxScope(row.input,row.input.bank_source_coverage));
    if(row.input.schema_version==='tax-calculation-input/5'&&canonicalJson(calculateTax(row.input,parsed))!==row.result_canonical_json)throw new Error('Saved receipt cash calculation differs from its reviewed input.');
    return { schema_version: 'tax-calculation-snapshot/1', document_status: row.result.document_status, caveat: row.result.caveat, id: row.id, tax_year_start: row.tax_year_start, created_at: row.created_at, author: row.author, rationale: row.rationale, input_sha256: row.input_sha256, result_sha256: row.result_sha256, rules_sha256: rules.sha256, input: row.input, result: row.result, rules: parsed };
}

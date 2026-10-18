import { canonicalJson, sha256 } from '../tax/snapshot';
import { redactBankDetailsForPrompt } from '../ai/redaction';
import { evaluatePlan, validatePlan, type Plan, type PlanResult } from './plan';
import { planningRules2026 } from './rules';
import { evaluateCoveredFinancePlan, evaluateBankCoveredFinancePlan, financeScenario, isCoveredFinanceResult, type FinanceResult } from './coverage';
import { parseInvoiceCurrencyCoverage, type InvoiceCurrencyCoverage } from '../invoices/currency-coverage';
import { parseBankSourceCoverage, type BankSourceCoverage } from '../records/bank-source-coverage';

export type PlanningAccount = { id: string; user_id: string; provider: string; account_type: string; currency: string; label: string; masked_identifier: string };
export type PlanningDocument = { id: string; user_id: string; file_sha256: string; media_type: string; size_bytes: number };
export type PlanningCatalog = { accounts: PlanningAccount[]; documents: PlanningDocument[] };
type FrozenSources = { accounts: PlanningAccount[]; documents: PlanningDocument[] };
export type LegacyPlanSnapshotInput = { schema_version: 'finance-plan-input/1'; owner_id: string; evaluated_on: string; plan: Plan; sources: FrozenSources };
export type CurrentPlanSnapshotInput = Omit<LegacyPlanSnapshotInput, 'schema_version'> & { schema_version: 'finance-plan-input/2'; invoice_coverage: InvoiceCurrencyCoverage };
export type BankPlanSnapshotInput = Omit<CurrentPlanSnapshotInput, 'schema_version'> & { schema_version: 'finance-plan-input/3'; bank_source_coverage: BankSourceCoverage };
export type PlanSnapshotInput = LegacyPlanSnapshotInput | CurrentPlanSnapshotInput | BankPlanSnapshotInput;

/** Supply catalog rows from an authenticated, owner-scoped server read, never from the review form. */
export function freezePlanningSources(owner: string, plan: Plan, catalog: PlanningCatalog): FrozenSources {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(owner)) throw new Error('Review the planning owner.');
    const accounts = new Map<string, PlanningAccount>(), documents = new Map<string, PlanningDocument>();
    for (const asset of plan.assets) {
        if (asset.account_id !== null) {
            const matches = catalog.accounts.filter(a => a.id === asset.account_id && a.user_id === owner);
            if (matches.length !== 1) throw new Error('A linked planning account is missing or not owned.');
            const a = matches[0];
            const safeLabel = redactBankDetailsForPrompt(a.label);
            if (a.currency !== 'GBP' || !['starling', 'nationwide', 'amex', 'generic'].includes(a.provider) ||
                !/^[a-zA-Z0-9]{1,4}$/.test(a.masked_identifier) || !a.label.trim() || a.label.length > 80 || safeLabel.length > 80 ||
                !((asset.kind === 'cash' && a.account_type === 'bank') || (asset.kind === 'liability' && a.account_type === 'credit_card')))
                throw new Error('Link GBP bank balances as cash and card balances as debts; pension assets remain separate.');
            accounts.set(a.id, { id: a.id, user_id: owner, provider: a.provider, account_type: a.account_type, currency: a.currency,
                label: safeLabel, masked_identifier: a.masked_identifier });
        }
        if (asset.document_id !== null) {
            const matches = catalog.documents.filter(d => d.id === asset.document_id && d.user_id === owner);
            if (matches.length !== 1) throw new Error('A linked planning document is missing or not owned.');
            const d = matches[0];
            if (!/^[a-f0-9]{64}$/.test(d.file_sha256) || !['application/pdf', 'image/png', 'image/jpeg'].includes(d.media_type) || !Number.isSafeInteger(d.size_bytes) || d.size_bytes < 1)
                throw new Error('Review document provenance before using its balance.');
            documents.set(d.id, { id: d.id, user_id: owner, file_sha256: d.file_sha256, media_type: d.media_type, size_bytes: d.size_bytes });
        }
    }
    return { accounts: [...accounts.values()].sort((a, b) => a.id.localeCompare(b.id)), documents: [...documents.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}
/** Creates a deterministic draft; it neither approves financial inputs nor writes financial records. */
export function prepareFinancePlan(owner: string, value: unknown, evaluatedOn: string, catalog: PlanningCatalog) {
    const plan = validatePlan(value), result = evaluatePlan(plan, evaluatedOn), sources = freezePlanningSources(owner, plan, catalog);
    const input: LegacyPlanSnapshotInput = { schema_version: 'finance-plan-input/1', owner_id: owner, evaluated_on: result.evaluated_on, plan, sources };
    const inputJson = canonicalJson(input), resultJson = canonicalJson(result), rulesJson = canonicalJson(planningRules2026);
    return { input, result, rules: planningRules2026, inputJson, resultJson, rulesJson, inputHash: sha256(inputJson), resultHash: sha256(resultJson), rulesHash: sha256(rulesJson) };
}
/** New current snapshots freeze authoritative coverage separately from unchanged manual scenario inputs. */
export function prepareCurrentFinancePlan(owner: string, value: unknown, evaluatedOn: string, catalog: PlanningCatalog, valueCoverage: InvoiceCurrencyCoverage) {
    const invoice_coverage = JSON.parse(canonicalJson(parseInvoiceCurrencyCoverage(valueCoverage, owner))) as InvoiceCurrencyCoverage, plan = validatePlan(value), sources = freezePlanningSources(owner, plan, catalog);
    const result = evaluateCoveredFinancePlan(owner, plan, evaluatedOn, invoice_coverage);
    const input: CurrentPlanSnapshotInput = { schema_version: 'finance-plan-input/2', owner_id: owner, evaluated_on: result.evaluated_on, plan, sources, invoice_coverage };
    const inputJson = canonicalJson(input), resultJson = canonicalJson(result), rulesJson = canonicalJson(planningRules2026);
    if (new TextEncoder().encode(inputJson).length > 1000000 || new TextEncoder().encode(resultJson).length > 1000000) throw new Error('Complete finance inputs exceed draft capture capacity.');
    return { input, result, rules: planningRules2026, inputJson, resultJson, rulesJson, inputHash: sha256(inputJson), resultHash: sha256(resultJson), rulesHash: sha256(rulesJson) };
}
/** V3 is separate so retained V1/V2 preparers and hashes stay byte-compatible. */
export function prepareBankCoveredFinancePlan(owner: string, value: unknown, evaluatedOn: string, catalog: PlanningCatalog, valueCoverage: InvoiceCurrencyCoverage, valueBank: BankSourceCoverage) {
    const invoice_coverage = JSON.parse(canonicalJson(parseInvoiceCurrencyCoverage(valueCoverage, owner))) as InvoiceCurrencyCoverage;
    const bank_source_coverage = JSON.parse(canonicalJson(parseBankSourceCoverage(valueBank, owner))) as BankSourceCoverage;
    const plan = validatePlan(value), sources = freezePlanningSources(owner, plan, catalog), result = evaluateBankCoveredFinancePlan(owner, plan, evaluatedOn, invoice_coverage, bank_source_coverage);
    const input: BankPlanSnapshotInput = { schema_version: 'finance-plan-input/3', owner_id: owner, evaluated_on: result.evaluated_on, plan, sources, invoice_coverage, bank_source_coverage };
    const inputJson = canonicalJson(input), resultJson = canonicalJson(result), rulesJson = canonicalJson(planningRules2026);
    if (new TextEncoder().encode(inputJson).length > 4000000 || new TextEncoder().encode(resultJson).length > 4000000) throw new Error('Complete finance inputs exceed draft capture capacity.');
    return { input, result, rules: planningRules2026, inputJson, resultJson, rulesJson, inputHash: sha256(inputJson), resultHash: sha256(resultJson), rulesHash: sha256(rulesJson) };
}
export type SavedFinancePlan<I extends PlanSnapshotInput = PlanSnapshotInput, R extends FinanceResult = FinanceResult> = {
    input: I; result: R;
    input_canonical_json: string; result_canonical_json: string; rules_canonical_json: string;
    input_sha256: string; result_sha256: string; rules_sha256: string;
};
export type LegacySavedFinancePlan = SavedFinancePlan<LegacyPlanSnapshotInput, PlanResult>;
/** Fail closed on changed bytes, unsupported versions or results that do not replay with the retained evaluation date. */
export function verifyFinancePlan<I extends PlanSnapshotInput, R extends FinanceResult>(row: SavedFinancePlan<I, R>, owner: string) {
    if (!['finance-plan-input/1', 'finance-plan-input/2', 'finance-plan-input/3'].includes(row.input.schema_version) || row.input.owner_id !== owner ||
        sha256(row.input_canonical_json) !== row.input_sha256 || sha256(row.result_canonical_json) !== row.result_sha256 ||
        sha256(row.rules_canonical_json) !== row.rules_sha256 || canonicalJson(row.input) !== row.input_canonical_json || canonicalJson(row.result) !== row.result_canonical_json)
        throw new Error('Saved finance plan integrity check failed.');
    const scenario = financeScenario(row.result);
    const expectedResult = row.input.schema_version === 'finance-plan-input/3' ? 'finance-plan-result/3' : row.input.schema_version === 'finance-plan-input/2' ? 'finance-plan-result/2' : null;
    if ((expectedResult === null ? isCoveredFinanceResult(row.result) : !isCoveredFinanceResult(row.result) || row.result.schema_version !== expectedResult) || row.rules_canonical_json !== canonicalJson(planningRules2026) || scenario.engine_version !== planningRules2026.engine_version || scenario.forecast.ruleset_id !== planningRules2026.id)
        throw new Error('Saved finance plan version is unavailable.');
    const replay = row.input.schema_version === 'finance-plan-input/3'
        ? prepareBankCoveredFinancePlan(owner, row.input.plan, row.input.evaluated_on, row.input.sources, row.input.invoice_coverage, row.input.bank_source_coverage)
        : row.input.schema_version === 'finance-plan-input/2'
        ? prepareCurrentFinancePlan(owner, row.input.plan, row.input.evaluated_on, row.input.sources, row.input.invoice_coverage)
        : prepareFinancePlan(owner, row.input.plan, row.input.evaluated_on, row.input.sources);
    if (replay.inputJson !== row.input_canonical_json || replay.resultJson !== row.result_canonical_json)
        throw new Error('Saved finance plan replay failed.');
    // Return decoded, verified bytes, so subsequent edits to a caller's object cannot change the verified historical result.
    return { document_status: 'Draft — not submitted to HMRC', input: JSON.parse(row.input_canonical_json) as I,
        result: JSON.parse(row.result_canonical_json) as R, rules: JSON.parse(row.rules_canonical_json),
        input_sha256: row.input_sha256, result_sha256: row.result_sha256, rules_sha256: row.rules_sha256 };
}

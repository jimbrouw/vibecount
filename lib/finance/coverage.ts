import { evaluatePlan, type PlanResult, type PlanningIssue } from './plan';
import { parseInvoiceCurrencyCoverage, invoiceCoverageBlocks, type InvoiceCurrencyCoverage } from '../invoices/currency-coverage';
import { parseBankSourceCoverage, bankSourceCoverageBlocks, type BankSourceCoverage } from '../records/bank-source-coverage';

export const FINANCE_RESULT_VERSION = 'finance-plan-result/2';
export const FINANCE_REVIEW_ENGINE = 'vibecount-finance-review/2';
export const FINANCE_REVIEW_SCOPE = 'manual_gbp_scenario_not_ledger_or_fx_valuation';
export const FINANCE_COVERAGE_CAVEAT = 'Manually reviewed GBP balances and forecast assumptions remain a scenario. Invoice coverage does not verify balances, complete commitments or source evidence. Original invoice units are not cash or GBP valuations.';
export type CoveredFinanceResult = {
  schema_version: typeof FINANCE_RESULT_VERSION;
  engine_version: typeof FINANCE_REVIEW_ENGINE;
  scope: typeof FINANCE_REVIEW_SCOPE;
  caveat: string;
  evaluated_on: string;
  status: 'incomplete' | 'estimate';
  invoice_coverage_stamp: string;
  issues: PlanningIssue[];
  current_free_cash_pence: number | null;
  additional_drawings_ceiling_pence: number | null;
  scenario: PlanResult;
};
export type BankCoveredFinanceResult = Omit<CoveredFinanceResult, 'schema_version' | 'engine_version'> & {
  schema_version: 'finance-plan-result/3';
  engine_version: 'vibecount-finance-review/3';
  bank_coverage_stamp: string;
};
export type FinanceResult = PlanResult | CoveredFinanceResult | BankCoveredFinanceResult;
export function isCoveredFinanceResult(result: FinanceResult): result is CoveredFinanceResult | BankCoveredFinanceResult {
  return 'schema_version' in result && (result.schema_version === FINANCE_RESULT_VERSION || result.schema_version === 'finance-plan-result/3');
}
export function financeScenario(result: FinanceResult): PlanResult { return isCoveredFinanceResult(result) ? result.scenario : result; }
/** Browser-safe current review. It never imports ledger totals, converts currency or changes legacy scenario arithmetic. */
export function evaluateCoveredFinancePlan(owner: string, value: unknown, evaluatedOn: string, valueCoverage: InvoiceCurrencyCoverage): CoveredFinanceResult {
  const coverage = parseInvoiceCurrencyCoverage(valueCoverage, owner), scenario = evaluatePlan(value, evaluatedOn), blocked = invoiceCoverageBlocks(coverage);
  const eligible = !blocked && scenario.status === 'estimate';
  return {
    schema_version: FINANCE_RESULT_VERSION, engine_version: FINANCE_REVIEW_ENGINE, scope: FINANCE_REVIEW_SCOPE, caveat: FINANCE_COVERAGE_CAVEAT,
    evaluated_on: scenario.evaluated_on, status: eligible ? 'estimate' : 'incomplete', invoice_coverage_stamp: coverage.stamp,
    issues: [...scenario.issues, ...(blocked ? [{ code: 'invoice_currency_coverage', message: 'External or invalid invoice representations need reviewed settlement, GBP valuation and tax-year treatment. Conditional free cash and additional drawings are withheld; the manual GBP scenario remains separate.' }] : [])],
    current_free_cash_pence: eligible ? scenario.current_free_cash_pence : null,
    additional_drawings_ceiling_pence: eligible ? scenario.additional_drawings_ceiling_pence : null, scenario,
  };
}
/** Owner-wide completeness; transaction valuations cannot establish account cash balances. */
export function financeBankCoverageBlocks(coverage: BankSourceCoverage): boolean {
  return bankSourceCoverageBlocks(coverage) || coverage.observations.some(r => r.import_status !== 'discarded' && (!r.source_complete || !r.source_available));
}
export function evaluateBankCoveredFinancePlan(owner: string, value: unknown, evaluatedOn: string, invoices: InvoiceCurrencyCoverage, banks: BankSourceCoverage): BankCoveredFinanceResult {
  const bank = parseBankSourceCoverage(banks, owner), prior = evaluateCoveredFinancePlan(owner, value, evaluatedOn, invoices), blocked = financeBankCoverageBlocks(bank);
  return { ...prior, schema_version: 'finance-plan-result/3', engine_version: 'vibecount-finance-review/3', bank_coverage_stamp: bank.stamp,
    caveat: prior.caveat + ' Bank source coverage does not verify current account balances or readable source bytes. Original bank units and transaction valuations are not accessible GBP cash.',
    status: blocked ? 'incomplete' : prior.status,
    issues: [...prior.issues, ...(blocked ? [{ code: 'bank_source_coverage', message: 'Unsupported accounts, unsupported active bank sources or unavailable source metadata require review. Current free cash and additional drawings are withheld; the entered GBP scenario remains separate.' }] : [])],
    current_free_cash_pence: blocked ? null : prior.current_free_cash_pence,
    additional_drawings_ceiling_pence: blocked ? null : prior.additional_drawings_ceiling_pence,
  };
}

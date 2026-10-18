import { invoiceOriginalAmount, type InvoiceReportingRow } from './reporting';
export const INVOICE_CURRENCY_COVERAGE_VERSION = 'vibecount.invoice-currency-coverage/1';
export const INVOICE_CURRENCY_COVERAGE_SCOPE = 'all_owned_finalised_invoices_not_tax_year_income';
export type InvoiceCoverageRow = InvoiceReportingRow & {
  invoice_date: string;
  native_balance_available: boolean;
  representation: 'native_gbp' | 'unsupported_external' | 'invalid';
};
export type InvoiceCurrencyCoverage = {
  schema_version: typeof INVOICE_CURRENCY_COVERAGE_VERSION;
  scope: typeof INVOICE_CURRENCY_COVERAGE_SCOPE;
  owner_id: string;
  stamp: string;
  invoice_count: number;
  native_invoice_count: number;
  unsupported_external_invoice_count: number;
  invalid_invoice_count: number;
  draft_invoice_count: number;
  invoices: InvoiceCoverageRow[];
};
const rowKeys = 'amount,currency,currency_ruleset_id,id,invoice_date,native_balance_available,origin,original_total_minor,representation,source_fact_family_id,source_fact_revision_id,status';
const coverageKeys = 'draft_invoice_count,invalid_invoice_count,invoice_count,invoices,native_invoice_count,owner_id,schema_version,scope,stamp,unsupported_external_invoice_count';
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Complete invoice currency coverage is unavailable.');
  return value as Record<string, unknown>;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invoice coverage counts are unavailable.');
  return value;
}
/** Validate complete safe metadata, never interpret missing coverage as zero invoices. */
export function parseInvoiceCurrencyCoverage(value: unknown, owner: string): InvoiceCurrencyCoverage {
  const c = object(value);
  if (Object.keys(c).sort().join(',') !== coverageKeys || c.schema_version !== INVOICE_CURRENCY_COVERAGE_VERSION || c.scope !== INVOICE_CURRENCY_COVERAGE_SCOPE || c.owner_id !== owner || typeof c.stamp !== 'string' || !/^[a-f0-9]{64}$/.test(c.stamp) || !Array.isArray(c.invoices))
    throw new Error('Owned versioned invoice coverage is unavailable.');
  const counts = { invoice_count: count(c.invoice_count), native_invoice_count: count(c.native_invoice_count), unsupported_external_invoice_count: count(c.unsupported_external_invoice_count), invalid_invoice_count: count(c.invalid_invoice_count), draft_invoice_count: count(c.draft_invoice_count) };
  const invoices = c.invoices.map(value => {
    const r = object(value);
    if (Object.keys(r).sort().join(',') !== rowKeys || r.status !== 'finalised' || typeof r.native_balance_available !== 'boolean' || typeof r.id !== 'string' || !r.id || r.id.length > 100 || typeof r.origin !== 'string' || !r.origin || r.origin.length > 50 || typeof r.currency !== 'string' || !r.currency || r.currency.length > 10 || typeof r.invoice_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.invoice_date) || !Number.isFinite(Date.parse(r.invoice_date)) || new Date(r.invoice_date).toISOString().slice(0, 10) !== r.invoice_date)
      throw new Error('Invoice coverage metadata is incomplete.');
    for (const key of ['amount', 'original_total_minor', 'currency_ruleset_id', 'source_fact_revision_id', 'source_fact_family_id'])
      if (r[key] !== null && (typeof r[key] !== 'string' || (r[key] as string).length > 100)) throw new Error('Invoice coverage units are unavailable.');
    const row = r as InvoiceCoverageRow;
    let expected: InvoiceCoverageRow['representation'] = 'invalid';
    try { invoiceOriginalAmount(row); expected = row.origin === 'native_gbp' ? (row.native_balance_available ? 'native_gbp' : 'invalid') : 'unsupported_external'; } catch { /* Invalid is explicit coverage, never zero money. */ }
    if (row.representation !== expected || (expected !== 'native_gbp' && row.native_balance_available)) throw new Error('Contradictory invoice coverage.');
    return row;
  });
  if (new Set(invoices.map(i => i.id)).size !== invoices.length || invoices.length !== counts.invoice_count ||
      invoices.filter(i => i.representation === 'native_gbp').length !== counts.native_invoice_count ||
      invoices.filter(i => i.representation === 'unsupported_external').length !== counts.unsupported_external_invoice_count ||
      invoices.filter(i => i.representation === 'invalid').length !== counts.invalid_invoice_count)
    throw new Error('Complete invoice coverage counts do not reconcile.');
  return { schema_version: INVOICE_CURRENCY_COVERAGE_VERSION, scope: INVOICE_CURRENCY_COVERAGE_SCOPE, owner_id: owner, stamp: c.stamp, ...counts, invoices };
}
export const invoiceCoverageBlocks = (coverage: InvoiceCurrencyCoverage) => coverage.unsupported_external_invoice_count > 0 || coverage.invalid_invoice_count > 0;
export const INVOICE_COVERAGE_LIMITATION = 'Owner-wide invoice context is not tax-year income. External or invalid invoices need reviewed cash timing and GBP valuation before completeness can be established. Original invoice amounts are not receipts or taxable profit.';

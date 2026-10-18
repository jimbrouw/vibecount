import { requirePence, sumPence } from '../money';
import { currencyCode, currencyMinor, FX_CURRENCY_RULESET, type CurrencyCode } from '../fx/currency';
import { isNativeGbpInvoice, type NativeGbpInvoice } from './native';
import { minorPence } from '../records/allocations';
import { summariseInvoiceBalances, type InvoiceBalanceRow } from './balances';

/** Canonical display metadata. A projection is not verification of an original document. */
export type InvoiceReportingRow = {
  id: string;
  status: string;
  origin: string;
  currency: string;
  amount: string | number | null;
  original_total_minor: string | number | null;
  currency_ruleset_id: string | null;
  source_fact_revision_id: string | null;
  source_fact_family_id: string | null;
};
export const INVOICE_REPORTING_COLUMNS = 'id,status,origin,currency,amount,original_total_minor,currency_ruleset_id,source_fact_revision_id,source_fact_family_id';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function invoiceOriginalAmount(row: InvoiceReportingRow): { currency: CurrencyCode; minor: number } {
  const currency = currencyCode(row.currency);
  if (isNativeGbpInvoice(row)) {
    if ([row.original_total_minor, row.currency_ruleset_id, row.source_fact_revision_id, row.source_fact_family_id].some(v => v !== null))
      throw new Error('Native invoice metadata is incomplete.');
    return { currency, minor: requirePence(row.amount) };
  }
  if (row.origin !== 'preserved_external' || row.amount !== null || row.currency_ruleset_id !== FX_CURRENCY_RULESET ||
      typeof row.source_fact_revision_id !== 'string' || row.source_fact_revision_id.length !== 36 || !uuid.test(row.source_fact_revision_id) ||
      typeof row.source_fact_family_id !== 'string' || row.source_fact_family_id.length !== 36 || !uuid.test(row.source_fact_family_id))
    throw new Error('Invoice currency provenance is unavailable.');
  const value = row.original_total_minor;
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() !== String(value) || !/^[1-9]\d{0,11}$/.test(String(value)))
    throw new Error('Original invoice amount is unavailable.');
  return { currency, minor: currencyMinor(Number(value)) };
}
/** Capability boundary for projected native rows, including contradictory source metadata. */
export function isNativeReportingInvoice<T extends InvoiceReportingRow>(row: T): row is T & NativeGbpInvoice {
  if (!isNativeGbpInvoice(row)) return false;
  try { invoiceOriginalAmount(row); return true; } catch { return false; }
}
/** Each currency has its own original-unit total. Drafts are separate from issued invoices. */
export function groupInvoiceOriginals(rows: readonly InvoiceReportingRow[]) {
  const groups = new Map<CurrencyCode, { currency: CurrencyCode; finalised_minor: number; draft_minor: number; count: number }>();
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row.id || ids.has(row.id) || !['draft', 'finalised'].includes(row.status)) throw new Error('Invoice reporting scope is incomplete.');
    ids.add(row.id);
    const { currency, minor } = invoiceOriginalAmount(row);
    const group = groups.get(currency) ?? { currency, finalised_minor: 0, draft_minor: 0, count: 0 };
    const key = row.status === 'finalised' ? 'finalised_minor' : 'draft_minor';
    group[key] = sumPence([group[key], minor]);
    group.count++;
    groups.set(currency, group);
  }
  return [...groups.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
/** Native GBP balances must cover every native invoice exactly once. Never infer foreign cash. */
export function invoiceReportingSummary(rows: InvoiceReportingRow[], balances: InvoiceBalanceRow[]) {
  const groups = groupInvoiceOriginals(rows);
  const invoices = new Map(rows.map(row => [row.id, row]));
  const seen = new Set<string>();
  const native: InvoiceBalanceRow[] = [];
  for (const balance of balances) {
    const invoice = invoices.get(balance.id);
    if (!invoice || seen.has(balance.id)) throw new Error('Invoice balances are incomplete.');
    seen.add(balance.id);
    if (!isNativeGbpInvoice(invoice)) throw new Error('Native balance reader contains an external invoice.');
    if (balance.currency !== 'GBP' || balance.status !== invoice.status || minorPence(balance.invoice_pence) !== invoiceOriginalAmount(invoice).minor)
      throw new Error('Invoice balances changed.');
    native.push(balance);
  }
  if (rows.some(row => isNativeGbpInvoice(row) && !seen.has(row.id))) throw new Error('Native invoice balance is missing.');
  return { groups, native: summariseInvoiceBalances(native), external_count: rows.filter(row => row.origin === 'preserved_external').length };
}

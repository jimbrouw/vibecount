import { reconciliationExportTable } from './reconciliation-export';
import { escapeCsv } from './export-csv';
import { minorPence } from './allocations';
import { groupInvoiceOriginals, invoiceOriginalAmount, isNativeReportingInvoice, type InvoiceReportingRow } from '../invoices/reporting';
import { fxAmountReadback } from '../fx/readback';
import { parseFxEvidenceHistory, type FxInvoiceDocumentData } from '../fx/document-facts';

export const RECONCILIATION_SCHEMA = 'vibecount.reconciliation/3';
export const MAX_RECONCILIATION_BYTES = 4_000_000;
export const INVOICE_FACT_EXPORT_COLUMNS = 'id,user_id,family_id,kind,ordinal,state,ruleset_id,document_id,invoice_evidence_revision_id,transaction_id,transaction_version,data,source_snapshot,human_read_original,created_at,author,rationale';
export type InvoiceDocumentExportRow = InvoiceReportingRow & { number: string; invoice_date: string };
export type InvoiceFactExportRow = { id: string } & Record<string, unknown>;
export type CurrencyReconciliationInput = {
  owner: string;
  documents: InvoiceDocumentExportRow[];
  facts: InvoiceFactExportRow[];
  legacy: Parameters<typeof reconciliationExportTable>;
};
const extraHeaders = [
  'value_currency', 'invoice_origin', 'invoice_original_currency', 'invoice_original_total_minor',
  'invoice_original_amount_readback', 'invoice_currency_ruleset_id', 'invoice_source_fact_family_id',
  'invoice_source_fact_revision_id', 'invoice_source_document_id', 'invoice_source_file_sha256',
  'invoice_source_reference_status', 'invoice_balance_coverage', 'row_semantics',
  'retained_settlement_invoice_currency', 'retained_settlement_invoice_gross_pence',
];
/** Document amounts are once-only original values, never cash or additional recognised income. */
export function currencyReconciliationExportTable(input: CurrencyReconciliationInput) {
  const { documents, facts, legacy } = input;
  groupInvoiceOriginals(documents); // Complete identity, representation, status and exact-sum validation.
  if (documents.some(d => d.status !== 'finalised')) throw new Error('Export only the finalised invoice scope.');
  const invoices = new Map(documents.map(d => [d.id, d]));
  const factMap = new Map(facts.map(f => [f.id, f]));
  if (factMap.size !== facts.length) throw new Error('Duplicate source fact evidence.');
  const external = documents.filter(d => !isNativeReportingInvoice(d));
  if (new Set(external.map(d => d.source_fact_family_id)).size !== external.length) throw new Error('Duplicate canonical invoice source family.');
  const required = new Set(external.map(d => d.source_fact_revision_id));
  if (facts.length !== required.size || facts.some(f => !required.has(f.id))) throw new Error('Complete captured source facts unavailable.');
  const nativeInvoice = (id: string) => {
    const invoice = invoices.get(id);
    if (!invoice || !isNativeReportingInvoice(invoice)) throw new Error('Unsupported invoice financial relationship.');
    return invoice;
  };
  const balanceIds = new Set<string>();
  for (const b of legacy[2]) {
    const invoice = nativeInvoice(b.id);
    if (balanceIds.has(b.id) || b.currency !== 'GBP' || b.status !== 'finalised' || minorPence(b.invoice_pence) !== invoiceOriginalAmount(invoice).minor)
      throw new Error('Incomplete or changed native invoice balances.');
    balanceIds.add(b.id);
  }
  if (documents.some(d => isNativeReportingInvoice(d) && !balanceIds.has(d.id))) throw new Error('Missing native invoice balance.');
  const settlements = new Map(legacy[0].map(event => [event.id, event]));
  if (settlements.size !== legacy[0].length) throw new Error('Duplicate settlement event evidence.');
  for (const event of legacy[0]) {
    nativeInvoice(event.invoice_id);
    if (event.invoice_snapshot.currency !== 'GBP' || !['allocation', 'reversal'].includes(event.event_kind))
      throw new Error('Unsupported settlement export units.');
    if (minorPence(event.amount_pence) <= 0 || minorPence(event.invoice_snapshot.gross_pence) <= 0) throw new Error('Invalid settlement snapshot amount.');
  }
  for (const credit of legacy[7] ?? []) nativeInvoice(credit.invoice_id);
  for (const assignment of legacy[9] ?? []) nativeInvoice(assignment.invoice_id);

  // Work on raw cells, not reparsed CSV: commas/newlines and formula defence are applied exactly once.
  const { header, rows } = reconciliationExportTable(...legacy);
  const versionIndex = header.indexOf('reconciliation_schema_version');
  for (const row of rows) {
    row[versionIndex] = RECONCILIATION_SCHEMA;
    const invoice = invoices.get(row[2]);
    const settlement = row[1] === 'settlement_event' ? settlements.get(row[5]) : undefined;
    row.push('GBP', invoice?.origin ?? '', '', '', '', '', '', '', '', '', '',
      row[1] === 'invoice_balance' ? 'native_gbp_balance' : '', 'existing_gbp_financial_row', settlement?.invoice_snapshot.currency ?? '', settlement ? String(settlement.invoice_snapshot.gross_pence) : '');
  }
  for (const invoice of documents) {
    if (typeof invoice.number !== 'string' || !invoice.number.trim() || invoice.number.length > 500 ||
        typeof invoice.invoice_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(invoice.invoice_date) || invoice.invoice_date.length !== 10 ||
        !Number.isFinite(Date.parse(invoice.invoice_date)) || new Date(invoice.invoice_date).toISOString().slice(0,10) !== invoice.invoice_date)
      throw new Error('Invoice document identity unavailable.');
    const amount = invoiceOriginalAmount(invoice), native = isNativeReportingInvoice(invoice);
    let sourceDocument = '', sourceHash = '';
    if (!native) {
      const retained = factMap.get(invoice.source_fact_revision_id!);
      const fact = parseFxEvidenceHistory(input.owner, [retained])[0];
      const data = fact.data as FxInvoiceDocumentData;
      if (fact.kind !== 'invoice' || fact.state !== 'verified' || fact.family_id !== invoice.source_fact_family_id ||
          fact.ruleset_id !== invoice.currency_ruleset_id || data.currency !== amount.currency || data.original_total_minor !== amount.minor || data.invoice_date !== invoice.invoice_date ||
          fact.source_snapshot.document_source.registration.purpose !== 'invoice')
        throw new Error('Captured invoice source facts do not match.');
      sourceDocument = fact.document_id;
      sourceHash = fact.source_snapshot.document_source.document.file_sha256;
    }
    const row = Array<string>(header.length).fill('');
    row[0] = 'Draft — not submitted to HMRC'; row[1] = 'invoice_document'; row[2] = invoice.id;
    row[3] = invoice.number; row[15] = invoice.invoice_date; row[16] = 'Finalised document value; not a cash receipt or accounting posting';
    row[versionIndex] = RECONCILIATION_SCHEMA;
    row.push('', invoice.origin, amount.currency, String(amount.minor), fxAmountReadback(amount.minor, amount.currency),
      invoice.currency_ruleset_id ?? '', invoice.source_fact_family_id ?? '', invoice.source_fact_revision_id ?? '', sourceDocument, sourceHash,
      native ? 'native_invoice_reference_only' : 'retained_source_reference_only; current access not asserted',
      native ? 'available_in_native_balance_row' : 'unavailable; no settlement or GBP valuation inferred', 'invoice_document_value_only_not_cash_or_posting', '', '');
    rows.push(row);
  }
  return { header: header.concat(extraHeaders), rows, count: rows.length, schema_version: RECONCILIATION_SCHEMA };
}

/** Retained V3 bytes; V4 consumes raw cells before escaping. */
export function currencyReconciliationExport(input: CurrencyReconciliationInput) {
  const { header, rows } = currencyReconciliationExportTable(input);
  const csv = [header, ...rows].map(row => row.map(escapeCsv).join(',')).join('\r\n');
  if (new TextEncoder().encode(csv).length > MAX_RECONCILIATION_BYTES) throw new Error('Complete reconciliation exceeds direct download capacity.');
  return { csv, count: rows.length, schema_version: RECONCILIATION_SCHEMA };
}

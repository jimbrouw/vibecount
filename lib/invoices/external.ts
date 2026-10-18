import { exactObject } from '../fx/currency';
import { fxEvidenceId, parseFxEvidenceCatalog, type FxInvoiceDocumentData } from '../fx/document-facts';
import { redactBankDetailsForPrompt } from '../ai/redaction';
export type ExternalInvoiceIntent = {
  schema_version: 'external-invoice-intent/1'; request_id: string; invoice_id: string; client_id: string;
  source_fact_revision_id: string; source_fact_family_id: string; expected_revision: number; expected_updated_at: string | null;
  expected_stamp: string; original_sha256: string; human_read_original: boolean; reason: string;
};
export function externalInvoiceIntent(value: unknown): ExternalInvoiceIntent {
  const r = exactObject(value, ['schema_version','request_id','invoice_id','client_id','source_fact_revision_id','source_fact_family_id','expected_revision','expected_updated_at','expected_stamp','original_sha256','human_read_original','reason']);
  if (r.schema_version !== 'external-invoice-intent/1' || !Number.isSafeInteger(r.expected_revision) || (r.expected_revision as number) < 0 || (r.expected_revision as number) > 2147483646 || r.human_read_original !== true || typeof r.reason !== 'string' || !r.reason.trim() || r.reason.trim().length > 1000 ||
    typeof r.expected_stamp !== 'string' || !/^[a-f0-9]{32}$/.test(r.expected_stamp) || r.expected_stamp.length !== 32 || typeof r.original_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(r.original_sha256) || r.original_sha256.length !== 64 ||
    (r.expected_revision === 0 ? r.expected_updated_at !== null : typeof r.expected_updated_at !== 'string' || r.expected_updated_at.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(r.expected_updated_at) || !Number.isFinite(Date.parse(r.expected_updated_at)))) throw new Error('Review the exact original and canonical revision.');
  const reason = redactBankDetailsForPrompt(r.reason.trim()); if (reason.length > 1000) throw new Error('Shorten the review reason.');
  return { schema_version: 'external-invoice-intent/1', request_id: fxEvidenceId(r.request_id), invoice_id: fxEvidenceId(r.invoice_id), client_id: fxEvidenceId(r.client_id), source_fact_revision_id: fxEvidenceId(r.source_fact_revision_id), source_fact_family_id: fxEvidenceId(r.source_fact_family_id), expected_revision: r.expected_revision as number, expected_updated_at: r.expected_updated_at as string | null, expected_stamp: r.expected_stamp, original_sha256: r.original_sha256, human_read_original: true, reason };
}
export type ExternalInvoiceRow = { id: string; user_id: string; client_id: string; source_fact_family_id: string; source_fact_revision_id: string; external_revision: number; updated_at: string; currency: import('../fx/currency').CurrencyCode; original_total_minor: number; number: string; invoice_date: string };
export type ExternalInvoiceContext = { owner: string; stamp: string; evidence: unknown; clients: { id: string; user_id: string; name: string }[]; invoices: ExternalInvoiceRow[] };
export function externalInvoiceReadback(owner: string, value: unknown, context: ExternalInvoiceContext) {
  const intent = externalInvoiceIntent(value), catalog = parseFxEvidenceCatalog(owner, context.evidence);
  if (context.owner !== owner || context.stamp !== intent.expected_stamp) throw new Error('External invoice context changed.');
  const fact = catalog.facts.find(f => f.id === intent.source_fact_revision_id && f.family_id === intent.source_fact_family_id && f.kind === 'invoice' && f.usable);
  const client = context.clients.find(c => c.id === intent.client_id && c.user_id === owner);
  if (!fact || !client || fact.source_snapshot.document_source.document.file_sha256 !== intent.original_sha256) throw new Error('Current owned original and client required.');
  const existing = context.invoices.find(i => i.id === intent.invoice_id);
  const family = context.invoices.find(i => i.source_fact_family_id === fact.family_id);
  if (intent.expected_revision === 0 ? !!existing || !!family : !existing || existing.user_id !== owner || existing.source_fact_family_id !== fact.family_id || existing.external_revision !== intent.expected_revision || existing.updated_at !== intent.expected_updated_at || existing.source_fact_revision_id === fact.id || family?.id !== existing.id) throw new Error('Canonical invoice revision changed.');
  return { intent, fact, client, original: fact.data as FxInvoiceDocumentData, next_revision: intent.expected_revision + 1, scope: 'preserved_document_only_no_accounting_or_settlement' as const };
}
export function externalInvoiceResult(value: unknown, intent: ExternalInvoiceIntent) {
  const r = exactObject(value, ['schema_version','invoice_id','revision_id','external_revision','source_fact_revision_id','recognized_income_change_pence','recognized_expense_change_pence','settlement_change']);
  if (r.schema_version !== 'external-invoice-result/1' || fxEvidenceId(r.invoice_id) !== intent.invoice_id || fxEvidenceId(r.revision_id) !== intent.request_id || r.external_revision !== intent.expected_revision + 1 || fxEvidenceId(r.source_fact_revision_id) !== intent.source_fact_revision_id || r.recognized_income_change_pence !== 0 || r.recognized_expense_change_pence !== 0 || r.settlement_change !== 0) throw new Error('External invoice result unavailable.');
  return { invoice_id: intent.invoice_id, revision_id: intent.request_id, external_revision: intent.expected_revision + 1 };
}

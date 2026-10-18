import 'server-only';
import { readAllExportRows } from '../records/export-pages';
import { readFxEvidenceCatalog } from '../fx/document-facts-store';
import { verifyOwnedInvoiceSource } from '../fx/retained-source-store';
import { sourceReadIntent } from '../fx/retained-source';
import { fxEvidenceId, validateFxDocumentData, type FxInvoiceDocumentData } from '../fx/document-facts';
import { currencyCode } from '../fx/currency';
import { INVOICE_REPORTING_COLUMNS, invoiceOriginalAmount } from './reporting';
import { redactBankDetailsForPrompt } from '../ai/redaction';
import { externalInvoiceIntent, externalInvoiceReadback, externalInvoiceResult, type ExternalInvoiceContext, type ExternalInvoiceRow } from './external';
type Client = Awaited<ReturnType<typeof import('../supabase/server').createClient>>;
export async function readExternalInvoiceStamp(db: Client) {
  const r = await db.rpc('external_invoice_review_stamp');
  if (r.error || typeof r.data !== 'string' || r.data.length !== 32 || !/^[a-f0-9]{32}$/.test(r.data)) throw new Error('External invoice context unavailable.');
  return r.data as string;
}
export async function readExternalInvoiceContext(db: Client, owner: string): Promise<ExternalInvoiceContext> {
  const stamp = await readExternalInvoiceStamp(db), evidence = await readFxEvidenceCatalog(db, owner);
  let count = 0;
  const clients = await readAllExportRows(async after => {
    let q = db.from('clients').select('id,user_id,name').eq('user_id', owner).order('id').limit(500); if (after) q = q.gt('id', after);
    const r = await q; count += r.data?.length ?? 0; if (count > 10000) throw new Error('Client catalog exceeds safe review capacity.'); return r;
  });
  count = 0;
  const rows = await readAllExportRows(async after => {
    let q = db.from('invoices').select(`${INVOICE_REPORTING_COLUMNS},user_id,client_id,external_revision,updated_at,number,invoice_date`).eq('user_id', owner).eq('origin', 'preserved_external').order('id').limit(500); if (after) q = q.gt('id', after);
    const r = await q; count += r.data?.length ?? 0; if (count > 10000) throw new Error('Canonical catalog exceeds safe review capacity.'); return r;
  });
  if (await readExternalInvoiceStamp(db) !== stamp) throw new Error('External invoice context changed during read.');
  const safeClients = clients.map(c => { if (c.user_id !== owner || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 1000) throw new Error('Owned client metadata unavailable.'); return { id: fxEvidenceId(c.id), user_id: owner, name: redactBankDetailsForPrompt(c.name) }; });
  const invoices: ExternalInvoiceRow[] = rows.map(r => {
    if (r.user_id !== owner || r.origin !== 'preserved_external' || r.status !== 'finalised' || !Number.isSafeInteger(r.external_revision) || r.external_revision < 1 || typeof r.updated_at !== 'string' || !Number.isFinite(Date.parse(r.updated_at)) || typeof r.number !== 'string' || typeof r.invoice_date !== 'string') throw new Error('Canonical source metadata unavailable.');
    const original = invoiceOriginalAmount(r);
    return { id: fxEvidenceId(r.id), user_id: owner, client_id: fxEvidenceId(r.client_id), source_fact_family_id: fxEvidenceId(r.source_fact_family_id), source_fact_revision_id: fxEvidenceId(r.source_fact_revision_id), external_revision: r.external_revision, updated_at: r.updated_at, currency: original.currency, original_total_minor: original.minor, number: redactBankDetailsForPrompt(r.number), invoice_date: r.invoice_date };
  });
  if (new Set(invoices.map(r => r.source_fact_family_id)).size !== invoices.length || invoices.some(r => !safeClients.some(c => c.id === r.client_id))) throw new Error('Canonical family/client coverage unavailable.');
  return { owner, stamp, evidence, clients: safeClients, invoices };
}
export async function saveExternalInvoice(db: Client, owner: string, value: unknown) {
  const intent = externalInvoiceIntent(value);
  const old = await db.from('external_invoice_requests').select('intent,source_read_check_id,result').eq('user_id', owner).eq('request_id', intent.request_id).maybeSingle();
  if (old.error) throw new Error('External request history unavailable.');
  let proofId: string;
  if (old.data) {
    if (JSON.stringify(externalInvoiceIntent(old.data.intent)) !== JSON.stringify(intent)) throw new Error('External invoice request changed.');
    externalInvoiceResult(old.data.result, intent); proofId = fxEvidenceId(old.data.source_read_check_id);
  } else {
    externalInvoiceReadback(owner, intent, await readExternalInvoiceContext(db, owner));
    const proof = await verifyOwnedInvoiceSource(db, owner, sourceReadIntent({ schema_version: 'invoice-source-read-intent/2', request_id: intent.request_id, fact_revision_id: intent.source_fact_revision_id, reason: intent.reason, capture_intent: intent }));
    if (proof.outcome !== 'verified') throw new Error('Retained invoice copy unavailable.');
    proofId = proof.id;
  }
  const saved = await db.rpc('capture_external_invoice', { p_intent: intent, p_check: proofId });
  if (saved.error) throw new Error('External invoice capture unavailable.');
  return externalInvoiceResult(saved.data, intent);
}
export type ExternalHistory = { id: string; invoice_id: string; version: number; source_fact_revision_id: string; source_read_check_id: string; created_at: string; currency: ReturnType<typeof currencyCode>; original_total_minor: number; number: string; invoice_date: string };
export function parseExternalHistory(owner: string, rows: unknown): ExternalHistory[] {
  if (!Array.isArray(rows) || rows.length > 21) throw new Error('External history unavailable.');
  const result = rows.map(r => {
    if (!r || r.user_id !== owner || r.author !== owner || r.origin !== 'preserved_external' || !Number.isSafeInteger(r.version) || r.version < 1 || typeof r.created_at !== 'string' || !Number.isFinite(Date.parse(r.created_at))) throw new Error('External history provenance unavailable.');
    const s = r.snapshot;
    if (!s || s.schema_version !== 'preserved-external-invoice/1' || s.invoice_id !== r.invoice_id || s.external_revision !== r.version || s.source_fact_revision_id !== r.source_fact_revision_id || typeof s.number !== 'string' || typeof s.invoice_date !== 'string') throw new Error('External history snapshot unavailable.');
    const original = validateFxDocumentData('invoice', { currency: s.currency, original_total_minor: s.original_total_minor, invoice_reference: s.number, invoice_date: s.invoice_date }) as FxInvoiceDocumentData;
    return { id: fxEvidenceId(r.id), invoice_id: fxEvidenceId(r.invoice_id), version: r.version, source_fact_revision_id: fxEvidenceId(r.source_fact_revision_id), source_read_check_id: fxEvidenceId(r.source_read_check_id), created_at: r.created_at, currency: original.currency, original_total_minor: original.original_total_minor, number: original.invoice_reference, invoice_date: original.invoice_date };
  });
  if (new Set(result.map(r => r.id)).size !== result.length) throw new Error('Duplicate external history.');
  return result;
}

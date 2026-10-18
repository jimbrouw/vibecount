import { decryptSource, documentContext, sourceHash } from '../records/source-crypto';
import { redactBankDetailsForPrompt } from '../ai/redaction';
import { fxEvidenceId, parseFxEvidenceCatalog, type FxEvidenceCatalog } from './document-facts';
import { exactObject } from './currency';
import { externalInvoiceIntent, type ExternalInvoiceIntent } from '../invoices/external';
export type SourceReadIntent = { request_id: string; fact_revision_id: string; reason: string } & ({ schema_version: 'invoice-source-read-intent/1' } | { schema_version: 'invoice-source-read-intent/2'; capture_intent: ExternalInvoiceIntent });
export function sourceReadIntent(value: unknown): SourceReadIntent {
  const extended = !!value && typeof value === 'object' && 'schema_version' in value && value.schema_version === 'invoice-source-read-intent/2';
  const r = exactObject(value, ['schema_version', 'request_id', 'fact_revision_id', 'reason', ...(extended ? ['capture_intent'] : [])]);
  if ((!extended && r.schema_version !== 'invoice-source-read-intent/1') || typeof r.reason !== 'string' || !r.reason.trim() || r.reason.trim().length > 1000) throw new Error('Review an exact invoice source check.');
  const reason = redactBankDetailsForPrompt(r.reason.trim());
  if (reason.length > 1000) throw new Error('Shorten the source check reason.');
  const base = { request_id: fxEvidenceId(r.request_id), fact_revision_id: fxEvidenceId(r.fact_revision_id), reason };
  if (!extended) return { schema_version: 'invoice-source-read-intent/1', ...base };
  const capture = externalInvoiceIntent(r.capture_intent);
  if (capture.request_id !== base.request_id || capture.source_fact_revision_id !== base.fact_revision_id || capture.reason !== reason) throw new Error('Capture-bound source check differs.');
  return { schema_version: 'invoice-source-read-intent/2', ...base, capture_intent: capture };
}
export function selectedInvoiceSource(owner: string, input: SourceReadIntent, value: unknown) {
  const catalog = parseFxEvidenceCatalog(owner, value), intent = sourceReadIntent(input);
  const fact = catalog.facts.find(f => f.id === intent.fact_revision_id && f.kind === 'invoice' && f.usable);
  if (!fact || !fact.source_snapshot.document_source.available || !fact.source_snapshot.document_source.invoice_scope || fact.source_snapshot.document_source.registration.purpose !== 'invoice') throw new Error('Choose current verified owned invoice evidence.');
  return fact;
}
export type SourceReadFact = ReturnType<typeof selectedInvoiceSource>;
export type PrivateSourceMetadata = { id: string; user_id: string; file_hash: string; media_type: string; size_bytes: number; object_path: string; key_id: string };
export function validateRetainedSourceMetadata(owner: string, fact: Pick<SourceReadFact, 'document_id' | 'source_snapshot'>, metadata: PrivateSourceMetadata) {
  const d = fact.source_snapshot.document_source.document;
  if (metadata.user_id !== owner || metadata.id !== fact.document_id || metadata.id !== d.id || metadata.file_hash !== d.file_sha256 || metadata.media_type !== d.media_type || metadata.size_bytes !== d.size_bytes ||
      typeof metadata.object_path !== 'string' || !new RegExp('^' + fxEvidenceId(owner) + '/[0-9a-f-]{36}/(?:0|[1-9][0-9]{0,2})\\.enc$').test(metadata.object_path) ||
      typeof metadata.key_id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(metadata.key_id) || !Number.isSafeInteger(metadata.size_bytes) || metadata.size_bytes < 1 || metadata.size_bytes > 3000000) throw new Error('Retained invoice metadata or size differs.');
}
/** Decrypt only on the server. Never return plaintext, a path or a key to a browser/agent. */
export function verifyRetainedInvoiceBytes(owner: string, fact: Pick<SourceReadFact, 'document_id' | 'source_snapshot'>, metadata: PrivateSourceMetadata, cipher: Uint8Array, key: Uint8Array) {
  validateRetainedSourceMetadata(owner, fact, metadata);
  if (cipher.length !== metadata.size_bytes + 29) throw new Error('Retained invoice size differs.');
  let bytes: Buffer | undefined;
  try {
    bytes = decryptSource(cipher, key, documentContext(owner, metadata.file_hash));
    if (bytes.length !== metadata.size_bytes || sourceHash(bytes) !== metadata.file_hash) throw new Error('Retained invoice hash differs.');
    const pdf = /^%PDF-\d\.\d/.test(bytes.subarray(0, 8).toString('ascii')) && bytes.subarray(-1024).includes(Buffer.from('%%EOF'));
    const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg = bytes.length >= 5 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
    if (!(metadata.media_type === 'application/pdf' && pdf || metadata.media_type === 'image/png' && png || metadata.media_type === 'image/jpeg' && jpeg)) throw new Error('Retained invoice file signature differs.');
    return { document_id: metadata.id, file_sha256: metadata.file_hash, media_type: metadata.media_type, size_bytes: metadata.size_bytes };
  } finally { bytes?.fill(0); }
}
export type SourceReadCheck = { id: string; user_id: string; request_id: string; intent: SourceReadIntent; fact_revision_id: string; document_id: string; source_snapshot: SourceReadFact['source_snapshot']; outcome: 'verified' | 'unavailable'; author: string; checked_at: string };
export function parseSourceReadCheck(owner: string, value: unknown): SourceReadCheck {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Source check history unavailable.');
  const r = value as Record<string, unknown>, intent = sourceReadIntent(r.intent);
  if (r.user_id !== owner || r.author !== owner || r.request_id !== intent.request_id || r.fact_revision_id !== intent.fact_revision_id || typeof r.outcome !== 'string' || !['verified', 'unavailable'].includes(r.outcome) || typeof r.checked_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(r.checked_at) || !Number.isFinite(Date.parse(r.checked_at))) throw new Error('Source check provenance unavailable.');
  // Reuse the existing safe source parser with a detached synthetic projection of the retained fact.
  const source = exactObject(r.source_snapshot, ['document_source']);
  const raw = source.document_source as Record<string, unknown>;
  const document = raw?.document as Record<string, unknown>;
  const catalog = parseFxEvidenceCatalog(owner, { schema_version: 'fx-evidence-catalog/1', owner_id: owner, ruleset_id: 'vibecount-currencies/1', stamp: '0'.repeat(32), counts: { documents: 1, receipts: 0, facts: 0 }, documents: [{ id: r.document_id, source: raw }], receipts: [], facts: [], financial_action: 'evidence_preparation_only' });
  if (document?.id !== r.document_id || catalog.documents[0].source.registration.purpose !== 'invoice') throw new Error('Source check document mismatch.');
  return { id: fxEvidenceId(r.id), user_id: owner, request_id: intent.request_id, intent, fact_revision_id: intent.fact_revision_id, document_id: fxEvidenceId(r.document_id), source_snapshot: { document_source: catalog.documents[0].source }, outcome: r.outcome as SourceReadCheck['outcome'], author: owner, checked_at: r.checked_at };
}
export async function checkRetainedInvoiceSource(owner: string, value: unknown, dependencies: {
  recover(request: string): Promise<unknown | null>; catalog(): Promise<FxEvidenceCatalog>;
  metadata(document: string): Promise<PrivateSourceMetadata>; key(id: string): Uint8Array;
  download(path: string, expectedSize: number): Promise<Uint8Array>;
  record(intent: SourceReadIntent, source: SourceReadFact['source_snapshot'], outcome: SourceReadCheck['outcome']): Promise<unknown>;
}) {
  const intent = sourceReadIntent(value), old = await dependencies.recover(intent.request_id);
  if (old !== null) {
    const retained = parseSourceReadCheck(owner, old);
    if (JSON.stringify(retained.intent) !== JSON.stringify(intent)) throw new Error('Source check request changed.');
    return retained;
  }
  const fact = selectedInvoiceSource(owner, intent, await dependencies.catalog());
  let outcome: SourceReadCheck['outcome'] = 'verified';
  try {
    const metadata = await dependencies.metadata(fact.document_id);
    // Validate owner/path before any object read, and load only the recorded retained key.
    validateRetainedSourceMetadata(owner, fact, metadata);
    const key = dependencies.key(metadata.key_id);
    try { verifyRetainedInvoiceBytes(owner, fact, metadata, await dependencies.download(metadata.object_path, metadata.size_bytes + 29), key); }
    finally { key.fill(0); }
  } catch { outcome = 'unavailable'; }
  // A failed/uncertain audit response is never downgraded or replaced with a success claim.
  const saved = parseSourceReadCheck(owner, await dependencies.record(intent, fact.source_snapshot, outcome));
  if (JSON.stringify(saved.intent) !== JSON.stringify(intent) || saved.outcome !== outcome || JSON.stringify(saved.source_snapshot) !== JSON.stringify(fact.source_snapshot)) throw new Error('Source check result differs.');
  return saved;
}

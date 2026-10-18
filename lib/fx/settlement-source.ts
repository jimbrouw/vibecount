import { fxEvidenceId, parseFxSourceSnapshot } from './document-facts';
import { authoritativeFxSettlementReview, parseFxSettlementCatalog, type FxAuthoritativeCatalog } from './settlement-catalog';
import { validateFxSettlementIntent } from './settlement';
import { validateRetainedSourceMetadata, verifyRetainedInvoiceBytes, type PrivateSourceMetadata } from './retained-source';
import { fxHistoryEqual } from './settlement-history';
export type SettlementSource = {
  fact_revision_id: string; kind: 'invoice' | 'conversion'; document_id: string;
  source_snapshot: ReturnType<typeof parseFxSourceSnapshot>;
};
export function sourcesForIntent(value: unknown, intent: ReturnType<typeof validateFxSettlementIntent>): SettlementSource[] {
  if (!Array.isArray(value) || value.length > 100 || new TextEncoder().encode(JSON.stringify(value)).length > 2000000) throw new Error('Complete settlement source proof unavailable.');
  const expected = new Map<string, 'invoice' | 'conversion'>();
  for (const a of intent.allocations) {
    for (const [id, kind] of [[a.invoice_evidence_revision_id, 'invoice'], [a.conversion_evidence_revision_id, 'conversion']] as const) {
      if (expected.has(id) && expected.get(id) !== kind) throw new Error('Settlement fact kinds disagree.');
      expected.set(id, kind);
    }
  }
  const result = value.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Safe settlement source unavailable.');
    const r = raw as Record<string, unknown>, id = fxEvidenceId(r.fact_revision_id), kind = expected.get(id);
    if (!kind || r.kind !== kind) throw new Error('Selected settlement source differs.');
    const document_id = fxEvidenceId(r.document_id), source_snapshot = parseFxSourceSnapshot(r.source_snapshot, kind);
    if (source_snapshot.document_source.document.id !== document_id) throw new Error('Settlement document identity differs.');
    if (kind === 'conversion') {
      const allocations = intent.allocations.filter(a => a.conversion_evidence_revision_id === id);
      if (!source_snapshot.receipt || !source_snapshot.invoice_evidence || source_snapshot.receipt.id !== intent.receipt_id || source_snapshot.receipt.decision_version !== intent.receipt_version || allocations.some(a => a.invoice_evidence_revision_id !== source_snapshot.invoice_evidence?.id)) throw new Error('Settlement conversion source closure differs.');
    }
    return { fact_revision_id: id, kind, document_id, source_snapshot };
  }).sort((a, b) => a.fact_revision_id < b.fact_revision_id ? -1 : a.fact_revision_id > b.fact_revision_id ? 1 : 0);
  if (result.length !== expected.size || new Set(result.map(r => r.fact_revision_id)).size !== expected.size) throw new Error('Complete unique settlement facts required.');
  const byFact = new Map(result.map(r => [r.fact_revision_id, r]));
  for (const a of intent.allocations) {
    const invoice = byFact.get(a.invoice_evidence_revision_id)!, conversion = byFact.get(a.conversion_evidence_revision_id)!;
    const parent = conversion.source_snapshot.invoice_evidence, document = invoice.source_snapshot.document_source;
    if (document.registration.purpose !== 'invoice' || !document.invoice_scope || !parent || parent.family_id !== a.invoice_evidence_id || parent.document_id !== invoice.document_id) throw new Error('Settlement invoice/conversion evidence ancestry differs.');
  }
  // One retained document cannot carry contradictory hash/size/type metadata.
  const docs = new Map<string, unknown>();
  for (const source of result) {
    const d = source.source_snapshot.document_source.document;
    if (docs.has(d.id) && !fxHistoryEqual(docs.get(d.id), d)) throw new Error('Retained settlement document metadata differs.');
    docs.set(d.id, d);
  }
  return result;
}
export function selectedSettlementSources(owner: string, value: unknown, rawCatalog: unknown) {
  const intent = validateFxSettlementIntent(value), catalog = parseFxSettlementCatalog(owner, rawCatalog);
  authoritativeFxSettlementReview(owner, intent, catalog);
  const ids = new Set(intent.allocations.flatMap(a => [a.invoice_evidence_revision_id, a.conversion_evidence_revision_id]));
  return sourcesForIntent(catalog.evidence.facts.filter(f => ids.has(f.id)).map(f => ({ fact_revision_id: f.id, kind: f.kind, document_id: f.document_id, source_snapshot: f.source_snapshot })), intent);
}
export function parseSettlementSourceCheck(ownerValue: string, value: unknown) {
  const owner = fxEvidenceId(ownerValue);
  if (!value || typeof value !== 'object' || Array.isArray(value) || new TextEncoder().encode(JSON.stringify(value)).length > 2200000) throw new Error('Complete settlement source check unavailable.');
  const r = value as Record<string, unknown>, intent = validateFxSettlementIntent(r.intent);
  if (r.user_id !== owner || r.author !== owner || r.request_id !== intent.request_id || (typeof r.outcome !== 'string' || !['verified', 'unavailable'].includes(r.outcome)) || typeof r.checked_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(r.checked_at) || !Number.isFinite(Date.parse(r.checked_at))) throw new Error('Owned settlement source check unavailable.');
  return { id: fxEvidenceId(r.id), user_id: owner, request_id: intent.request_id, intent, sources: sourcesForIntent(r.sources, intent), outcome: r.outcome as 'verified' | 'unavailable', author: owner, checked_at: r.checked_at };
}
export type SettlementSourceCheck = ReturnType<typeof parseSettlementSourceCheck>;
/** Private bytes are neither returned nor persisted in a proof. A verified check
 * proves size/hash/signature at read time, not readability or accounting meaning.
 */
export async function checkSettlementSources(ownerValue: string, value: unknown, dependencies: {
  recover(request: string): Promise<unknown | null>;
  catalog(): Promise<FxAuthoritativeCatalog>;
  metadata(document: string): Promise<PrivateSourceMetadata>;
  key(id: string): Uint8Array;
  download(path: string, expectedSize: number): Promise<Uint8Array>;
  record(intent: ReturnType<typeof validateFxSettlementIntent>, sources: SettlementSource[], outcome: 'verified' | 'unavailable'): Promise<unknown>;
}) {
  const owner = fxEvidenceId(ownerValue), intent = validateFxSettlementIntent(value), prior = await dependencies.recover(intent.request_id);
  if (prior !== null) {
    const saved = parseSettlementSourceCheck(owner, prior);
    if (!fxHistoryEqual(saved.intent, intent)) throw new Error('Settlement source-check request changed.');
    return saved;
  }
  const sources = selectedSettlementSources(owner, intent, await dependencies.catalog());
  let outcome: 'verified' | 'unavailable' = 'verified';
  const documents = new Set<string>();
  for (const source of sources) {
    if (documents.has(source.document_id)) continue;
    documents.add(source.document_id);
    try {
      const metadata = await dependencies.metadata(source.document_id);
      const fact = { document_id: source.document_id, source_snapshot: source.source_snapshot };
      validateRetainedSourceMetadata(owner, fact, metadata);
      const key = dependencies.key(metadata.key_id);
      try {
        // Both fact kinds have the same owned document snapshot; no invoice-only
        // source selection or capture proof is repurposed here.
        verifyRetainedInvoiceBytes(owner, fact, metadata, await dependencies.download(metadata.object_path, metadata.size_bytes + 29), key);
      } finally { key.fill(0); }
    } catch { outcome = 'unavailable'; }
  }
  const saved = parseSettlementSourceCheck(owner, await dependencies.record(intent, sources, outcome));
  if (!fxHistoryEqual(saved.intent, intent) || !fxHistoryEqual(saved.sources, sources) || saved.outcome !== outcome) throw new Error('Settlement source check result differs.');
  return saved;
}

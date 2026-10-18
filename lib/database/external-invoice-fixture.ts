import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { invoiceSourceReadFixture } from './invoice-source-read-fixture';
import { externalInvoiceIntent } from '../invoices/external';
import { checkRetainedInvoiceSource, sourceReadIntent } from '../fx/retained-source';
import { parseFxEvidenceCatalog } from '../fx/document-facts';
export async function externalInvoiceFixture(db: PGlite) {
  const f = await invoiceSourceReadFixture(db), client = randomUUID(), native = randomUUID(), revision = randomUUID();
  await db.exec('reset role'); await db.query("insert into clients(id,user_id,name) values($1,$2,'Synthetic external client')", [client, f.owner]);
  const path = f.owner + '/revisions/' + revision + '.pdf'; await db.query("insert into storage.objects(bucket_id,name) values('invoices',$1)", [path]);
  const nativeArgs = [native, revision, null, JSON.stringify({ client_id: client, number: 'NATIVE-120', invoice_date: '2026-04-05', due_date: null, description: 'Synthetic native parity', payment_terms: '30 days', net_pence: 12000, vat_pence: 0, vat_rate_bps: 0, vat_enabled: false, vat_number: '', reason: 'Reviewed native original' }), path, 'a'.repeat(64)];
  await f.auth(); const nativeResult = (await db.query<{ r: unknown }>('select save_invoice_revision($1,$2,$3,$4,$5,$6) r', nativeArgs)).rows[0].r;
  const nativeRow = (await db.query<{ r: unknown }>('select to_jsonb(i) r from invoices i where id=$1', [native])).rows[0].r;
  const nativeHistory = (await db.query<{ r: unknown }>('select to_jsonb(i) r from invoice_revisions i where id=$1', [revision])).rows[0].r;
  const catalog = async () => { await f.auth(); return parseFxEvidenceCatalog(f.owner, (await db.query<{ r: unknown }>('select read_fx_evidence_catalog() r')).rows[0].r); };
  const intent = async (invoice: string = randomUUID(), expected = 0) => {
    const c = await catalog(), fact = c.facts.find(r => r.family_id === f.fact.family_id)!;
    const row = (await db.query<{ t: string }>('select to_jsonb(updated_at) t from invoices where id=$1', [invoice])).rows[0];
    const stamp = (await db.query<{ r: string }>('select external_invoice_review_stamp() r')).rows[0].r;
    return externalInvoiceIntent({ schema_version: 'external-invoice-intent/1', request_id: randomUUID(), invoice_id: invoice, client_id: client, source_fact_revision_id: fact.id, source_fact_family_id: fact.family_id, expected_revision: expected, expected_updated_at: expected ? row.t : null, expected_stamp: stamp, original_sha256: f.metadata.file_hash, human_read_original: true, reason: 'Synthetic canonical review' });
  };
  const proof = async (input: ReturnType<typeof externalInvoiceIntent>) => checkRetainedInvoiceSource(f.owner, sourceReadIntent({ schema_version: 'invoice-source-read-intent/2', request_id: input.request_id, fact_revision_id: input.source_fact_revision_id, reason: input.reason, capture_intent: input }), {
    recover: async () => null, catalog, metadata: async () => f.metadata, key: () => Buffer.from(f.key), download: async () => f.cipher,
    record: async (i, source, outcome) => { await f.service(); return (await db.query<{ r: unknown }>('select record_invoice_source_read($1,$2,$3,$4) r', [f.owner, JSON.stringify(i), JSON.stringify(source), outcome])).rows[0].r; },
  });
  const capture = async (input: ReturnType<typeof externalInvoiceIntent>, proofId: string) => { await f.auth(); return (await db.query<{ r: unknown }>('select capture_external_invoice($1,$2) r', [JSON.stringify(input), proofId])).rows[0].r; };
  return { ...f, client, native, revision, nativeArgs, nativeResult, nativeRow, nativeHistory, catalog, intent, proof, capture };
}

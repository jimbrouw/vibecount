// Real encryption and predecessor SQL, with synthetic document bytes and no hosted object.
import { randomBytes, randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { encryptSource, documentContext, sourceHash } from '../records/source-crypto';
import { parseFxEvidenceCatalog } from '../fx/document-facts';
import { sourceReadIntent } from '../fx/retained-source';
export async function invoiceSourceReadFixture(db: PGlite) {
  const owner = randomUUID(), other = randomUUID(), attempt = randomUUID(), family = randomUUID();
  const bytes = Buffer.from('%PDF-1.7\nSynthetic invoice source\n%%EOF'), hash = sourceHash(bytes), key = randomBytes(32), path = owner + '/' + attempt + '/0.enc';
  const cipher = encryptSource(bytes, key, documentContext(owner, hash));
  await db.query('insert into auth.users(id) values($1),($2)', [owner, other]);
  await db.query("insert into document_upload_attempts(id,user_id,file_hash,state,planned_objects) values($1,$2,$3,'uploaded',$4)", [attempt, owner, hash, JSON.stringify([{ hash, size: bytes.length, media_type: 'application/pdf', path, key_id: 'synthetic-v1', name_encrypted: 'SYNTHETIC_NAME' }])]);
  await db.query("insert into storage.objects(bucket_id,name) values('document-evidence',$1)", [path]);
  const auth = async (user = owner) => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); await db.exec('set role authenticated'); };
  const service = async () => { await db.exec('reset role;set role service_role'); };
  await service(); await db.query("select register_document_intake($1,$2,2025,'invoice','opaque-evidence/1')", [owner, attempt]);
  await db.exec('reset role'); const metadata = (await db.query<{ id: string }>('select id from evidence_documents where user_id=$1 and file_hash=$2', [owner, hash])).rows[0];
  await auth(); const stamp = (await db.query<{ r: string }>('select fx_evidence_review_stamp() r')).rows[0].r;
  const factIntent = { schema_version: 'fx-document-fact-intent/1', ruleset_id: 'vibecount-currencies/1', family_id: family, expected_ordinal: 0, kind: 'invoice', state: 'verified', document_id: metadata.id, invoice_evidence_revision_id: null, transaction_id: null, transaction_version: null, data: { currency: 'KWD', original_total_minor: 10001, invoice_date: '2026-04-05', invoice_reference: 'SYNTHETIC-1' }, human_read_original: true, expected_stamp: stamp, rationale: 'Synthetic original reviewed', request_id: randomUUID() };
  const factResult = (await db.query<{ r: { revision_id: string } }>('select review_fx_document_evidence($1) r', [JSON.stringify(factIntent)])).rows[0].r;
  const catalog = parseFxEvidenceCatalog(owner, (await db.query<{ r: unknown }>('select read_fx_evidence_catalog() r')).rows[0].r);
  const fact = catalog.facts.find(f => f.id === factResult.revision_id)!;
  const input = sourceReadIntent({ schema_version: 'invoice-source-read-intent/1', request_id: randomUUID(), fact_revision_id: fact.id, reason: 'Synthetic retained copy check' });
  return { owner, other, bytes, cipher, key, path, metadata: { id: metadata.id, user_id: owner, file_hash: hash, media_type: 'application/pdf', size_bytes: bytes.length, object_path: path, key_id: 'synthetic-v1' }, fact, catalog, input, factIntent, factResult, auth, service };
}

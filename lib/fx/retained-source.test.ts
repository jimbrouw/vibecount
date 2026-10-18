import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { fxDocumentFactsFixture } from './document-facts-fixture';
import { fxFixtureId as id } from './fixture';
import { checkRetainedInvoiceSource, parseSourceReadCheck, selectedInvoiceSource, sourceReadIntent, verifyRetainedInvoiceBytes } from './retained-source';
import { encryptSource, documentContext, sourceHash } from '../records/source-crypto';

function fixture() {
  const f = fxDocumentFactsFixture(), bytes = Buffer.from('%PDF-1.7\nSynthetic PRIVATE source text\n%%EOF'), hash = sourceHash(bytes), key = randomBytes(32);
  f.source.document.file_sha256 = hash; f.source.document.size_bytes = bytes.length;
  f.invoice.source_snapshot.document_source = structuredClone(f.source); f.catalog.facts = [f.invoice]; f.catalog.counts.facts = 1;
  const input = sourceReadIntent({ schema_version: 'invoice-source-read-intent/1', request_id: id(90), fact_revision_id: f.invoice.id, reason: 'Check retained invoice copy' });
  const fact = selectedInvoiceSource(f.owner, input, f.catalog), metadata = { id: f.source.document.id, user_id: f.owner, file_hash: hash, media_type: 'application/pdf', size_bytes: bytes.length, object_path: f.owner + '/' + id(91) + '/0.enc', key_id: 'retained-v1' };
  const cipher = encryptSource(bytes, key, documentContext(f.owner, hash));
  const check = { id: id(92), user_id: f.owner, request_id: input.request_id, intent: input, fact_revision_id: fact.id, document_id: fact.document_id, source_snapshot: fact.source_snapshot, outcome: 'verified' as const, author: f.owner, checked_at: '2026-10-18T10:00:00Z' };
  const calls: string[] = [], deps = {
    recover: async () => { calls.push('recover'); return null as unknown | null; }, catalog: async () => { calls.push('catalog'); return f.catalog as never; },
    metadata: async () => { calls.push('metadata'); return metadata; }, key: (keyId: string) => { calls.push('key:' + keyId); return Buffer.from(key); },
    download: async () => { calls.push('download'); return cipher; },
    record: async (_intent: unknown, _source: unknown, outcome: 'verified' | 'unavailable') => { calls.push('record:' + outcome); return { ...check, outcome }; },
  };
  return { ...f, bytes, key, hash, cipher, input, fact, metadata, check, calls, deps };
}
test('private retained read authenticates ciphertext, owner/hash binding, length and PDF signature with safe proof only', async () => {
  const f = fixture(), proof = verifyRetainedInvoiceBytes(f.owner, f.fact, f.metadata, f.cipher, f.key);
  assert.deepEqual(proof, { document_id: f.source.document.id, file_sha256: f.hash, media_type: 'application/pdf', size_bytes: f.bytes.length }); assert.doesNotMatch(JSON.stringify(proof), /PRIVATE|\.enc|key_id/);
  const saved = await checkRetainedInvoiceSource(f.owner, f.input, f.deps);
  assert.equal(saved.outcome, 'verified'); assert.deepEqual(f.calls, ['recover', 'catalog', 'metadata', 'key:retained-v1', 'download', 'record:verified']); assert.equal(f.bytes.includes(Buffer.from('PRIVATE')), true);
});
test('tamper, wrong key/context/hash/size/type and unsafe private metadata never produce readable proof', async () => {
  for (const failure of ['tamper', 'key', 'context', 'size', 'hash', 'signature', 'owner', 'path', 'type']) {
    const f = fixture(); let cipher: Uint8Array = Buffer.from(f.cipher); let key: Uint8Array = f.key;
    if (failure === 'tamper') cipher[30] ^= 1; if (failure === 'key') key = randomBytes(32); if (failure === 'context') cipher = encryptSource(f.bytes, key, documentContext(id(99), f.hash));
    if (failure === 'size') cipher = cipher.subarray(1); if (failure === 'hash') f.metadata.file_hash = 'a'.repeat(64); if (failure === 'owner') f.metadata.user_id = id(99); if (failure === 'path') f.metadata.object_path = f.owner + '/../private.enc'; if (failure === 'type') f.metadata.media_type = 'image/png';
    if (failure === 'signature') { const bytes = Buffer.from('PRIVATE unsupported plaintext'), hash = sourceHash(bytes); Object.assign(f.metadata, { file_hash: hash, size_bytes: bytes.length }); Object.assign(f.fact.source_snapshot.document_source.document, { file_sha256: hash, size_bytes: bytes.length }); cipher = encryptSource(bytes, key, documentContext(f.owner, hash)); }
    assert.throws(() => verifyRetainedInvoiceBytes(f.owner, f.fact, f.metadata, cipher, key), failure);
  }
  for (const failure of ['missing', 'key', 'foreign', 'path', 'private-size']) {
    const f = fixture();
    if (failure === 'missing') f.deps.download = async () => { throw new Error('PRIVATE_PATH'); }; if (failure === 'key') f.deps.key = () => { throw new Error('PRIVATE_KEY'); };
    if (failure === 'foreign') f.metadata.user_id = id(99); if (failure === 'path') f.metadata.object_path = f.owner + '/../other.enc'; if (failure === 'private-size') f.metadata.size_bytes = 3000001;
    const saved = await checkRetainedInvoiceSource(f.owner, f.input, f.deps); assert.equal(saved.outcome, 'unavailable', failure);
    if (['foreign', 'path', 'private-size'].includes(failure)) assert.ok(!f.calls.includes('download'));
    assert.doesNotMatch(JSON.stringify(saved), /PRIVATE|\.enc|key_id/);
  }
});
test('exact success and failure recovery bypass current keys/objects; altered requests and uncertain audit never become success', async () => {
  for (const outcome of ['verified', 'unavailable'] as const) {
    const f = fixture(); f.deps.recover = async () => ({ ...f.check, outcome }); f.deps.catalog = async () => { throw new Error('Must not read mutable source'); };
    assert.equal((await checkRetainedInvoiceSource(f.owner, f.input, f.deps)).outcome, outcome); assert.deepEqual(f.calls, []);
    await assert.rejects(checkRetainedInvoiceSource(f.owner, { ...f.input, reason: 'Different review' }, f.deps), /request changed/);
  }
  const f = fixture(); f.deps.record = async () => { f.calls.push('uncertain-audit'); throw new Error('PRIVATE'); };
  await assert.rejects(checkRetainedInvoiceSource(f.owner, f.input, f.deps)); assert.deepEqual(f.calls.slice(-1), ['uncertain-audit']); assert.ok(!f.calls.includes('record:unavailable'));
});
test('strict source intents/current invoice selection and retained provenance reject malformed or foreign claims', () => {
  const f = fixture();
  for (const patch of [{ extra: 'private' }, { request_id: null }, { reason: '' }, { reason: 'x'.repeat(1001) }, { schema_version: 'future' }]) assert.throws(() => sourceReadIntent({ ...f.input, ...patch }));
  assert.doesNotMatch(sourceReadIntent({ ...f.input, reason: 'Source 12345678' }).reason, /12345678/);
  for (const patch of [{ state: 'provisional', usable: false, human_read_original: false }, { source_current: false, usable: false }, { kind: 'conversion' }]) { const changed = structuredClone(f.catalog); Object.assign(changed.facts[0], patch); assert.throws(() => selectedInvoiceSource(f.owner, f.input, changed)); }
  for (const patch of [{ user_id: id(99) }, { author: id(99) }, { request_id: id(99) }, { fact_revision_id: id(99) }, { document_id: id(99) }, { checked_at: 'invalid' }, { outcome: 'unknown' }]) assert.throws(() => parseSourceReadCheck(f.owner, { ...f.check, ...patch }));
  const withPrivate = { ...f.check, object_path: 'PRIVATE', key_id: 'PRIVATE', source_snapshot: { document_source: { ...f.source, object_path: 'PRIVATE' } } };
  assert.doesNotMatch(JSON.stringify(parseSourceReadCheck(f.owner, withPrivate)), /PRIVATE/);
});

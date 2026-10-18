import assert from 'node:assert/strict';
import test from 'node:test';
import { fxDocumentFactsFixture } from '../fx/document-facts-fixture';
import { fxFixtureId as id } from '../fx/fixture';
import { sourceReadIntent } from '../fx/retained-source';
import { externalInvoiceIntent, externalInvoiceReadback, externalInvoiceResult, type ExternalInvoiceContext } from './external';
export function externalFixture() {
  const f = fxDocumentFactsFixture(); f.catalog.facts = [f.invoice]; f.catalog.counts.facts = 1;
  const context: ExternalInvoiceContext = { owner: f.owner, stamp: f.catalog.stamp, evidence: f.catalog, clients: [{ id: id(200), user_id: f.owner, name: 'Synthetic client' }], invoices: [] };
  const intent = externalInvoiceIntent({ schema_version: 'external-invoice-intent/1', request_id: id(201), invoice_id: id(202), client_id: id(200), source_fact_revision_id: f.invoice.id, source_fact_family_id: f.invoice.family_id, expected_revision: 0, expected_updated_at: null, expected_stamp: context.stamp, original_sha256: f.source.document.file_sha256, human_read_original: true, reason: 'Synthetic reviewed original' });
  return { f, context, intent };
}
test('external intent/readback derives original document data and rejects stale or altered authority', () => {
  const { f, context, intent } = externalFixture();
  for (const currency of ['GBP','USD','JPY','KWD']) {
    const c = structuredClone(context); (c.evidence as typeof f.catalog).facts[0].data = { ...f.intent.data, currency, original_total_minor: 10001 };
    const preview = externalInvoiceReadback(f.owner, intent, c); assert.equal(preview.original.currency, currency); assert.equal(preview.original.original_total_minor, 10001); assert.equal(preview.scope, 'preserved_document_only_no_accounting_or_settlement');
  }
  for (const patch of [{ raw: 'PRIVATE' }, { human_read_original: false }, { expected_revision: -1 }, { expected_revision: 2147483647 }, { expected_updated_at: '2026-10-18T00:00:00Z' }, { reason: ' ' }, { original_sha256: 'a'.repeat(63) }]) assert.throws(() => externalInvoiceIntent({ ...intent, ...patch }));
  for (const patch of [{ expected_stamp: 'c'.repeat(32) }, { original_sha256: 'c'.repeat(64) }, { client_id: id(900) }, { source_fact_family_id: id(900) }]) assert.throws(() => externalInvoiceReadback(f.owner, { ...intent, ...patch }, context));
  assert.throws(() => externalInvoiceReadback(id(900), intent, context));
  const stale = structuredClone(context); (stale.evidence as typeof f.catalog).facts[0].usable = false;
  assert.throws(() => externalInvoiceReadback(f.owner, intent, stale));
});
test('correction preserves canonical family/identity and requires a different current source and exact prior head', () => {
  const { f, context, intent } = externalFixture(); const updated = '2026-10-18T00:00:00Z';
  context.invoices = [{ id: intent.invoice_id, user_id: f.owner, client_id: intent.client_id, source_fact_family_id: intent.source_fact_family_id, source_fact_revision_id: id(400), external_revision: 1, updated_at: updated, currency: 'GBP', original_total_minor: 10000, number: 'OLD', invoice_date: '2026-04-01' }];
  assert.throws(() => externalInvoiceReadback(f.owner, intent, context));
  const correction = { ...intent, expected_revision: 1, expected_updated_at: updated };
  assert.equal(externalInvoiceReadback(f.owner, correction, context).next_revision, 2);
  for (const patch of [{ invoice_id: id(900) }, { expected_revision: 2 }, { expected_updated_at: '2026-10-18T00:00:01Z' }]) assert.throws(() => externalInvoiceReadback(f.owner, { ...correction, ...patch }, context));
  context.invoices[0].source_fact_revision_id = intent.source_fact_revision_id; assert.throws(() => externalInvoiceReadback(f.owner, correction, context));
});
test('capture-bound source proof binds the complete normalized intent while standalone v1 remains compatible', () => {
  const { intent } = externalFixture();
  const base = { request_id: intent.request_id, fact_revision_id: intent.source_fact_revision_id, reason: intent.reason };
  const v1 = sourceReadIntent({ schema_version: 'invoice-source-read-intent/1', ...base }); assert.equal(v1.schema_version, 'invoice-source-read-intent/1');
  const v2 = { schema_version: 'invoice-source-read-intent/2', ...base, capture_intent: intent }; assert.deepEqual(sourceReadIntent(v2), v2);
  for (const patch of [{ request_id: id(900) }, { fact_revision_id: id(900) }, { reason: 'Different review' }, { capture_intent: { ...intent, client_id: 'bad' } }, { raw: 'PRIVATE' }]) assert.throws(() => sourceReadIntent({ ...v2, ...patch }));
  assert.throws(() => sourceReadIntent({ ...v1, capture_intent: intent }));
});
test('capture results require exact source/revision and zero financial effects', () => {
  const { intent } = externalFixture(); const result = { schema_version: 'external-invoice-result/1', invoice_id: intent.invoice_id, revision_id: intent.request_id, external_revision: 1, source_fact_revision_id: intent.source_fact_revision_id, recognized_income_change_pence: 0, recognized_expense_change_pence: 0, settlement_change: 0 };
  assert.equal(externalInvoiceResult(result, intent).external_revision, 1);
  for (const patch of [{ recognized_income_change_pence: 1 }, { recognized_expense_change_pence: 1 }, { settlement_change: 1 }, { external_revision: 0 }, { source_fact_revision_id: id(900) }, { raw: 'PRIVATE' }]) assert.throws(() => externalInvoiceResult({ ...result, ...patch }, intent));
});

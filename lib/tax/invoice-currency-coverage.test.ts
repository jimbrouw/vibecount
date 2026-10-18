import assert from 'node:assert/strict';
import test from 'node:test';
import { parseInvoiceCurrencyCoverage } from '../invoices/currency-coverage';
import { syntheticCoverage, syntheticExternal } from '../invoices/currency-coverage-fixture';
import { packFixture, reviewFixture } from './filing-pack-fixture';
import { prepareCalculation, canonicalJson, sha256 } from './snapshot';
import { buildFilingReview, buildFilingPack, verifyFilingPack, type FilingPackInput, type SavedFilingPack } from './filing-pack';

function versioned(coverage = syntheticCoverage()): FilingPackInput {
  const old = packFixture(), prepared = prepareCalculation({ ...old.calculation.input, schema_version: 'tax-calculation-input/2', invoice_coverage: coverage });
  return { ...old, schema_version: 'filing-pack-input/2', invoice_coverage: coverage, calculation: { ...old.calculation, input: prepared.input, result: prepared.result, input_canonical_json: prepared.inputJson, result_canonical_json: prepared.resultJson, input_sha256: prepared.inputHash, result_sha256: prepared.resultHash } };
}
test('new empty coverage retains all historical tax arithmetic and rules while old input stays reproducible', () => {
  const old = packFixture(), current = versioned();
  assert.deepEqual(current.calculation.result, old.calculation.result);
  assert.deepEqual(current.rules, old.rules);
  assert.equal(buildFilingPack(current, reviewFixture(current), 'current', true).schema_version, 'draft-filing-pack/3');
  assert.equal(buildFilingPack(old, reviewFixture(old), 'old', true).schema_version, 'draft-filing-pack/2');
});
test('external GBP and 0/2/3-decimal originals cannot become cash profit or optimistic tax estimates', () => {
  for (const currency of ['GBP', 'USD', 'JPY', 'KWD']) {
    const current = versioned(syntheticCoverage('owner', [syntheticExternal(currency)])), result = current.calculation.result;
    assert.equal(result.status, 'incomplete');
    for (const key of ['trade_profit', 'taxable_trade_profit', 'income_tax', 'class4', 'net_balance', 'poa_each']) assert.equal(result.totals[key], null, key);
    assert.equal(result.totals.ledger_income, packFixture().calculation.result.totals.ledger_income);
    assert.ok(result.issues.some(i => i.code === 'invoice_currency_coverage'));
    assert.throws(() => buildFilingPack(current, reviewFixture(current), 'no-attestation', true), /completeness/);
  }
});
test('missing, foreign, inconsistent and private coverage metadata fail closed, invalid units stay explicit', () => {
  for (const bad of [undefined, {}, { ...syntheticCoverage(), owner_id: 'other' }, { ...syntheticCoverage(), invoice_count: 1 }, { ...syntheticCoverage(), invoices: [syntheticExternal()] }, { ...syntheticCoverage(), object_path: 'PRIVATE' }])
    assert.throws(() => parseInvoiceCurrencyCoverage(bad, 'owner'));
  const row = { ...syntheticExternal(), origin: 'native_gbp', currency: 'GBP', amount: '12.00', original_total_minor: '0', representation: 'invalid' as const };
  const coverage = syntheticCoverage('owner', [row]);
  assert.equal(parseInvoiceCurrencyCoverage(coverage, 'owner').invalid_invoice_count, 1);
  assert.equal(versioned(coverage).calculation.result.status, 'incomplete');
  assert.throws(() => parseInvoiceCurrencyCoverage(syntheticCoverage('owner', [{ ...row, representation: 'native_gbp', native_balance_available: true }]), 'owner'));
});
test('versioned coverage invalidates every current step and freezes original units into incomplete V3 artifacts', () => {
  const input = versioned(), history = reviewFixture(input), current = versioned(syntheticCoverage('owner', [syntheticExternal('KWD', '10001')]));
  const model = buildFilingReview(current, history);
  assert.equal(model.current.length, 0); assert.equal(model.canAttest, false);
  const bundle = buildFilingPack(current, reviewFixture(current), 'incomplete', false);
  const csv = bundle.artifacts.find(a => a.name === 'invoice-payment-reconciliation.csv')!.body;
  assert.match(csv, /invoice_document_coverage/); assert.match(csv, /KWD 10\.001/); assert.match(csv, /not cash, GBP valuation or tax-year income/);
  assert.match(bundle.artifacts.find(a => a.name === 'evidence-manifest.json')!.body, /invoice_coverage/);
  const row: SavedFilingPack = { id: 'pack', tax_year_start: 2025, input: current, input_canonical_json: canonicalJson(current), input_sha256: bundle.input_sha256, bundle, bundle_canonical_json: canonicalJson(bundle), bundle_sha256: sha256(canonicalJson(bundle)), reason: 'Synthetic', author: 'owner', created_at: '2026-10-18', request_id: 'incomplete' };
  assert.equal(verifyFilingPack(row).schema_version, 'draft-filing-pack/3');
  current.invoice_coverage!.stamp = 'f'.repeat(64);
  assert.throws(() => verifyFilingPack(row), /integrity/);
});

test('saved v2 calculation validation rejects withheld tax figures even when outer hashes are recomputed', async () => {
  const { verifySavedCalculation } = await import('./snapshot');
  const input = versioned(syntheticCoverage('owner', [syntheticExternal()]));
  const result = { ...input.calculation.result, totals: { ...input.calculation.result.totals, income_tax: 0 } }, serialized = canonicalJson(result);
  assert.throws(() => verifySavedCalculation({ ...input.calculation, result, result_canonical_json: serialized, result_sha256: sha256(serialized) }, input.rules), /currency coverage/);
});

test('coverage read-back labels full counts and bounded examples without inventing GBP cash', async () => {
  const { build } = await import('esbuild'), { fileURLToPath } = await import('node:url'), { createElement } = await import('react'), { renderToStaticMarkup } = await import('react-dom/server');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const built = await build({ absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', stdin: { resolveDir: root, contents: "export {default} from './app/dashboard/InvoiceCurrencyCoverage.tsx';" }, plugins: [{ name: 'inert-link', setup(b) {
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "import {createElement} from 'react';export default function Link({children,...props}){return createElement('a',props,children)}", resolveDir: root }));
  } }] });
  const Component = (await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'))).default;
  const rows = Array.from({ length: 12 }, (_, i) => syntheticExternal(i % 2 ? 'JPY' : 'KWD', '10001', `synthetic-${i}`));
  const html = renderToStaticMarkup(createElement(Component, { owner: 'owner', value: syntheticCoverage('owner', rows) }));
  assert.match(html, /Examples: 10 of 12/); assert.match(html, /KWD 10\.001/); assert.match(html, /JPY 10001 \(ten thousand one yen\)/); assert.match(html, /not GBP receipts/);
  assert.doesNotMatch(html, /synthetic-10|synthetic-11|£/);
  assert.throws(() => renderToStaticMarkup(createElement(Component, { owner: 'other', value: syntheticCoverage() })), /Owned versioned/);
});

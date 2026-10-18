import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { taxCurrencyFixture } from './tax-currency-fixture';
import { canonicalJson, prepareCalculation, verifySavedCalculation } from '../tax/snapshot';
import { buildFilingPack, buildFilingReview, verifyFilingPack } from '../tax/filing-pack';
import { parseInvoiceCurrencyCoverage } from '../invoices/currency-coverage';

test('tax and filing currency coverage upgrades current inputs without rewriting retained history or retries', async t => {
  const db = new PGlite({ extensions: { pgcrypto } }); t.after(() => db.close()); await db.exec(TEST_SCHEMA_BOOTSTRAP);
  const dir = new URL('../../supabase/migrations/', import.meta.url), migration = '20261018200000_tax_invoice_currency_coverage.sql';
  for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql') && n < migration).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
  const f = await taxCurrencyFixture(db);
  await db.exec('reset role'); await db.exec(await readFile(new URL(migration, dir), 'utf8'));
  async function recoverOld() {
    await f.service();
    assert.equal((await db.query<{ r: string }>('select capture_tax_calculation($1,$2,$3,$4,$5,$6,$7) r', f.calculationArgs)).rows[0].r, f.calculation);
    assert.equal((await db.query<{ r: string }>('select capture_filing_pack($1,$2,$3,$4,$5,$6) r', f.packArgs)).rows[0].r, f.pack);
    await f.auth();
    const calc = (await db.query<typeof f.oldCalculation>('select * from tax_calculations where id=$1', [f.calculation])).rows[0];
    const pack = (await db.query<typeof f.oldPack>('select * from filing_packs where id=$1', [f.pack])).rows[0];
    assert.deepEqual(calc, f.oldCalculation); assert.deepEqual(pack, f.oldPack);
    verifySavedCalculation(calc, { id: f.before.rules.id, canonical_json: f.before.rulesJson, sha256: f.before.rulesHash });
    assert.equal(verifyFilingPack(pack).schema_version, 'draft-filing-pack/2');
  }
  await serialSubtest(t, 'fresh native coverage and old financial stamps coexist; old packs remain readable and become historical', async () => {
    const current = await f.input(); assert.equal(current.schema_version, 'tax-calculation-input/2');
    const c = parseInvoiceCurrencyCoverage(current.invoice_coverage, f.owner);
    assert.equal(c.invoice_count, 1); assert.equal(c.native_invoice_count, 1); assert.equal(c.draft_invoice_count, 1); assert.equal(c.unsupported_external_invoice_count, 0);
    assert.equal(current.financial_stamp, f.before.input.financial_stamp);
    assert.deepEqual(prepareCalculation(current).result, f.before.result);
    const filing = await f.packInput(); assert.equal(filing.schema_version, 'filing-pack-input/2'); assert.equal(filing.calculation_is_current, false);
    assert.equal(buildFilingReview(filing, []).canAttest, false);
    assert.deepEqual(filing.invoice_coverage, current.invoice_coverage);
    assert.doesNotMatch(JSON.stringify(c), /PRIVATE_|pdf_path|object_path|raw_encrypted/);
    await recoverOld();
  });
  await serialSubtest(t, 'coverage is derived from authenticated owner; all explicit-owner helpers remain private', async () => {
    await f.auth(f.other); const empty = (await db.query<{ r: { invoice_coverage: unknown } }>('select read_tax_calculation_input(2025) r')).rows[0].r;
    assert.equal(parseInvoiceCurrencyCoverage(empty.invoice_coverage, f.other).invoice_count, 0);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await db.exec('reset role;set role ' + role);
      for (const sql of ['select invoice_currency_coverage_for_owner($1)', 'select tax_calculation_input_for_owner($1,2025)', 'select tax_calculation_input_v1_for_owner($1,2025)', 'select tax_filing_pack_input_for_owner($1,$2)', 'select tax_filing_pack_input_v1_for_owner($1,$2)'])
        await assert.rejects(db.query(sql, sql.includes('$2') ? [f.owner, f.calculation] : [f.owner]), /permission denied/);
    }
    await db.exec('reset role;set role anon'); await assert.rejects(db.query('select read_tax_calculation_input(2025)'), /permission denied/);
    await f.auth();
  });
  await serialSubtest(t, 'external GBP/foreign originals and invalid native units stay visible, stale captures fail and optimistic results reject', async () => {
    const previous = prepareCalculation(await f.input());
    await db.exec('reset role;begin');
    try {
      // Rollback-only hypothetical canonical data; shipping constraints remain native-only.
      await db.exec('alter table invoices drop constraint invoice_native_origin_scope;alter table invoices drop constraint invoices_currency_check;alter table invoices alter column amount drop not null;');
      const constraints = (await db.query<{ conname: string }>("select conname from pg_constraint where conrelid='public.invoices'::regclass and contype='f' and pg_get_constraintdef(oid) like '%source_fact%'")).rows;
      for (const { conname } of constraints) await db.exec(`alter table invoices drop constraint "${conname}"`);
      for (const currency of ['GBP', 'USD', 'JPY', 'KWD']) await db.query("insert into invoices(user_id,client_id,number,description,status,invoice_date,amount,origin,currency,original_total_minor,currency_ruleset_id,source_fact_revision_id,source_fact_family_id) values($1,$2,$3,'PRIVATE_EXTERNAL','finalised','2024-04-05',null,'preserved_external',$4,10001,'vibecount-currencies/1',$5,$6)", [f.owner, f.client, 'EXT-' + currency, currency, randomUUID(), randomUUID()]);
      await db.query("insert into invoices(user_id,client_id,number,description,status,amount,original_total_minor) values($1,$2,'INVALID','PRIVATE_INVALID','finalised',12,0)", [f.owner, f.client]);
      const current = prepareCalculation(await f.input()), coverage = parseInvoiceCurrencyCoverage(current.input.invoice_coverage, f.owner);
      assert.equal(coverage.invoice_count, 6); assert.equal(coverage.unsupported_external_invoice_count, 4); assert.equal(coverage.invalid_invoice_count, 1);
      assert.equal(current.result.status, 'incomplete'); assert.equal(current.result.totals.net_balance, null); assert.equal(current.result.totals.trade_profit, null);
      assert.ok(current.result.issues.some(i => i.code === 'invoice_currency_coverage'));
      assert.equal(parseInvoiceCurrencyCoverage((await f.input(2026)).invoice_coverage, f.owner).stamp, coverage.stamp);
      await f.service();
      const call = (input = current.inputJson, result = current.resultJson) => db.query<{ r: string }>('select capture_tax_calculation($1,2025,$2,$3,$4,$5,$6) r', [f.owner, input, result, current.rulesJson, 'Synthetic current draft', randomUUID()]);
      await db.exec('savepoint stale_capture'); await assert.rejects(call(previous.inputJson, previous.resultJson), /inputs changed/); await db.exec('rollback to savepoint stale_capture');
      for (const output of [{ ...current.result, status: 'estimate' }, { ...current.result, totals: { ...current.result.totals, net_balance: 0 } }]) {
        await db.exec('savepoint forged_capture'); await assert.rejects(call(current.inputJson, canonicalJson(output)), /Unsupported invoice currency coverage/); await db.exec('rollback to savepoint forged_capture');
      }
      const saved = (await call()).rows[0].r, filing = await f.packInput(saved);
      assert.equal(filing.calculation_is_current, true); assert.equal(filing.invoice_balances.length, 1);
      assert.equal(filing.invoice_coverage!.invoice_count, 6);
      const request = randomUUID(), bundle = buildFilingPack(filing, [], request, false);
      assert.equal(bundle.schema_version, 'draft-filing-pack/3'); assert.equal(bundle.review_status, 'draft_incomplete');
      assert.ok(bundle.artifacts.find(a => a.name === 'invoice-payment-reconciliation.csv')!.body.includes('KWD 10.001'));
      await f.service();
      const capture = (output = bundle, id = request) => db.query<{ r: string }>('select capture_filing_pack($1,$2,$3,$4,$5,$6) r', [f.owner, saved, canonicalJson(filing), canonicalJson(output), 'Synthetic incomplete currency pack', id]);
      const pack = (await capture()).rows[0].r; assert.equal((await capture()).rows[0].r, pack);
      await db.exec('savepoint forged_pack');
      await assert.rejects(capture({ ...bundle, review_status: 'draft_reviewed', completeness_attested: true }, randomUUID()), /Unsupported invoice currency coverage/);
      await db.exec('rollback to savepoint forged_pack');
      await recoverOld();
    } finally { await db.exec('rollback'); await f.auth(); }
    await recoverOld();
    assert.equal((await db.query("select id from invoices where origin<>'native_gbp'")).rows.length, 0);
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { fxConversionLotFixture } from './fx-lot-fixture';
import { rateFromDecimal } from '../fx/currency';

test('private conversion lots freeze real canonical/evidence/receipt bindings without financial capability', async t => {
  const db = new PGlite({ extensions: { pgcrypto } }); t.after(() => db.close()); await db.exec(TEST_SCHEMA_BOOTSTRAP);
  const dir = new URL('../../supabase/migrations/', import.meta.url), migration = '20261019000000_fx_conversion_lot_bindings.sql';
  for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql') && n < migration).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
  const { f, intent, saved, tx, conversionIntent, review, conversion, lot, bind, before } = await fxConversionLotFixture(db);
  await db.exec('reset role'); await db.exec(await readFile(new URL(migration, dir), 'utf8'));
  let retained: Record<string, unknown>;
  await serialSubtest(t, 'binding freezes source units, dates, exact rate and safe immutable ancestry; retry cannot reset lot', async () => {
    retained = await bind(); assert.equal(retained.invoice_limit_minor, 10001); assert.equal(retained.cash_limit_minor, 2500); assert.equal(retained.transaction_version, 1); assert.equal(retained.invoice_fact_revision_id, intent.source_fact_revision_id);
    assert.deepEqual(await bind(), retained); await assert.rejects(bind(randomUUID()), /single conversion-family/);
    const duplicateProof = await review(await conversionIntent()); await assert.rejects(bind(randomUUID(), duplicateProof), /unique constraint/);
    assert.deepEqual((await db.query<{ r: unknown }>('select to_jsonb(f) r from financial_records f where bank_transaction_id=$1', [tx])).rows, before);
    assert.equal((await db.query('select id from invoice_settlements')).rows.length, 0);
    assert.equal((await db.query('select id from fx_conversion_lots')).rows.length, 1);
  });
  await serialSubtest(t, 'ordinary users/service cannot bind or directly insert; owner reads isolate and history is immutable', async () => {
    for (const role of ['authenticated', 'service_role', 'anon']) {
      await f.auth(); await db.exec('reset role;set role ' + role);
      await assert.rejects(db.query('select bind_fx_conversion_lot($1,$2,$3,$4,$5)', [f.owner, lot, intent.invoice_id, (saved as { revision_id: string }).revision_id, conversion]), /permission denied/);
      await assert.rejects(db.query('insert into fx_conversion_lots default values'), /permission denied/);
    }
    await f.auth(f.other); assert.equal((await db.query('select id from fx_conversion_lots')).rows.length, 0);
    await f.auth(); assert.equal((await db.query('select id from fx_conversion_lots')).rows.length, 1);
    await db.exec('reset role'); await assert.rejects(db.query('update fx_conversion_lots set cash_limit_minor=1 where id=$1', [lot]), /immutable/); await assert.rejects(db.query('delete from fx_conversion_lots where id=$1', [lot]), /immutable/);
    await assert.rejects(bind(randomUUID(), conversion, intent.invoice_id, f.revision), /canonical/);
    await assert.rejects(bind(randomUUID(), conversion, intent.invoice_id, (saved as { revision_id: string }).revision_id, f.other), /owned exact/);
  });
  await serialSubtest(t, 'zero-cash evidence remains a real positive-original binding and privileged forged recipes fail closure', async () => {
    const zero = await review(await conversionIntent({ data: { rate: rateFromDecimal('KWD', 'GBP', '0.01'), conversion_date: '2026-04-06', evidence_date: '2026-04-07', invoice_portion_minor: 1, gbp_cash_portion_pence: 0, fee_mode: 'none' } }));
    const bound = await bind(randomUUID(), zero); assert.equal(bound.invoice_limit_minor, 1); assert.equal(bound.cash_limit_minor, 0);
    assert.equal((await db.query('select id from invoice_settlements')).rows.length, 0);
    for (const patch of [{ cash_limit_minor: 1 }, { invoice_limit_minor: 10000 }, { conversion_date: '2026-04-08' }, { source_snapshot: { raw: 'PRIVATE' } }, { invoice_fact_revision_id: f.fact.family_id }]) {
      await f.auth(); await db.exec('reset role');
      await assert.rejects(db.query('insert into fx_conversion_lots select (jsonb_populate_record(null::fx_conversion_lots,$1)).*', [JSON.stringify({ ...retained, ...patch, id: randomUUID() })]), /source closure/);
    }
  });
  await serialSubtest(t, 'receipt reclassification and conversion withdrawal invalidate fresh binding without rewriting lot history', async () => {
    await f.auth(); await db.exec('begin');
    try {
      await db.query("select review_bank_transaction($1,1,'Personal',null,0,'Synthetic changed receipt')", [tx]);
      await assert.rejects(bind(), /current verified/);
    } finally { await db.exec('rollback'); }
    await f.auth(); await db.exec('begin');
    try {
      const family = String(retained.conversion_family_id);
      await review(await conversionIntent({ family_id: family, expected_ordinal: 1, state: 'withdrawn', human_read_original: false, document_id: null, invoice_evidence_revision_id: null, transaction_id: null, transaction_version: null, data: null }));
      await assert.rejects(bind(), /current verified/);
    } finally { await db.exec('rollback'); }
    assert.deepEqual(await bind(), retained);
  });
  await serialSubtest(t, 'current receipt/evidence is required even for an existing binding; retained history survives supersession', async () => {
    await f.auth(); const changed = await conversionIntent({ family_id: f.factIntent.family_id, expected_ordinal: 1, kind: 'invoice', invoice_evidence_revision_id: null, transaction_id: null, transaction_version: null, data: { ...f.factIntent.data, original_total_minor: 10002 } });
    await review(changed); await assert.rejects(bind(), /current verified/);
    await f.auth(); const found = (await db.query<{ r: unknown }>('select to_jsonb(l) r from fx_conversion_lots l where id=$1', [lot])).rows[0].r; assert.deepEqual(found, retained);
    assert.deepEqual((await db.query<{ r: unknown }>('select to_jsonb(f) r from financial_records f where bank_transaction_id=$1', [tx])).rows, before);
  });
});

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
import { fxSettlementChoices, parseFxSettlementCatalog } from '../fx/settlement-catalog';
import { parseFxLotPortions, validateFxSettlementHistory } from '../fx/settlement-history';
import { readFxLotPortions } from '../fx/settlement-history-store';
import { completeFxLotReversalReadback } from '../fx/reversal-review';
import { readFxExportFixture } from './fx-export-fixture';
import { dimensionedReconciliationExport } from '../records/reconciliation-dimensioned-export';

test('retained FX portion review agrees with actual complete immutable SQL history', async t => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(TEST_SCHEMA_BOOTSTRAP);
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  const migration = '20261019040000_fx_lot_review_sources.sql';
  for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql') && n < migration).sort())
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  const x = await fxConversionLotFixture(db), { f } = x;
  const catalog = async () => {
    await f.auth();
    return parseFxSettlementCatalog(f.owner, (await db.query<{ r: unknown }>('select read_fx_settlement_catalog() r')).rows[0].r);
  };
  const approve = async (original = 5000, cash = 1250) => {
    const c = await catalog(), choice = fxSettlementChoices(c).find(c => c.conversion_fact_revision_id === x.conversion)!;
    const intent = {
      schema_version: 'fx-settlement-intent/1', ruleset_id: 'vibecount-currencies/1', receipt_id: x.tx, receipt_version: 1,
      expected_stamp: c.financial_stamp, rationale: 'Synthetic retained history approval', request_id: randomUUID(),
      fee_mode: 'none', receipt_valuation_id: null, receipt_valuation_evidence_revision_id: null,
      allocations: [{ invoice_id: x.intent.invoice_id, invoice_revision_id: (x.saved as { revision_id: string }).revision_id,
        invoice_minor: original, cash_minor: cash, conversion_date: '2026-04-06', rate: rateFromDecimal('KWD', 'GBP', '2.5'),
        invoice_evidence_id: x.intent.source_fact_family_id, invoice_evidence_revision_id: x.intent.source_fact_revision_id,
        conversion_evidence_id: choice.conversion_family_id, conversion_evidence_revision_id: x.conversion,
        conversion_lot_id: choice.lot_id ?? x.lot, conversion_lot_version: choice.lot_version }],
    };
    await db.exec('reset role');
    await db.query('select approve_fx_invoice_allocations($1)', [JSON.stringify(intent)]);
  };
  const reverse = async () => {
    const c = await catalog(); await db.exec('reset role');
    await db.query('select reverse_fx_conversion_lot($1,$2,$3,$4)', [x.lot, c.financial_stamp, 'Synthetic retained history reversal', randomUUID()]);
  };
  const rawReview = async () => {
    await f.auth();
    return (await db.query<{ r: unknown }>('select read_fx_lot_portions($1) r', [x.lot])).rows[0].r;
  };
  const history = async () => {
    await f.auth();
    const lots = (await db.query<{ r: unknown }>('select to_jsonb(l) r from fx_lot_export_sources l')).rows.map(r => r.r);
    const events = (await db.query<{ r: unknown }>("select to_jsonb(s) r from invoice_settlements s where settlement_kind='fx_gbp_cash' order by id")).rows.map(r => r.r);
    return validateFxSettlementHistory(f.owner, lots, events);
  };
  // Seed a genuine predecessor allocation. Read-only migration must preserve it.
  await approve(); await db.exec('reset role');
  const before = (await db.query<{ r: unknown }>('select to_jsonb(s) r from invoice_settlements s order by id')).rows;
  const stamp = (await db.query<{ s: string }>('select reconciliation_export_stamp() s')).rows[0].s;
  await db.exec(await readFile(new URL(migration, dir), 'utf8'));

  await serialSubtest(t, 'upgrade preserves event bytes and stamp; actual safe sources parse without live rebasing', async () => {
    assert.deepEqual((await db.query<{ r: unknown }>('select to_jsonb(s) r from invoice_settlements s order by id')).rows, before);
    assert.equal((await db.query<{ s: string }>('select reconciliation_export_stamp() s')).rows[0].s, stamp);
    const raw = await rawReview(), review = parseFxLotPortions(f.owner, raw), full = await history();
    assert.equal(review.version, 1); assert.equal(review.active_count, 1);
    assert.equal(review.original_minor, 5000); assert.equal(review.cash_pence, 1250);
    assert.deepEqual(review.portions, full.lots[0].events);
    assert.notEqual(review.lot.invoice_revision_id, review.lot.invoice_fact_revision_id);
    assert.equal(review.lot.invoice_snapshot.source_fact_revision_id, x.intent.source_fact_revision_id);
    assert.deepEqual(await readFxLotPortions({ rpc: async () => ({ data: raw, error: null }) }, f.owner, x.lot), review);
    await assert.rejects(readFxLotPortions({ rpc: async () => ({ data: raw, error: { message: 'Synthetic failure' } }) }, f.owner, x.lot));
    await assert.rejects(readFxLotPortions({ rpc: async () => ({ data: raw, error: null }) }, f.owner, randomUUID()));
    assert.ok(!JSON.stringify(raw).includes(f.path));
    assert.ok(!JSON.stringify(raw).includes('raw_encrypted'));
    assert.ok(!JSON.stringify(raw).includes('object_path'));
  });
  await serialSubtest(t, 'all three actual tranches include a positive-original zero-cash portion and bind complete read-back', async () => {
    await approve(); await approve(1, 0);
    const raw = await rawReview(), review = parseFxLotPortions(f.owner, raw), c = await catalog(), full = await history();
    assert.equal(review.version, 3); assert.equal(review.active_count, 3);
    assert.deepEqual(review.portions.map(e => [e.invoice_minor, e.amount_pence]), [[5000,1250],[5000,1250],[1,0]]);
    assert.equal(full.lots[0].original_minor, 10001); assert.equal(full.lots[0].cash_pence, 2500);
    const intent = { schema_version: 'fx-lot-reversal-intent/1', lot_id: x.lot, lot_version: 3,
      expected_stamp: c.financial_stamp, rationale: 'Synthetic full portion read-back', request_id: randomUUID() };
    const result = completeFxLotReversalReadback(f.owner, intent, c, raw).result;
    assert.equal(result.portions.length, 3);
    assert.equal(result.portions[2].amount_pence, 0);
    const exported=dimensionedReconciliationExport(await readFxExportFixture(db,f.owner));
    assert.equal(exported.schema_version,'vibecount.reconciliation/4');
    assert.match(exported.csv,/fx_settlement_event/);assert.match(exported.csv,/KWD 0.001/);
    assert.throws(() => completeFxLotReversalReadback(f.owner, intent, c, { ...(raw as object), portions: review.portions.slice(0,2) }));
  });
  await serialSubtest(t, 'complete LIFO reversal and reuse retain all ordinals, copied snapshots and original receipt posting', async () => {
    await reverse();
    let review = parseFxLotPortions(f.owner, await rawReview()), full = await history();
    assert.equal(review.version, 6); assert.equal(review.active_count, 0);
    assert.equal(full.events.length, 6); assert.equal(full.lots[0].cash_pence, 0);
    assert.deepEqual(full.lots[0].events.slice(3).map(e => e.reverses_id), [...full.lots[0].events.slice(0,3)].reverse().map(e => e.id));
    await approve(); review = parseFxLotPortions(f.owner, await rawReview()); full = await history();
    assert.equal(review.version, 7); assert.equal(review.portions[0].lot_event_ordinal, 7);
    assert.deepEqual(full.lots[0].active_ids, review.portions.map(e => e.id));
    assert.equal(review.original_minor, 5000); assert.equal(review.cash_pence, 1250);
    assert.match(dimensionedReconciliationExport(await readFxExportFixture(db,f.owner)).csv,/fx_lot_balance/);
    assert.deepEqual((await db.query<{ r: unknown }>('select to_jsonb(r) r from financial_records r where bank_transaction_id=$1', [x.tx])).rows, x.before);
  });
  await serialSubtest(t, 'withdrawn current evidence and lost source objects preserve exact retained review and reversal', async () => {
    const before = parseFxLotPortions(f.owner, await rawReview());
    const exportedBefore=dimensionedReconciliationExport(await readFxExportFixture(db,f.owner));
    const previous = (await catalog()).evidence.facts.find(f => f.id === x.conversion)!;
    await x.review(await x.conversionIntent({ family_id: previous.family_id, expected_ordinal: 1, state: 'withdrawn',
      human_read_original: false, document_id: null, invoice_evidence_revision_id: null, transaction_id: null, transaction_version: null, data: null }));
    await db.exec('reset role');
    await db.query("delete from storage.objects where bucket_id='document-evidence' and name=$1", [f.path]);
    const after = parseFxLotPortions(f.owner, await rawReview());
    assert.notEqual(after.financial_stamp, before.financial_stamp);
    assert.deepEqual(after.lot, before.lot); assert.deepEqual(after.portions, before.portions);
    assert.equal(dimensionedReconciliationExport(await readFxExportFixture(db,f.owner)).csv,exportedBefore.csv);
    assert.deepEqual((await history()).lots[0].active_ids, after.portions.map(e => e.id));
    await reverse(); assert.equal(parseFxLotPortions(f.owner, await rawReview()).version, 8);
    assert.equal((await history()).lots[0].active_count, 0);
    assert.match(dimensionedReconciliationExport(await readFxExportFixture(db,f.owner)).csv,/fx_settlement_event/);
  });
  await serialSubtest(t, 'owner isolation, anonymous/service denial and private financial grants remain enforced', async () => {
    await db.exec('reset role'); const other = randomUUID();
    await db.query('insert into auth.users values($1)', [other]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]); await db.exec('set role authenticated');
    assert.equal((await db.query('select * from fx_lot_export_sources')).rows.length, 0);
    await assert.rejects(db.query('select read_fx_lot_portions($1)', [x.lot]), /Owned retained FX lot unavailable/);
    for (const role of ['anon', 'service_role']) {
      await db.exec('reset role'); await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select read_fx_lot_portions($1)', [x.lot]), /permission denied/);
      await assert.rejects(db.query('select * from fx_lot_export_sources'), /permission denied/);
    }
    await db.exec('reset role');
    for (const role of ['authenticated','anon','service_role']) {
      assert.equal((await db.query<{ allowed: boolean }>("select has_function_privilege($1,'approve_fx_invoice_allocations(jsonb)','execute') or has_function_privilege($1,'reverse_fx_conversion_lot(uuid,text,text,uuid)','execute') allowed", [role])).rows[0].allowed, false);
    }
  });
});

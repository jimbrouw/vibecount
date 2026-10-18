import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { invoiceSourceReadFixture } from './invoice-source-read-fixture';
import { checkRetainedInvoiceSource, parseSourceReadCheck } from '../fx/retained-source';

test('private retained invoice checks preserve predecessor facts, audit exact byte reads and isolate owners', async t => {
  const db = new PGlite({ extensions: { pgcrypto } }); t.after(() => db.close()); await db.exec(TEST_SCHEMA_BOOTSTRAP);
  const dir = new URL('../../supabase/migrations/', import.meta.url), migration = '20261018220000_invoice_source_read_checks.sql';
  for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql') && n < migration).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
  const f = await invoiceSourceReadFixture(db), sql = 'select record_invoice_source_read($1,$2,$3,$4) r';
  const before = (await db.query('select * from fx_document_fact_revisions')).rows;
  await db.exec('reset role'); await db.exec(await readFile(new URL(migration, dir), 'utf8')); await f.auth();
  assert.deepEqual((await db.query('select * from fx_document_fact_revisions')).rows, before);
  let savedId: string;
  await serialSubtest(t, 'real encrypted bytes yield an immutable safe check, exact retries and zero invoices/postings', async () => {
    const saved = await checkRetainedInvoiceSource(f.owner, f.input, {
      recover: async () => null, catalog: async () => f.catalog, metadata: async () => f.metadata, key: () => Buffer.from(f.key), download: async () => f.cipher,
      record: async (input, source, outcome) => { await f.service(); return (await db.query<{ r: unknown }>(sql, [f.owner, JSON.stringify(input), JSON.stringify(source), outcome])).rows[0].r; },
    }); savedId = saved.id;
    assert.equal(saved.outcome, 'verified'); assert.doesNotMatch(JSON.stringify(saved), /SYNTHETIC_NAME|\.enc|key_id|object_path/);
    const again = (await db.query<{ r: unknown }>(sql, [f.owner, JSON.stringify(f.input), JSON.stringify(f.fact.source_snapshot), 'verified'])).rows[0].r;
    assert.deepEqual(parseSourceReadCheck(f.owner, again), saved);
    assert.equal((await db.query('select id from invoices')).rows.length, 0); assert.equal((await db.query('select id from financial_records')).rows.length, 0);
    await assert.rejects(db.query('select review_fx_document_evidence($1)', [JSON.stringify(f.factIntent)]), /permission denied/);
  });
  await serialSubtest(t, 'owner SELECT, anonymous/service/direct-write and immutable grants remain strict', async () => {
    await f.auth(); assert.equal((await db.query('select id from invoice_source_read_checks')).rows.length, 1);
    for (const stmt of ['delete from invoice_source_read_checks', "update invoice_source_read_checks set outcome='unavailable'", "insert into invoice_source_read_checks(user_id) values(null)"] ) await assert.rejects(db.exec(stmt), /permission denied/);
    await assert.rejects(db.query(sql, [f.owner, JSON.stringify(f.input), JSON.stringify(f.fact.source_snapshot), 'verified']), /permission denied/);
    await f.auth(f.other); assert.equal((await db.query('select id from invoice_source_read_checks')).rows.length, 0);
    await db.exec('reset role;set role anon'); await assert.rejects(db.query('select id from invoice_source_read_checks'), /permission denied/);
    await f.service(); await assert.rejects(db.query('delete from invoice_source_read_checks'), /permission denied/);
    await db.exec('reset role'); await assert.rejects(db.query('delete from invoice_source_read_checks where id=$1', [savedId]), /immutable|cannot|preserv/i);
  });
  await serialSubtest(t, 'superseded facts and changed invoice registration cannot authorize a fresh successful check', async () => {
    for (const change of ['fact', 'registration']) {
      await db.exec('reset role;begin');
      try {
        if (change === 'fact') {
          await f.auth(); const stamp = (await db.query<{ r: string }>('select fx_evidence_review_stamp() r')).rows[0].r;
          await db.query('select review_fx_document_evidence($1)', [JSON.stringify({ ...f.factIntent, expected_ordinal: 1, expected_stamp: stamp, state: 'provisional', human_read_original: false, request_id: randomUUID() })]);
        } else {
          const batch = randomUUID();
          await db.query("insert into document_batches(id,user_id,root_document_id,tax_year_start,purpose,parser_version) values($1,$2,$3,2024,'invoice','opaque-evidence/1')", [batch, f.owner, f.metadata.id]);
          await db.query("insert into document_batch_items(id,user_id,batch_id,document_id,ordinal,original_name_encrypted) values('00000000-0000-0000-0000-000000000001',$1,$2,$3,0,'SYNTHETIC_NAME')", [f.owner, batch, f.metadata.id]);
        }
        await f.service();
        await assert.rejects(db.query(sql, [f.owner, JSON.stringify({ ...f.input, request_id: randomUUID() }), JSON.stringify(f.fact.source_snapshot), 'verified']), /source changed/);
      } finally { await db.exec('rollback'); }
    }
  });
  await serialSubtest(t, 'forged source, foreign fact, changed requests and stale success reject; failure and past recovery remain explicit', async () => {
    await f.service();
    await assert.rejects(db.query(sql, [f.owner, JSON.stringify({ ...f.input, reason: 'Changed' }), JSON.stringify(f.fact.source_snapshot), 'verified']), /request changed/);
    await assert.rejects(db.query(sql, [f.other, JSON.stringify(f.input), JSON.stringify(f.fact.source_snapshot), 'verified']), /Owned invoice source/);
    await assert.rejects(db.query(sql, [f.owner, JSON.stringify({ ...f.input, request_id: randomUUID() }), '{}', 'verified']), /Owned invoice source/);
    await db.exec('reset role'); await db.query("delete from storage.objects where bucket_id='document-evidence' and name=$1", [f.path]); await f.service();
    const fresh = { ...f.input, request_id: randomUUID() };
    await assert.rejects(db.query(sql, [f.owner, JSON.stringify(fresh), JSON.stringify(f.fact.source_snapshot), 'verified']), /source changed/);
    const failure = parseSourceReadCheck(f.owner, (await db.query<{ r: unknown }>(sql, [f.owner, JSON.stringify(fresh), JSON.stringify(f.fact.source_snapshot), 'unavailable'])).rows[0].r);
    assert.equal(failure.outcome, 'unavailable');
    assert.equal(parseSourceReadCheck(f.owner, (await db.query<{ r: unknown }>(sql, [f.owner, JSON.stringify(f.input), JSON.stringify(f.fact.source_snapshot), 'verified'])).rows[0].r).id, savedId);
    await f.auth(); assert.deepEqual((await db.query<{ r: unknown }>('select review_fx_document_evidence($1) r', [JSON.stringify(f.factIntent)])).rows[0].r, f.factResult);
    assert.equal((await db.query('select id from invoice_source_read_checks')).rows.length, 2);
  });
});

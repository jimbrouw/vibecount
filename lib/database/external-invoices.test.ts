import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { externalInvoiceFixture } from './external-invoice-fixture';
import { externalInvoiceResult } from '../invoices/external';

test('reviewed external capture preserves native history and creates only sourced document revisions', async t => {
  const db = new PGlite({ extensions: { pgcrypto } }); t.after(() => db.close()); await db.exec(TEST_SCHEMA_BOOTSTRAP);
  const dir = new URL('../../supabase/migrations/', import.meta.url), migration = '20261018230000_reviewed_external_invoices.sql';
  for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql') && n < migration).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
  const f = await externalInvoiceFixture(db); await db.exec('reset role'); await db.exec(await readFile(new URL(migration, dir), 'utf8'));
  let invoice: string; let initial: Awaited<ReturnType<typeof f.intent>>; let initialCheck: string; let saved: unknown;
  await serialSubtest(t, 'native amounts, snapshots, old request and positive PDF history remain exact', async () => {
    await f.auth();
    assert.deepEqual((await db.query<{ r: unknown }>("select to_jsonb(i)-'external_revision' r from invoices i where id=$1", [f.native])).rows[0].r, f.nativeRow);
    assert.deepEqual((await db.query<{ r: unknown }>("select to_jsonb(i)-'source_read_check_id' r from invoice_revisions i where id=$1", [f.revision])).rows[0].r, f.nativeHistory);
    assert.deepEqual((await db.query<{ r: unknown }>('select save_invoice_revision($1,$2,$3,$4,$5,$6) r', f.nativeArgs)).rows[0].r, f.nativeResult);
  });
  await serialSubtest(t, 'fresh bound proof captures positive KWD revision, native view excludes it and no posting is added', async () => {
    initial = await f.intent(); invoice = initial.invoice_id; const proof = await f.proof(initial); initialCheck = proof.id;
    saved = await f.capture(initial, proof.id); assert.equal(externalInvoiceResult(saved, initial).external_revision, 1);
    assert.deepEqual(await f.capture(initial, proof.id), saved);
    const row = (await db.query<{ amount: null; currency: string; original_total_minor: string | number; external_revision: number; economics_version: number; pdf_path: null }>('select amount,currency,original_total_minor,external_revision,economics_version,pdf_path from invoices where id=$1', [invoice])).rows[0];
    assert.equal(row.amount, null); assert.equal(row.currency, 'KWD'); assert.equal(Number(row.original_total_minor), 10001); assert.equal(row.economics_version, 0); assert.equal(row.external_revision, 1); assert.equal(row.pdf_path, null);
    assert.equal((await db.query('select id from invoice_payment_balances where id=$1', [invoice])).rows.length, 0);
    assert.equal((await db.query('select id from financial_records')).rows.length, 0);
  });
  await serialSubtest(t, 'verified successors correct one identity across GBP/USD/JPY with immutable sourced history', async () => {
    let ordinal = 1, version = 1;
    for (const currency of ['GBP', 'USD', 'JPY']) {
      await f.auth(); const stamp = (await db.query<{ r: string }>('select fx_evidence_review_stamp() r')).rows[0].r;
      await db.query('select review_fx_document_evidence($1)', [JSON.stringify({ ...f.factIntent, expected_ordinal: ordinal++, expected_stamp: stamp, data: { ...f.factIntent.data, currency }, request_id: randomUUID() })]);
      const input = await f.intent(invoice, version++), proof = await f.proof(input), result = await f.capture(input, proof.id);
      assert.equal(externalInvoiceResult(result, input).invoice_id, invoice);
    }
    assert.equal((await db.query('select id from invoices where origin=$1', ['preserved_external'])).rows.length, 1);
    const rows = (await db.query<{ version: number; origin: string; pdf_path: null; source_read_check_id: string }>('select version,origin,pdf_path,source_read_check_id from invoice_revisions where invoice_id=$1 order by version', [invoice])).rows;
    assert.deepEqual(rows.map(r => r.version), [1,2,3,4]); assert.ok(rows.every(r => r.origin === 'preserved_external' && r.pdf_path === null && r.source_read_check_id));
    assert.deepEqual(await f.capture(initial, initialCheck), saved);
  });
  await serialSubtest(t, 'direct external writes, native transitions, version-zero proof and private grants reject', async () => {
    for (const role of ['authenticated', 'service_role']) {
      await f.auth(); if (role === 'service_role') await f.service();
      await assert.rejects(db.query('update invoices set original_total_minor=1 where id=$1', [invoice]), /reviewed external/);
      await assert.rejects(db.query('delete from invoices where id=$1', [invoice]), /Preserve external/);
      await assert.rejects(db.query("update invoices set origin='native_gbp' where id=$1", [invoice]), /origins cannot change/);
      for (const fn of ['validate_external_invoice_intent', 'validate_external_invoice_revision']) await assert.rejects(db.query(fn === 'validate_external_invoice_intent' ? 'select validate_external_invoice_intent($1)' : 'select validate_external_invoice_revision($1,$2)', fn === 'validate_external_invoice_intent' ? [JSON.stringify(initial)] : [initial.request_id, f.owner]), /permission denied/);
    }
    await db.exec('reset role');
    await assert.rejects(db.query("insert into invoice_revisions(user_id,invoice_id,version,snapshot,author,origin) values($1,$2,0,'{}',$1,'preserved_external')", [f.owner, invoice]), /check constraint/);
    await assert.rejects(db.query("insert into invoice_revisions(user_id,invoice_id,version,snapshot,author) values($1,$2,0,'{}',$1)", [f.owner, invoice]), /positive sourced history/);
    await assert.rejects(db.query("insert into invoice_revisions(user_id,invoice_id,version,snapshot,author,pdf_path,pdf_sha256,request_hash) values($1,$2,99,'{}',$1,'synthetic.pdf',$3,$3)", [f.owner, invoice, 'a'.repeat(64)]), /positive sourced history/);
    await f.auth(f.other); assert.equal((await db.query('select id from invoices')).rows.length, 0); assert.equal((await db.query('select * from external_invoice_requests')).rows.length, 0);
    await assert.rejects(db.query('select capture_external_invoice($1,$2)', [JSON.stringify(initial), initialCheck]));
    await db.exec('reset role;set role anon'); await assert.rejects(db.query('select capture_external_invoice($1,$2)', [JSON.stringify(initial), initialCheck]), /permission denied/);
  });
  await serialSubtest(t, 'proof bindings, expiry, late audit rollback and source withdrawal cannot authorize altered capture', async () => {
    await db.exec('reset role'); const otherClient = randomUUID(); await db.query("insert into clients(id,user_id,name) values($1,$2,'Synthetic other owned client')", [otherClient, f.owner]);
    await f.auth(); let stamp = (await db.query<{ r: string }>('select fx_evidence_review_stamp() r')).rows[0].r;
    const successor = { ...f.factIntent, expected_ordinal: 4, expected_stamp: stamp, data: { ...f.factIntent.data, currency: 'JPY', original_total_minor: 20002 }, request_id: randomUUID() };
    await db.query('select review_fx_document_evidence($1)', [JSON.stringify(successor)]);
    const input = await f.intent(invoice, 4), proof = await f.proof(input);
    for (const patch of [{ client_id: otherClient }, { invoice_id: randomUUID() }, { source_fact_family_id: randomUUID() }, { expected_stamp: '0'.repeat(32) }, { expected_revision: 3 }, { original_sha256: '0'.repeat(64) }, { reason: 'Altered financial review' }]) await assert.rejects(f.capture({ ...input, ...patch }, proof.id));
    await db.exec('reset role');
    await db.exec("create function public.synthetic_external_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic late capture failure';end;$$;create trigger synthetic_external_failure before insert on external_invoice_requests for each row execute function public.synthetic_external_failure();");
    try { await assert.rejects(f.capture(input, proof.id), /late capture failure/); }
    finally { await db.exec('reset role;drop trigger synthetic_external_failure on external_invoice_requests;drop function public.synthetic_external_failure()'); }
    assert.equal((await db.query<{ v: number }>('select external_revision v from invoices where id=$1', [invoice])).rows[0].v, 4);
    assert.equal((await db.query('select id from invoice_revisions where id=$1', [input.request_id])).rows.length, 0);
    assert.equal(externalInvoiceResult(await f.capture(input, proof.id), input).external_revision, 5);
    await f.auth(); stamp = (await db.query<{ r: string }>('select fx_evidence_review_stamp() r')).rows[0].r;
    await db.query('select review_fx_document_evidence($1)', [JSON.stringify({ ...successor, expected_ordinal: 5, expected_stamp: stamp, request_id: randomUUID() })]);
    const current = await f.intent(invoice, 5);
    for (const offset of ["- interval '6 minutes'", "+ interval '1 minute'"]) {
      const request = { ...current, request_id: randomUUID() }; await db.exec('reset role');
      const bound = { schema_version: 'invoice-source-read-intent/2', request_id: request.request_id, fact_revision_id: request.source_fact_revision_id, reason: request.reason, capture_intent: request };
      const check = (await db.query<{ id: string }>(`insert into invoice_source_read_checks(user_id,request_id,intent,fact_revision_id,document_id,source_snapshot,outcome,author,checked_at) values($1,$2,$3,$4,$5,$6,'verified',$1,statement_timestamp() ${offset}) returning id`, [f.owner, request.request_id, JSON.stringify(bound), request.source_fact_revision_id, f.metadata.id, JSON.stringify(f.fact.source_snapshot)])).rows[0].id;
      await assert.rejects(f.capture(request, check), /Fresh capture-bound/);
    }
    const pending = await f.proof(current);
    await f.auth(); stamp = (await db.query<{ r: string }>('select fx_evidence_review_stamp() r')).rows[0].r;
    await db.query('select review_fx_document_evidence($1)', [JSON.stringify({ ...f.factIntent, expected_ordinal: 6, expected_stamp: stamp, state: 'withdrawn', human_read_original: false, document_id: null, data: null, request_id: randomUUID() })]);
    await assert.rejects(f.capture(current, pending.id), /context changed/);
    assert.equal((await db.query('select id from financial_records')).rows.length, 0);
    // Restore eligibility only through another reviewed fact, retaining withdrawal history.
    stamp = (await db.query<{ r: string }>('select fx_evidence_review_stamp() r')).rows[0].r;
    await db.query('select review_fx_document_evidence($1)', [JSON.stringify({ ...successor, expected_ordinal: 7, expected_stamp: stamp, request_id: randomUUID() })]);
  });
  await serialSubtest(t, 'changed retries and standalone old proofs cannot authorize capture; history survives lost source', async () => {
    await assert.rejects(f.capture({ ...initial, reason: 'Changed old reason' }, initialCheck), /request changed/);
    const next = await f.intent();
    await f.service(); const old = (await db.query<{ r: { id: string } }>('select record_invoice_source_read($1,$2,$3,$4) r', [f.owner, JSON.stringify({ schema_version: 'invoice-source-read-intent/1', request_id: next.request_id, fact_revision_id: next.source_fact_revision_id, reason: next.reason }), JSON.stringify(f.fact.source_snapshot), 'verified'])).rows[0].r;
    await assert.rejects(f.capture(next, old.id), /capture-bound/);
    await db.exec('reset role'); await db.query("delete from storage.objects where bucket_id='document-evidence' and name=$1", [f.path]);
    assert.deepEqual(await f.capture(initial, initialCheck), saved);
    assert.equal((await db.query('select id from financial_records')).rows.length, 0);
  });
});

// Actual ordered SQL and encrypted synthetic bytes. No hosted access or real approvals.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
import { externalInvoiceFixture } from '../lib/database/external-invoice-fixture';
import { externalInvoiceResult } from '../lib/invoices/external';
async function main() {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL('../supabase/migrations/', import.meta.url), migration = '20261018230000_reviewed_external_invoices.sql';
    for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql') && n < migration).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
    const f = await externalInvoiceFixture(db); await db.exec('reset role'); await db.exec(await readFile(new URL(migration, dir), 'utf8'));
    const intent = await f.intent(), proof = await f.proof(intent), captured = await f.capture(intent, proof.id); assert.equal(externalInvoiceResult(captured, intent).external_revision, 1);
    await f.auth(); const stamp = (await db.query<{ s: string }>('select fx_evidence_review_stamp() s')).rows[0].s;
    await db.query('select review_fx_document_evidence($1)', [JSON.stringify({ ...f.factIntent, expected_ordinal: 1, expected_stamp: stamp, request_id: randomUUID(), data: { ...f.factIntent.data, currency: 'JPY', original_total_minor: 20001 } })]);
    const next = await f.intent(intent.invoice_id, 1), nextProof = await f.proof(next), corrected = await f.capture(next, nextProof.id); assert.equal(externalInvoiceResult(corrected, next).external_revision, 2);
    await db.exec('reset role'); await db.query("delete from storage.objects where bucket_id='document-evidence' and name=$1", [f.path]);
    const recovered = await f.capture(intent, proof.id); assert.deepEqual(recovered, captured);
    assert.deepEqual((await db.query<{ r: unknown }>('select save_invoice_revision($1,$2,$3,$4,$5,$6) r', f.nativeArgs)).rows[0].r, f.nativeResult);
    assert.deepEqual((await db.query<{ r: unknown }>("select to_jsonb(i)-'external_revision' r from invoices i where id=$1", [f.native])).rows[0].r, f.nativeRow);
    const history = (await db.query('select version,snapshot,source_fact_revision_id,source_read_check_id from invoice_revisions where invoice_id=$1 order by version', [intent.invoice_id])).rows;
    assert.equal(history.length, 2); assert.equal((await db.query('select id from financial_records')).rows.length, 0); assert.equal((await db.query('select id from invoice_settlements')).rows.length, 0);
    const output = '/tmp/vibecount-external-invoice-demo'; await mkdir(output, { recursive: true });
    await writeFile(output + '/capture.json', JSON.stringify({ captured, corrected, recovered, history, financial_records: 0, settlements: 0, native_parity: true }, null, 2) + '\n');
    await writeFile(output + '/README.md', '# Synthetic preserved external invoice capture\n\nOrdered predecessor/forward SQL plus actual synthetic encrypted PDF-shaped bytes: capture KWD 10.001, correct the same canonical family to JPY 20001, preserve two positive immutable source revisions, and recover the original request after source-object loss. Native row values and request recovery remain exact. Zero financial records or settlements are created. Exported metadata contains no source bytes, ciphertext, paths or keys.\n\nDisposable SQL and in-memory byte transport do not establish hosted Auth/PostgREST/Storage, real PDF rendering, human semantic review or financial FX settlement. No hosted migration, real approval, provider, send, payment, deployment or filing occurs.\n');
    console.log('Verified synthetic external capture: ' + output);
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

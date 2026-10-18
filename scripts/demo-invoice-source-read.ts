// Actual encrypted synthetic bytes plus ordered disposable SQL; no hosted object or provider.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
import { invoiceSourceReadFixture } from '../lib/database/invoice-source-read-fixture';
import { checkRetainedInvoiceSource } from '../lib/fx/retained-source';

async function main() {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL('../supabase/migrations/', import.meta.url), migration = '20261018220000_invoice_source_read_checks.sql';
    for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql') && n < migration).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
    const f = await invoiceSourceReadFixture(db);
    await db.exec('reset role'); await db.exec(await readFile(new URL(migration, dir), 'utf8'));
    let unavailable = false;
    const deps = {
      recover: async (request: string) => { await f.service(); return (await db.query<{ r: unknown }>('select to_jsonb(c) r from invoice_source_read_checks c where user_id=$1 and request_id=$2', [f.owner, request])).rows[0]?.r ?? null; },
      catalog: async () => f.catalog, metadata: async () => f.metadata, key: () => Buffer.from(f.key),
      download: async () => { if (unavailable) throw new Error('Synthetic missing object'); return f.cipher; },
      record: async (intent: unknown, source: unknown, outcome: string) => { await f.service(); return (await db.query<{ r: unknown }>('select record_invoice_source_read($1,$2,$3,$4) r', [f.owner, JSON.stringify(intent), JSON.stringify(source), outcome])).rows[0].r; },
    };
    const verified = await checkRetainedInvoiceSource(f.owner, f.input, deps); assert.equal(verified.outcome, 'verified');
    unavailable = true; await db.exec('reset role'); await db.query("delete from storage.objects where bucket_id='document-evidence' and name=$1", [f.path]);
    const recovered = await checkRetainedInvoiceSource(f.owner, f.input, deps); assert.deepEqual(recovered, verified);
    const failed = await checkRetainedInvoiceSource(f.owner, { ...f.input, request_id: randomUUID() }, deps); assert.equal(failed.outcome, 'unavailable');
    assert.equal((await db.query('select id from invoices')).rows.length, 0); assert.equal((await db.query('select id from financial_records')).rows.length, 0);
    const output = '/tmp/vibecount-invoice-source-read-demo'; await mkdir(output, { recursive: true });
    await writeFile(output + '/checks.json', JSON.stringify({ verified, recovered, failed }, null, 2) + '\n');
    await writeFile(output + '/README.md', '# Synthetic retained invoice source check\n\nActual AES-GCM encryption/decryption of synthetic PDF-shaped bytes is combined with ordered predecessor/forward SQL. The retained owner/hash context, plaintext hash/size and file signature match before a verified audit is inserted. A controlled catalog selected before synthetic object deletion reproduces loss before the next private download. Deletion cannot rewrite that past check; its exact request recovers without re-reading, while a fresh failed read records unavailable.\n\nOnly safe metadata is exported. No ciphertext, plaintext, file path, filename or key is emitted. This proves byte authentication on a synthetic in-memory transport, not hosted Storage HTTP permissions, PDF rendering or human semantic review. No canonical invoice, ledger posting, settlement, bank connection, external provider, send, payment, deployment or filing occurs.\n');
    console.log('Verified retained-source checks: ' + output);
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

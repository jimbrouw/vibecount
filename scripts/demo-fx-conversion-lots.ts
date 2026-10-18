// Ordered disposable SQL, real synthetic invoice encryption; no hosted operation.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
import { fxConversionLotFixture } from '../lib/database/fx-lot-fixture';
import { rateFromDecimal } from '../lib/fx/currency';
async function main() {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL('../supabase/migrations/', import.meta.url), migration = '20261019000000_fx_conversion_lot_bindings.sql';
    for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql') && n < migration).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
    const x = await fxConversionLotFixture(db); await db.exec('reset role'); await db.exec(await readFile(new URL(migration, dir), 'utf8'));
    const bound = await x.bind(); assert.equal(bound.invoice_limit_minor, 10001); assert.equal(bound.cash_limit_minor, 2500); assert.deepEqual(await x.bind(), bound);
    await assert.rejects(x.bind(randomUUID()), /single conversion-family/);
    const zeroProof = await x.review(await x.conversionIntent({ data: { rate: rateFromDecimal('KWD', 'GBP', '0.01'), conversion_date: '2026-04-06', evidence_date: '2026-04-07', invoice_portion_minor: 1, gbp_cash_portion_pence: 0, fee_mode: 'none' } }));
    const zero = await x.bind(randomUUID(), zeroProof); assert.equal(zero.cash_limit_minor, 0);
    await db.exec('reset role'); await db.query("delete from storage.objects where bucket_id='document-evidence' and name=$1", [x.f.path]); await assert.rejects(x.bind(), /current verified/);
    await x.f.auth(); assert.deepEqual((await db.query<{ r: unknown }>('select to_jsonb(f) r from financial_records f where bank_transaction_id=$1', [x.tx])).rows, x.before);
    assert.equal((await db.query('select id from invoice_settlements')).rows.length, 0);
    const lots = (await db.query('select id,invoice_id,invoice_revision_id,invoice_fact_revision_id,conversion_fact_revision_id,transaction_id,transaction_version,invoice_currency,cash_currency,invoice_limit_minor,cash_limit_minor,rate,conversion_date,evidence_date from fx_conversion_lots order by id')).rows;
    const output = '/tmp/vibecount-fx-conversion-lot-demo'; await mkdir(output, { recursive: true });
    await writeFile(output + '/lots.json', JSON.stringify({ synthetic_only: true, private_binding_only: true, lots, new_settlements: 0, recognized_income_unchanged: true, duplicate_rounding_reset_rejected: true, fresh_use_after_source_loss_rejected: true }, null, 2) + '\n');
    await writeFile(output + '/README.md', '# Private conversion-lot binding prerequisite\n\nActual ordered SQL binds KWD 10.001 documented conversion to GBP 25.00 within a separately approved GBP 25.01 synthetic receipt. A second recipe binds positive original units to zero documented cash. Exact repeated binding preserves identity; duplicate rounding reset rejects. Source loss prevents fresh use while immutable history remains. The previously recognised GBP receipt is unchanged, and zero settlements are created.\n\nHelpers are private: no user/service callable matching capability exists. Lots reserve no capacity and are not financial approval. Source hashes/references are synthetic; invoice byte encryption is real, bank transport uses fixture metadata. No hosted Auth/Storage, full settlement/reversal/export, real review, provider, send, payment, deployment or filing is proved. Only safe scalar metadata is emitted, no raw evidence, path or key.\n');
    console.log('Verified private conversion-lot bindings: ' + output);
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

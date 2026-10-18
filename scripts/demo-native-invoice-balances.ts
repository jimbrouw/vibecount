// Actual ordered SQL, entirely synthetic sources in disposable PostgreSQL.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
import { nativeBalanceFixture } from '../lib/database/native-balance-fixture';

async function main() {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL('../supabase/migrations/', import.meta.url), migration = '20261018190000_native_invoice_balance_scope.sql';
    for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql') && n < migration).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
    const f = await nativeBalanceFixture(db);
    const balances = async () => (await db.query('select * from invoice_payment_balances order by id')).rows;
    const before = await balances(), stamp = await f.financialStamp();
    await db.exec('reset role'); await db.exec(await readFile(new URL(migration, dir), 'utf8')); await f.auth();
    assert.deepEqual(await balances(), before); assert.equal(await f.financialStamp(), stamp);
    let externalAbsent = false;
    await db.exec('reset role;begin');
    try {
      // This deliberately unsupported candidate exists only until rollback.
      await db.exec('alter table invoices drop constraint invoice_native_origin_scope;alter table invoices alter column amount drop not null;');
      const candidate = randomUUID();
      await db.query("insert into invoices(id,user_id,client_id,number,description,status,amount,origin) values($1,$2,$3,'UNSUPPORTED','Synthetic candidate','finalised',null,'preserved_external')", [candidate, f.owner, f.client]);
      await f.auth();
      externalAbsent = (await db.query('select id from invoice_payment_balances where id=$1', [candidate])).rows.length === 0;
      assert.ok(externalAbsent);
    } finally { await db.exec('rollback'); await f.auth(); }
    const counts = (await db.query<{ records: number; recognized_income_pence: number | string; settlements: number }>("select (select count(*)::int from financial_records) records,(select sum(amount*100*effect_sign)::bigint from financial_records where status='approved' and record_type='income') recognized_income_pence,(select count(*)::int from invoice_settlements) settlements")).rows[0];
    assert.equal(before.length, 6); assert.equal(counts.records, 2); assert.equal(Number(counts.recognized_income_pence), 27000); assert.equal(counts.settlements, 3);
    const output = '/tmp/vibecount-native-balance-demo'; await mkdir(output, { recursive: true });
    await writeFile(output + '/balances.json', JSON.stringify({ synthetic_only: true, migration, native_balances_unchanged: true, balance_sha256: createHash('sha256').update(JSON.stringify(before)).digest('hex'), financial_stamp_unchanged: true, unsupported_candidate_excluded: externalAbsent, external_invoices_enabled: false, counts, balances: before }, null, 2) + '\n');
    await writeFile(output + '/README.md', '# Synthetic native GBP balance isolation\n\nReplays the complete predecessor SQL chain, creates reviewed synthetic invoice revisions, imports GBP 280.00 receipt and GBP 10.00 refund observations, and uses the real classification/allocation/credit/refund/assignment RPCs. The six native cases include a zero draft, a manual paid assertion with GBP 120.00 still outstanding, GBP 80.00 partial outstanding, settled and fully credited invoices, and GBP 20.00 refund due after GBP 10.00 returned cash. Recognised income remains GBP 270.00; reconciliation adds no income.\n\nThe forward migration retains every native balance and the financial stamp. An unsupported external candidate is excluded inside a rolled-back corruption fixture; all native-only shipping constraints remain.\n\nAll identities, evidence ciphertext, PDF hashes, Storage metadata and review attestations are synthetic placeholders. This does not prove readable retained originals, hosted acceptance or foreign settlement. No provider call, hosted write, real approval, send, payment or filing occurs.\n');
    console.log('Verified native GBP balances: ' + output);
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

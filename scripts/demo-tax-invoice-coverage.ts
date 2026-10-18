// Synthetic predecessor/current capture in disposable PostgreSQL. No hosted/provider activity.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
import { taxCurrencyFixture } from '../lib/database/tax-currency-fixture';
import { canonicalJson, prepareCalculation } from '../lib/tax/snapshot';
import { buildFilingPack, verifyFilingPack } from '../lib/tax/filing-pack';
async function main() {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL('../supabase/migrations/', import.meta.url), migration = '20261018200000_tax_invoice_currency_coverage.sql';
    for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql') && n < migration).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
    const f = await taxCurrencyFixture(db);
    await db.exec('reset role'); await db.exec(await readFile(new URL(migration, dir), 'utf8'));
    await f.auth(); assert.equal(verifyFilingPack(f.oldPack).schema_version, 'draft-filing-pack/2');
    await db.exec('reset role;begin');
    try {
      // Explicitly unsupported hypothetical canonical rows, never enabled outside this fixture.
      await db.exec('alter table invoices drop constraint invoice_native_origin_scope;alter table invoices drop constraint invoices_currency_check;alter table invoices alter column amount drop not null;');
      const constraints = (await db.query<{ conname: string }>("select conname from pg_constraint where conrelid='public.invoices'::regclass and contype='f' and pg_get_constraintdef(oid) like '%source_fact%'")).rows;
      for (const { conname } of constraints) await db.exec(`alter table invoices drop constraint "${conname}"`);
      for (const currency of ['GBP', 'USD', 'JPY', 'KWD']) await db.query("insert into invoices(user_id,client_id,number,description,status,invoice_date,amount,origin,currency,original_total_minor,currency_ruleset_id,source_fact_revision_id,source_fact_family_id) values($1,$2,$3,'Synthetic hypothetical external','finalised','2024-04-05',null,'preserved_external',$4,10001,'vibecount-currencies/1',$5,$6)", [f.owner, f.client, 'SYNTHETIC-' + currency, currency, randomUUID(), randomUUID()]);
      const current = prepareCalculation(await f.input());
      assert.equal(current.result.status, 'incomplete'); assert.equal(current.result.totals.net_balance, null);
      assert.ok(current.result.issues.some(i => i.code === 'invoice_currency_coverage'));
      await f.service();
      const saved = (await db.query<{ r: string }>('select capture_tax_calculation($1,2025,$2,$3,$4,$5,$6) r', [f.owner, current.inputJson, current.resultJson, current.rulesJson, 'Synthetic incomplete currency review', randomUUID()])).rows[0].r;
      const input = await f.packInput(saved), request = randomUUID(), bundle = buildFilingPack(input, [], request, false);
      await f.service();
      const pack = (await db.query<{ r: string }>('select capture_filing_pack($1,$2,$3,$4,$5,$6) r', [f.owner, saved, canonicalJson(input), canonicalJson(bundle), 'Synthetic incomplete currency pack', request])).rows[0].r;
      assert.ok(pack); assert.equal(bundle.schema_version, 'draft-filing-pack/3'); assert.equal(bundle.completeness_attested, false);
      assert.equal((await db.query<{ r: string }>('select capture_filing_pack($1,$2,$3,$4,$5,$6) r', f.packArgs)).rows[0].r, f.pack);
      const output = '/tmp/vibecount-tax-invoice-coverage-demo'; await mkdir(output, { recursive: true });
      await writeFile(output + '/current-input.json', current.inputJson + '\n'); await writeFile(output + '/calculation.json', current.resultJson + '\n');
      await writeFile(output + '/bundle.json', canonicalJson(bundle) + '\n');
      for (const artifact of bundle.artifacts) await writeFile(output + '/' + artifact.name, artifact.body);
      await writeFile(output + '/README.md', '# Synthetic tax/filing invoice currency coverage\n\nActual ordered predecessor/forward SQL creates and recovers historical incomplete v1-input/V2-pack bytes, then captures new v2 inputs and an incomplete V3 pack with an owner-wide canonical invoice coverage snapshot. Four hypothetical external invoices (GBP/USD/JPY/KWD) have 10,001 original minor units each and remain explicit blockers. Their older issue date is not used to guess cash-basis tax-year relevance. No GBP cash, taxable income or exchange rate is inferred. The seven artifacts share frozen inputs and contain separate document coverage metadata.\n\nExternal candidates exist only in a privileged rolled-back corruption fixture. Shipping native-only constraints remain; this is not an external capture or settlement workflow. All identities/source IDs/Storage/PDF metadata are synthetic placeholders, not retained readable originals. No hosted write, real approval, provider call, bank connection, send, payment, deployment or filing occurs.\n');
      console.log('Verified versioned tax/filing currency coverage: ' + output);
    } finally { await db.exec('rollback'); }
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

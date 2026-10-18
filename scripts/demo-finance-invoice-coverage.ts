// Synthetic disposable SQL only; metadata is not proof of readable original evidence.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
import { financeCurrencyFixture } from '../lib/database/finance-currency-fixture';
import { prepareCurrentFinancePlan } from '../lib/finance/snapshot';
import { verifyPlanRevision, type PlanRevision } from '../lib/finance/server';
import { canonicalJson } from '../lib/tax/snapshot';

async function main() {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL('../supabase/migrations/', import.meta.url), migration = '20261018210000_finance_invoice_currency_coverage.sql';
    for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql') && n < migration).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
    const f = await financeCurrencyFixture(db), sql = 'select capture_finance_plan($1,$2,$3,$4,$5,$6,$7,$8) r';
    await db.exec('reset role'); await db.exec(await readFile(new URL(migration, dir), 'utf8'));
    const ctx = await f.context(), native = prepareCurrentFinancePlan(f.owner, f.plan, f.today, f.catalog, ctx.invoice_coverage);
    assert.deepEqual(native.result.scenario, f.legacy.result); assert.equal(native.rulesJson, f.legacy.rulesJson);
    await f.service();
    const nativeArgs = [f.owner, ctx.ordinal, ctx.stamp, native.inputJson, native.resultJson, native.rulesJson, 'Synthetic native coverage review', randomUUID()];
    const nativeId = (await db.query<{ r: string }>(sql, nativeArgs)).rows[0].r;
    await f.auth();
    const nativeRow = (await db.query<PlanRevision>('select * from finance_plan_revisions where id=$1', [nativeId])).rows[0];
    assert.deepEqual(verifyPlanRevision(nativeRow, f.owner).result, native.result);
    await db.exec('reset role;begin');
    try {
      // Deliberate corruption fixture, rolled back below. Shipping constraints remain native-only.
      await db.exec('alter table invoices drop constraint invoice_native_origin_scope;alter table invoices drop constraint invoices_currency_check;alter table invoices alter column amount drop not null;');
      const constraints = (await db.query<{ conname: string }>("select conname from pg_constraint where conrelid='public.invoices'::regclass and contype='f' and pg_get_constraintdef(oid) like '%source_fact%'")).rows;
      for (const { conname } of constraints) await db.exec(`alter table invoices drop constraint "${conname}"`);
      for (const currency of ['GBP', 'USD', 'JPY', 'KWD']) await db.query("insert into invoices(user_id,client_id,number,description,status,amount,origin,currency,original_total_minor,currency_ruleset_id,source_fact_revision_id,source_fact_family_id) values($1,$2,$3,'Synthetic hypothetical external','finalised',null,'preserved_external',$4,10001,'vibecount-currencies/1',$5,$6)", [f.owner, f.client, 'SYNTHETIC-' + currency, currency, randomUUID(), randomUUID()]);
      await db.query("insert into invoices(user_id,client_id,number,description,status,amount,original_total_minor) values($1,$2,'INVALID','Synthetic invalid metadata','finalised',12,0)", [f.owner, f.client]);
      const currentContext = await f.context(), current = prepareCurrentFinancePlan(f.owner, f.plan, f.today, f.catalog, currentContext.invoice_coverage);
      assert.equal(current.result.status, 'incomplete'); assert.equal(current.result.current_free_cash_pence, null); assert.equal(current.result.additional_drawings_ceiling_pence, null);
      assert.equal(currentContext.invoice_coverage.unsupported_external_invoice_count, 4); assert.equal(currentContext.invoice_coverage.invalid_invoice_count, 1);
      assert.deepEqual(current.result.scenario, f.legacy.result);
      assert.equal(current.result.scenario.actual_cash_pence, 3000000); assert.equal(current.result.scenario.pension_assets_pence, 4305500);
      await f.service();
      const args = [f.owner, currentContext.ordinal, currentContext.stamp, current.inputJson, current.resultJson, current.rulesJson, 'Synthetic incomplete coverage review', randomUUID()];
      const id = (await db.query<{ r: string }>(sql, args)).rows[0].r;
      assert.equal((await db.query<{ r: string }>(sql, args)).rows[0].r, id);
      assert.equal((await db.query<{ r: string }>(sql, f.args)).rows[0].r, f.id);
      await f.auth();
      const saved = (await db.query<PlanRevision>('select * from finance_plan_revisions where id=$1', [id])).rows[0];
      const old = (await db.query<PlanRevision>('select * from finance_plan_revisions where id=$1', [f.id])).rows[0];
      assert.deepEqual(old, f.old); assert.deepEqual(verifyPlanRevision(saved, f.owner).result, current.result);
      const output = '/tmp/vibecount-finance-invoice-coverage-demo'; await mkdir(output, { recursive: true });
      for (const [name, body] of Object.entries({ 'legacy-input.json': f.legacy.inputJson, 'legacy-result.json': f.legacy.resultJson, 'native-input.json': native.inputJson, 'native-result.json': native.resultJson, 'current-input.json': current.inputJson, 'current-result.json': current.resultJson, 'rules.json': current.rulesJson, 'verified-snapshot.json': canonicalJson(verifyPlanRevision(saved, f.owner)) })) await writeFile(output + '/' + name, body + '\n');
      await writeFile(output + '/README.md', '# Synthetic finance invoice coverage\n\nActual ordered predecessor/forward SQL captures legacy v1 and current v2 plans and recovers exact requests. Four unsupported hypothetical GBP/USD/JPY/KWD documents (10,001 original minor units each) and one invalid representation withhold effective free cash and additional drawings. The unchanged manually entered scenario retains GBP 30,000 cash and GBP 43,055 inaccessible pension assets; neither is a production default. Original invoice units are never converted or added to cash.\n\nExternal candidates exist only inside a privileged rolled-back corruption fixture. Evidence/PDF/Storage identifiers and hashes are synthetic metadata, not readable-original proof. This is not canonical external capture, financial settlement, bank verification, a hosted test or a tax return. No hosted write, real approval, provider call, bank connection, send, payment, deployment or filing occurs.\n');
      console.log('Verified finance coverage and historical replay: ' + output);
    } finally { await db.exec('rollback'); }
    await f.auth();
    assert.equal((await db.query("select id from invoices where origin<>'native_gbp'")).rows.length, 0);
    assert.equal((await db.query('select id from financial_records')).rows.length, 0);
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { financeCurrencyFixture } from './finance-currency-fixture';
import { prepareCurrentFinancePlan } from '../finance/snapshot';
import { verifyPlanRevision, type PlanRevision, type PlanContext } from '../finance/server';
import { canonicalJson } from '../tax/snapshot';

test('current finance coverage retains predecessor history and independently gates conditional drawings', async t => {
  const db = new PGlite({ extensions: { pgcrypto } }); t.after(() => db.close()); await db.exec(TEST_SCHEMA_BOOTSTRAP);
  const dir = new URL('../../supabase/migrations/', import.meta.url), migration = '20261018210000_finance_invoice_currency_coverage.sql';
  for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql') && n < migration).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
  const f = await financeCurrencyFixture(db), sql = 'select capture_finance_plan($1,$2,$3,$4,$5,$6,$7,$8) r';
  await db.exec('reset role'); await db.exec(await readFile(new URL(migration, dir), 'utf8'));
  async function oldRetry() {
    await f.service(); assert.equal((await db.query<{ r: string }>(sql, f.args)).rows[0].r, f.id);
    await f.auth(); const row = (await db.query<PlanRevision>('select * from finance_plan_revisions where id=$1', [f.id])).rows[0];
    assert.deepEqual(row, f.old); assert.deepEqual(verifyPlanRevision(row, f.owner).result, f.legacy.result);
  }
  await serialSubtest(t, 'native context, manual scenario, selected source/rule bytes and exact old requests survive upgrade', async () => {
    const ctx = await f.context(); assert.equal(ctx.schema_version, 'finance-plan-context/2');
    assert.equal(ctx.invoice_coverage.native_invoice_count, 1); assert.equal(ctx.invoice_coverage.draft_invoice_count, 1); assert.equal(ctx.invoice_coverage.unsupported_external_invoice_count, 0);
    const current = prepareCurrentFinancePlan(f.owner, f.plan, f.today, f.catalog, ctx.invoice_coverage);
    assert.deepEqual(current.result.scenario, f.legacy.result); assert.equal(current.rulesJson, f.legacy.rulesJson); assert.deepEqual(current.input.sources, f.legacy.input.sources);
    assert.doesNotMatch(current.inputJson, /PRIVATE_/); await oldRetry();
    await f.service();
    const args = [f.owner, ctx.ordinal, ctx.stamp, current.inputJson, current.resultJson, current.rulesJson, 'Synthetic current draft', randomUUID()];
    const id = (await db.query<{ r: string }>(sql, args)).rows[0].r; assert.equal((await db.query<{ r: string }>(sql, args)).rows[0].r, id);
    await f.auth(); const row = (await db.query<PlanRevision>('select * from finance_plan_revisions where id=$1', [id])).rows[0];
    assert.deepEqual(verifyPlanRevision(row, f.owner).result, current.result);
    await f.service(); const changed = [...f.args]; changed[6] = 'Changed retained reason'; await assert.rejects(db.query(sql, changed), /different inputs/);
  });
  await serialSubtest(t, 'owner derivation, anonymous and private old/new helper boundaries remain intact', async () => {
    await f.auth(f.other); const other = (await db.query<{ c: PlanContext }>('select read_finance_plan_context() c')).rows[0].c;
    assert.equal(other.owner_id, f.other); assert.equal(other.invoice_coverage.invoice_count, 0); assert.equal((await db.query('select * from finance_plan_revisions')).rows.length, 0);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await db.exec('reset role;set role ' + role);
      for (const name of ['finance_plan_context_for_owner', 'finance_plan_context_v1_for_owner', 'invoice_currency_coverage_for_owner']) await assert.rejects(db.query(`select ${name}($1)`, [f.owner]), /permission denied/);
    }
    await db.exec('reset role;set role anon'); await assert.rejects(db.query('select read_finance_plan_context()'), /permission denied/);
    await f.auth(); await assert.rejects(db.query(sql, f.args), /permission denied/);
  });
  await serialSubtest(t, 'external GBP/foreign and invalid metadata change context and withhold drawings while scenario cash remains separate', async () => {
    const before = await f.context(), previous = prepareCurrentFinancePlan(f.owner, f.plan, f.today, f.catalog, before.invoice_coverage);
    await db.exec('reset role;begin');
    try {
      // Unsupported hypothetical canonical rows are confined to this rolled-back fixture.
      await db.exec('alter table invoices drop constraint invoice_native_origin_scope;alter table invoices drop constraint invoices_currency_check;alter table invoices alter column amount drop not null;');
      const constraints = (await db.query<{ conname: string }>("select conname from pg_constraint where conrelid='public.invoices'::regclass and contype='f' and pg_get_constraintdef(oid) like '%source_fact%'")).rows;
      for (const { conname } of constraints) await db.exec(`alter table invoices drop constraint "${conname}"`);
      for (const currency of ['GBP', 'USD', 'JPY', 'KWD']) await db.query("insert into invoices(user_id,client_id,number,description,status,amount,origin,currency,original_total_minor,currency_ruleset_id,source_fact_revision_id,source_fact_family_id) values($1,$2,$3,'PRIVATE_EXTERNAL','finalised',null,'preserved_external',$4,10001,'vibecount-currencies/1',$5,$6)", [f.owner, f.client, 'EXT-' + currency, currency, randomUUID(), randomUUID()]);
      await db.query("insert into invoices(user_id,client_id,number,description,status,amount,original_total_minor) values($1,$2,'INVALID','Synthetic invalid','finalised',12,0)", [f.owner, f.client]);
      const ctx = await f.context(), current = prepareCurrentFinancePlan(f.owner, f.plan, f.today, f.catalog, ctx.invoice_coverage);
      assert.notEqual(ctx.stamp, before.stamp); assert.equal(ctx.invoice_coverage.unsupported_external_invoice_count, 4); assert.equal(ctx.invoice_coverage.invalid_invoice_count, 1);
      assert.equal(current.result.status, 'incomplete'); assert.equal(current.result.current_free_cash_pence, null); assert.equal(current.result.additional_drawings_ceiling_pence, null);
      assert.deepEqual(current.result.scenario, f.legacy.result); assert.equal(current.result.scenario.actual_cash_pence, 3000000); assert.equal(current.result.scenario.pension_assets_pence, 4305500);
      await f.service();
      const call = (input = current.inputJson, result = current.resultJson, stamp = ctx.stamp) => db.query<{ r: string }>(sql, [f.owner, ctx.ordinal, stamp, input, result, current.rulesJson, 'Synthetic unresolved finance coverage', randomUUID()]);
      await db.exec('savepoint stale'); await assert.rejects(call(previous.inputJson, previous.resultJson, before.stamp), /sources changed/); await db.exec('rollback to savepoint stale');
      for (const result of [{ ...current.result, status: 'estimate' }, { ...current.result, current_free_cash_pence: 1 }, { ...current.result, additional_drawings_ceiling_pence: 1 }]) {
        await db.exec('savepoint forged'); await assert.rejects(call(current.inputJson, canonicalJson(result)), /cannot authorize conditional drawings/); await db.exec('rollback to savepoint forged');
      }
      const missing = structuredClone(current.result) as Partial<typeof current.result>; delete missing.current_free_cash_pence;
      await db.exec('savepoint missing'); await assert.rejects(call(current.inputJson, canonicalJson(missing)), /versioned finance result/); await db.exec('rollback to savepoint missing');
      await db.exec('savepoint forged_coverage'); await assert.rejects(call(canonicalJson({ ...current.input, invoice_coverage: previous.input.invoice_coverage })), /coverage changed/); await db.exec('rollback to savepoint forged_coverage');
      const id = (await call()).rows[0].r; await f.auth();
      const row = (await db.query<PlanRevision>('select * from finance_plan_revisions where id=$1', [id])).rows[0]; assert.deepEqual(verifyPlanRevision(row, f.owner).result, current.result);
      await oldRetry();
    } finally { await db.exec('rollback'); await f.auth(); }
    await oldRetry();
    assert.equal((await db.query<{ n: number }>('select count(*)::int n from financial_records')).rows[0].n, 0);
    assert.equal((await db.query("select id from invoices where origin<>'native_gbp'")).rows.length, 0);
  });
});

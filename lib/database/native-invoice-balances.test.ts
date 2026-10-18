import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { nativeBalanceFixture } from './native-balance-fixture';

test('native GBP balance isolation preserves actual reviewed history and rejects unsupported dimensions', async t => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(TEST_SCHEMA_BOOTSTRAP);
  const dir = new URL('../../supabase/migrations/', import.meta.url), migration = '20261018190000_native_invoice_balance_scope.sql';
  for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql') && n < migration).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
  const f = await nativeBalanceFixture(db), forward = await readFile(new URL(migration, dir), 'utf8');
  const views = ['invoice_payment_balances', 'invoice_credit_choices', 'invoice_refund_choices'];
  const rows = async (table: string) => (await db.query(`select to_jsonb(t) row from public.${table} t order by to_jsonb(t)::text`)).rows;
  const beforeViews = await Promise.all(views.map(rows)), beforeStamp = await f.financialStamp();
  const tables = ['invoices', 'invoice_revisions', 'financial_records', 'bank_transactions', 'source_rows', 'record_source_files', 'classification_decisions', 'invoice_settlements', 'settlement_requests', 'invoice_credit_notes', 'invoice_credit_requests', 'refund_links', 'invoice_refund_assignments', 'invoice_refund_requests'];
  const tableSnapshot = async () => {
    // Raw encrypted source columns are deliberately unavailable to authenticated users.
    await db.exec('reset role');
    const snapshot = [];
    for (const table of tables) snapshot.push(await rows(table));
    await f.auth();
    return snapshot;
  };
  const beforeTables = await tableSnapshot();
  const contract = async () => ({
    relation: (await db.query<{ oid: number; relacl: string; reloptions: string[] }>("select oid::int,relacl::text,reloptions from pg_class where oid='public.invoice_payment_balances'::regclass")).rows,
    columns: (await db.query("select attnum,attname,atttypid::int,atttypmod,attnotnull from pg_attribute where attrelid='public.invoice_payment_balances'::regclass and attnum>0 and not attisdropped order by attnum")).rows,
  });
  const beforeContract = await contract();
  const predecessor = (await readFile(new URL('20261017180000_invoice_refund_assignments.sql', dir), 'utf8')).split('create or replace view public.invoice_payment_balances')[1].split('\n\n-- Preserve every existing choice-column')[0];
  await db.exec('reset role'); await db.exec(forward); await f.auth();

  await serialSubtest(t, 'native output, dependent choices, relation identity, types, ACLs and source history remain unchanged', async () => {
    assert.deepEqual(await contract(), beforeContract);
    assert.equal(beforeContract.columns.length, 24);
    assert.ok((beforeContract.relation[0].reloptions as string[]).includes('security_invoker=true'));
    assert.deepEqual(await Promise.all(views.map(rows)), beforeViews);
    assert.deepEqual(await tableSnapshot(), beforeTables);
    assert.equal(await f.financialStamp(), beforeStamp);
    const balances = (await db.query<{ id: string; status: string; invoice_pence: number; outstanding_pence: number; settlement_state: string; returned_pence: number; refund_due_pence: number; allocated_pence: number }>('select * from invoice_payment_balances')).rows;
    const b = (name: string) => balances.find(b => b.id === f.ids[name])!;
    assert.equal(balances.length, 6);
    assert.equal(Number(b('draft').invoice_pence), 0); assert.equal(b('draft').status, 'draft');
    assert.equal(Number(b('manual').outstanding_pence), 12000); assert.equal(Number(b('manual').allocated_pence), 0);
    assert.equal(b('partial').settlement_state, 'part_paid'); assert.equal(Number(b('partial').outstanding_pence), 8000);
    assert.equal(b('settled').settlement_state, 'settled'); assert.equal(Number(b('settled').outstanding_pence), 0);
    assert.equal(b('credited').settlement_state, 'fully_credited');
    assert.equal(b('returned').settlement_state, 'refund_due'); assert.equal(Number(b('returned').returned_pence), 1000); assert.equal(Number(b('returned').refund_due_pence), 2000);
  });
  await serialSubtest(t, 'retained revision, allocation, credit and returned-cash requests recover exact predecessor results', async () => {
    for (const call of f.revisions) assert.deepEqual((await db.query<{ r: unknown }>('select save_invoice_revision($1,$2,$3,$4,$5,$6) r', call.args)).rows[0].r, call.result);
    assert.deepEqual((await db.query<{ r: unknown }>('select approve_invoice_allocations($1,$2,$3,$4,$5,$6) r', f.allocationArgs)).rows[0].r, f.allocationResult);
    for (const call of f.credits) assert.deepEqual((await db.query<{ r: unknown }>('select approve_invoice_credit($1,$2,$3,$4,$5,$6,$7,$8,$9) r', call.args)).rows[0].r, call.result);
    assert.deepEqual((await db.query<{ r: unknown }>('select approve_invoice_refund_assignment($1,$2,$3,$4,$5,$6,$7) r', f.assignmentArgs)).rows[0].r, f.assignmentResult);
    assert.deepEqual(await tableSnapshot(), beforeTables);
  });
  await serialSubtest(t, 'hypothetical external and malformed native rows expose the predecessor defect and are excluded by the forward view', async () => {
    await db.exec('reset role;begin');
    try {
      // Rollback-only corruption fixture. Shipping constraints are never relaxed.
      await db.exec('alter table invoices drop constraint invoice_native_origin_scope;alter table invoices drop constraint invoices_currency_check;alter table invoices alter column amount drop not null;');
      const constraints = (await db.query<{ conname: string }>("select conname from pg_constraint where conrelid='public.invoices'::regclass and contype='f' and pg_get_constraintdef(oid) like '%source_fact%'")).rows;
      for (const { conname } of constraints) await db.exec(`alter table invoices drop constraint "${conname}"`);
      const variants = [
        { origin: 'preserved_external', currency: 'GBP', amount: 120 },
        { origin: 'preserved_external', currency: 'USD', amount: null },
        { origin: 'native_gbp', currency: 'USD', amount: 120 },
        { origin: 'native_gbp', currency: 'GBP', amount: null },
        { origin: 'native_gbp', currency: 'GBP', amount: 120, original_total_minor: 0 },
        { origin: 'native_gbp', currency: 'GBP', amount: 120, currency_ruleset_id: 'vibecount-currencies/1' },
        { origin: 'native_gbp', currency: 'GBP', amount: 120, source_fact_revision_id: randomUUID() },
        { origin: 'native_gbp', currency: 'GBP', amount: 120, source_fact_family_id: randomUUID() },
      ];
      const candidates = [];
      for (const [index, variant] of variants.entries()) {
        const id = randomUUID(); candidates.push(id);
        await db.query(`insert into invoices(id,user_id,client_id,number,description,status,${Object.keys(variant).join(',')}) values($1,$2,$3,$4,'Unsupported fixture','finalised',${Object.keys(variant).map((_, i) => '$' + (i + 5)).join(',')})`, [id, f.owner, f.client, `HOSTILE-${index}`, ...Object.values(variant)]);
      }
      await db.exec('create or replace view public.invoice_payment_balances' + predecessor);
      await f.auth();
      assert.equal((await db.query('select id from invoice_payment_balances where id=any($1::uuid[])', [candidates])).rows.length, variants.length);
      await db.exec('reset role'); await db.exec(forward); await f.auth();
      assert.deepEqual(await Promise.all(views.map(rows)), beforeViews);
      const contextualRecord = randomUUID();
      await db.query("insert into financial_records(id,user_id,record_type,record_date,amount,description,status) values($1,$2,'income','2026-04-06',1,'Synthetic unlinked draft','draft')", [contextualRecord, f.owner]);
      for (const candidate of candidates) {
        for (const table of ['invoice_settlements', 'invoice_credit_notes', 'invoice_refund_assignments', 'financial_records']) {
          await db.exec('reset role;savepoint rejected_write');
          await assert.rejects(db.query(`insert into ${table}(user_id,invoice_id) values($1,$2)`, [f.owner, candidate]), /currency-aware invoice relationship/);
          await db.exec('rollback to savepoint rejected_write');
        }
        await f.auth(); await db.exec('savepoint rejected_reassignment');
        await assert.rejects(db.query('update financial_records set invoice_id=$1 where id=$2', [candidate, contextualRecord]), /currency-aware invoice relationship/);
        await db.exec('rollback to savepoint rejected_reassignment');
      }
    } finally { await db.exec('rollback'); await f.auth(); }
    assert.equal(await f.financialStamp(), beforeStamp);
  });
  await serialSubtest(t, 'existing owner, service and anonymous permissions remain in force', async () => {
    await f.auth(f.other);
    for (const view of views) assert.equal((await rows(view)).length, 0);
    await db.exec('reset role;set role anon');
    await assert.rejects(rows('invoice_payment_balances'), /permission denied/);
    await db.exec('reset role;set role service_role');
    assert.equal((await rows('invoice_payment_balances')).length, 6);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await db.exec('reset role;set role ' + role);
      await assert.rejects(db.query('select require_native_invoice_relationship()'), /permission denied/);
    }
    await f.auth();
  });
  await serialSubtest(t, 'shipping native-only constraints still reject external enablement', async () => {
    await assert.rejects(db.query("update invoices set origin='preserved_external' where id=$1", [f.ids.draft]));
    await assert.rejects(db.query('update invoices set original_total_minor=0 where id=$1', [f.ids.draft]));
    await assert.rejects(db.query('update invoices set amount=null where id=$1', [f.ids.draft]));
    assert.deepEqual(await Promise.all(views.map(rows)), beforeViews);
  });
});

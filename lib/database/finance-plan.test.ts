import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema.ts';
import { serialSubtest } from './serial-subtest.ts';
import { canonicalJson } from '../tax/snapshot.ts';
import { prepareBankCoveredFinancePlan } from '../finance/snapshot.ts';
import { verifyPlanRevision, type PlanRevision, type PlanContext } from '../finance/server.ts';
import { financeScenario } from '../finance/coverage';
import { financeFixture } from '../finance/test-fixture.ts';
import { londonPlanningDate } from '../finance/defaults.ts';

test('immutable owner-wide cash plans protect capacity, provenance, retries and zero postings', async t => {
    const db = new PGlite({ extensions: { pgcrypto } }); t.after(() => db.close());
    await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL('../../supabase/migrations/', import.meta.url);
    for (const n of (await readdir(dir)).filter(n => n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(n, dir), 'utf8'));
    const owner = randomUUID(), other = randomUUID();
    await db.query('insert into auth.users values ($1),($2)', [owner, other]);
    const bank = randomUUID(), doc = randomUUID(), foreign = randomUUID();
    await db.query("insert into financial_accounts(id,user_id,label,provider,account_type,masked_identifier) values ($1,$2,'Synthetic bank','starling','bank','1234')", [bank, owner]);
    await db.query("insert into evidence_documents(id,user_id,file_hash,media_type,size_bytes,object_path,key_id) values ($1,$2,$3,'application/pdf',100,$2::uuid::text||'/synthetic.enc','PRIVATE_KEY'),($4,$5,$6,'application/pdf',100,'PRIVATE/FOREIGN','PRIVATE_KEY')", [doc, owner, 'a'.repeat(64), foreign, other, 'b'.repeat(64)]);
    const today = londonPlanningDate(), plan = financeFixture(today); plan.assets[0].account_id = bank; plan.assets[0].document_id = doc;
    const catalog = { accounts: [{ id: bank, user_id: owner, label: 'Synthetic bank', provider: 'starling', account_type: 'bank', currency: 'GBP', masked_identifier: '1234' }], documents: [{ id: doc, user_id: owner, file_sha256: 'a'.repeat(64), media_type: 'application/pdf', size_bytes: 100 }] };
    async function auth(who: string = owner) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who]); await db.exec(who ? 'set role authenticated' : 'set role anon'); }
    async function service() { await db.exec('reset role'); await db.exec("select set_config('request.jwt.claim.sub','',false);set role service_role"); }
    async function context() { await auth(); return (await db.query<{ c: PlanContext }>('select read_finance_plan_context() c')).rows[0].c; }
    const initial = await context(), request = randomUUID(), prepared = prepareBankCoveredFinancePlan(owner, plan, today, catalog, initial.invoice_coverage, initial.bank_source_coverage);
    const sql = 'select capture_finance_plan($1,$2,$3,$4,$5,$6,$7,$8) id';
    function args(p = prepared, ctx = initial, req = request) { return [owner, ctx.ordinal, ctx.stamp, p.inputJson, p.resultJson, p.rulesJson, 'Synthetic reviewed cash inputs', req]; }
    async function capture(p = prepared, ctx = initial, req = request) { await service(); return (await db.query<{ id: string }>(sql, args(p, ctx, req))).rows[0].id; }
    let saved = '';
    await serialSubtest(t, 'service capture freezes draft bytes, selected owned sources and no financial effects', async () => {
        saved = await capture(); assert.equal(await capture(), saved);
        await auth(); const row = (await db.query<PlanRevision>('select * from finance_plan_revisions where id=$1', [saved])).rows[0];
        assert.equal(row.ordinal, 1); assert.equal(row.author, owner); assert.equal(financeScenario(verifyPlanRevision(row, owner).result).actual_cash_pence, 3000000);
        assert.ok(!row.input_canonical_json.includes('PRIVATE'));
        assert.equal((await db.query<{ n: number }>('select count(*)::int n from financial_records')).rows[0].n, 0);
        assert.equal((await context()).ordinal, 1);
    });
    await serialSubtest(t, 'anonymous, foreign-owner, direct mutation and owner export-link boundaries hold', async () => {
        await auth(); await assert.rejects(db.query(sql, args()), /permission denied/);
        await assert.rejects(db.query('insert into finance_plan_revisions select * from finance_plan_revisions'), /permission denied/);
        await assert.rejects(db.query("update finance_plan_revisions set rationale='changed'"), /permission denied/);
        await auth(other); assert.equal((await db.query('select * from finance_plan_revisions')).rows.length, 0);
        await assert.rejects(db.query("insert into record_exports(user_id,export_type,record_count,finance_plan_id) values ($1,'json',2,$2)", [other, saved]), /foreign key/);
        await auth(''); await assert.rejects(db.query('select read_finance_plan_context()'), /permission denied/);
        await service(); await assert.rejects(db.query('select finance_plan_context_for_owner($1)', [owner]), /permission denied/);
        await db.exec('reset role'); await assert.rejects(db.query("update finance_plan_revisions set rationale='changed' where id=$1", [saved]), /immutable/);
    });
    await serialSubtest(t, 'new ordinal supersedes the whole owner plan while old exact retries recover immutable history', async () => {
        const ctx = await context(), changed = structuredClone(plan); changed.assets[0].balance_pence = 2900000;
        const next = prepareBankCoveredFinancePlan(owner, changed, today, catalog, ctx.invoice_coverage, ctx.bank_source_coverage), id = await capture(next, ctx, randomUUID());
        assert.notEqual(id, saved); assert.equal((await context()).ordinal, 2);
        await assert.rejects(capture(prepared, ctx, randomUUID()), /changed/);
        assert.equal(await capture(), saved);
        const changedRequest = args(next, initial, request); await service(); await assert.rejects(db.query(sql, changedRequest), /different inputs/);
    });
    await serialSubtest(t, 'catalog changes reject new captures but do not invalidate old byte recovery', async () => {
        const before = await context(); await db.exec('reset role'); await db.query("update financial_accounts set label='Changed synthetic bank' where id=$1", [bank]);
        await assert.rejects(capture(prepared, before, randomUUID()), /sources changed/);
        assert.equal(await capture(), saved);
        const ctx = await context();
        await assert.rejects(capture(prepared, ctx, randomUUID()), /sources changed/); // Submitted selected label is old.
        await db.exec('reset role'); await db.query("update financial_accounts set label='Synthetic bank' where id=$1", [bank]);
    });
    await serialSubtest(t, 'write boundary rejects foreign source forgery, overallocated cash, unsafe fields and stale evaluation date', async () => {
        const ctx = await context();
        const forged = structuredClone(prepared); forged.input.plan.assets[0].document_id = foreign; forged.inputJson = canonicalJson(forged.input);
        await assert.rejects(capture(forged, ctx, randomUUID()), /not owned/);
        const capacity = structuredClone(prepared); capacity.input.plan.earmarks.push({ id: 'other-year', asset_id: 'synthetic-cash', purpose: 'tax_reserve', tax_year_start: 2025, amount_pence: 2900000 }); capacity.inputJson = canonicalJson(capacity.input);
        await assert.rejects(capture(capacity, ctx, randomUUID()), /cash capacity/);
        const unsafe = structuredClone(prepared); Object.assign(unsafe.input.plan.assets[0], { raw_bank_pdf: 'PRIVATE' }); unsafe.inputJson = canonicalJson(unsafe.input);
        await assert.rejects(capture(unsafe, ctx, randomUUID()), /asset fields/);
        const old = structuredClone(prepared); old.input.evaluated_on = '2000-01-01'; old.inputJson = canonicalJson(old.input);
        await assert.rejects(capture(old, ctx, randomUUID()), /owner\/date/);
        assert.equal((await context()).ordinal, 2);
    });
    await serialSubtest(t, 'rules are immutable and an injected late failure rolls back the revision', async () => {
        const ctx = await context(), changed = structuredClone(prepared); changed.rulesJson = canonicalJson({ ...changed.rules, source_reviewed_at: '2000-01-01' });
        await assert.rejects(capture(changed, ctx, randomUUID()), /rules version changed/);
        await db.exec('reset role'); await db.exec("create function public.fail_finance_capture() returns trigger language plpgsql as $$ begin raise exception 'Injected finance capture failure';end;$$;create trigger test_late_finance_failure after insert on finance_plan_revisions for each row execute function fail_finance_capture();");
        const req = randomUUID(); await assert.rejects(capture(prepared, ctx, req), /Injected finance/);
        await db.exec('reset role'); assert.equal((await db.query<{ n: number }>('select count(*)::int n from finance_plan_revisions where request_id=$1', [req])).rows[0].n, 0);
        assert.equal((await context()).ordinal, 2);
    });
    await serialSubtest(t, 'targeted documents leave current catalogs while exact historical captures remain available',async()=>{
        const before=await context();await auth();
        assert.equal((await db.query('select id from current_evidence_documents where id=$1',[doc])).rows.length,1);
        await db.exec('reset role');await db.query("insert into evidence_deletion_targets(user_id,request_id,bucket_id,object_path,file_hash) values($1,$2,'document-evidence',$3,$4)",[owner,randomUUID(),owner+'/synthetic.enc','a'.repeat(64)]);
        const after=await context();assert.notEqual(after.stamp,before.stamp);
        assert.equal((await db.query('select id from current_evidence_documents where id=$1',[doc])).rows.length,0);
        assert.equal((await db.query('select id from evidence_documents where id=$1',[doc])).rows.length,1);
        await assert.rejects(db.query('select * from retained_evidence_documents'),/permission denied/);
        await assert.rejects(capture(prepared,after,randomUUID()),/Planning evidence not owned/);
        assert.equal(await capture(),saved);
        await auth(other);assert.equal((await db.query('select id from current_evidence_documents where id=$1',[doc])).rows.length,0);
        await auth('');await assert.rejects(db.query('select * from current_evidence_documents'),/permission denied/);
    });

});

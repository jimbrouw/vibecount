import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { canonicalJson } from '../tax/snapshot';
import { londonPlanningDate, emptyFinancePlan } from '../finance/defaults';
import { prepareBankCoveredFinancePlan } from '../finance/snapshot';
import type { PlanRevision, PlanContext } from '../finance/server';
import { emptyDeadlinePlan } from '../finance/deadlines/model';
import { deadlineCatalogFromPlan, prepareDeadlineSnapshot, verifyDeadlineSnapshot } from '../finance/deadlines/snapshot';
import type { DeadlineContext, DeadlineRevision } from '../finance/deadlines/server';

test('deadline captures retain owned sources, immutable review and zero financial effects', async t => {
    const db = new PGlite({ extensions: { pgcrypto } }); t.after(() => db.close()); await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL('../../supabase/migrations/', import.meta.url); for (const n of (await readdir(dir)).filter(n => n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(n, dir), 'utf8'));
    const owner = randomUUID(), other = randomUUID(), doc = randomUUID(), foreign = randomUUID(), today = londonPlanningDate();
    await db.query('insert into auth.users values ($1),($2)', [owner, other]);
    await db.query("insert into evidence_documents(id,user_id,file_hash,media_type,size_bytes,object_path,key_id) values ($1,$2,$3,'application/pdf',100,$2::uuid::text||'/synthetic.enc','KEY'),($4,$5,$6,'application/pdf',100,'PRIVATE/FOREIGN','KEY')", [doc, owner, 'a'.repeat(64), foreign, other, 'b'.repeat(64)]);
    const documents = [{ id: doc, user_id: owner, file_sha256: 'a'.repeat(64) }];
    async function auth(who: string = owner) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who]); await db.exec(who ? 'set role authenticated' : 'set role anon'); }
    async function service() { await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role service_role"); }
    async function context(year = 2025) { await auth(); return (await db.query<{ c: DeadlineContext }>('select read_tax_deadline_context($1) c', [year])).rows[0].c; }
    async function source() { await auth(); return (await db.query<PlanRevision>('select * from finance_plan_revisions where user_id=$1 order by ordinal desc limit 1', [owner])).rows[0] ?? null; }
    async function prepare(year = 2025) {
        const c = deadlineCatalogFromPlan(owner, year, await source(), documents), plan = emptyDeadlinePlan(year, c);
        Object.assign(plan.entries.find(e => e.id === 'calendar:online')!, { applicability: 'applies', date_basis: 'notice', notice_due_date: '2027-03-01', notice_document_id: doc });
        return prepareDeadlineSnapshot(owner, plan, today, c);
    }
    const sql = 'select capture_tax_deadline_review($1,$2,$3,$4,$5,$6,$7,$8,$9) id';
    function args(p: Awaited<ReturnType<typeof prepare>>, ctx: DeadlineContext, req = randomUUID()) { return [owner, p.input.plan.tax_year_start, ctx.ordinal, ctx.stamp, p.inputJson, p.resultJson, p.rulesJson, 'Synthetic reminder review, not payment', req]; }
    async function capture(a: unknown[]) { await service(); return (await db.query<{ id: string }>(sql, a)).rows[0].id; }
    async function saveFinance() {
        await auth(); const ctx = (await db.query<{ c: PlanContext }>('select read_finance_plan_context() c')).rows[0].c;
        const plan = emptyFinancePlan(today);
        for (const [id, amount] of [['a_B', 0], ['a-b', null], ['A_b', 100], ['10', 250]] as const) plan.obligations.push({ id, label: 'Synthetic unpaid ' + id + ' amount ' + String(amount), kind: 'tax', tax_year_start: 2025, due_date: '2027-01-31', amount_pence: amount });
        plan.obligations.push({ id: 'unknown', label: 'Unassigned year', kind: 'tax', tax_year_start: null, due_date: '2027-01-31', amount_pence: null });
        const p = prepareBankCoveredFinancePlan(owner, plan, today, { accounts: [], documents: [] }, ctx.invoice_coverage, ctx.bank_source_coverage); await service();
        return (await db.query<{ id: string }>('select capture_finance_plan($1,$2,$3,$4,$5,$6,$7,$8) id', [owner, ctx.ordinal, ctx.stamp, p.inputJson, p.resultJson, p.rulesJson, 'Synthetic cash source review', randomUUID()])).rows[0].id;
    }
    const first = await prepare(), initial = await context(), firstArgs = args(first, initial), req = firstArgs[8]; let saved = '';
    await serialSubtest(t, 'service-only capture retains safe exact bytes and no financial postings', async () => {
        saved = await capture(firstArgs); assert.equal(await capture(firstArgs), saved); await auth();
        const row = (await db.query<DeadlineRevision>('select * from tax_deadline_revisions where id=$1', [saved])).rows[0];
        assert.equal(row.source_plan_id, null); assert.equal(row.ordinal, 1); assert.equal(row.author, owner);
        assert.deepEqual(verifyDeadlineSnapshot(row, owner, deadlineCatalogFromPlan(owner, 2025, null, documents)).result, first.result);
        assert.ok(!row.input_canonical_json.includes('PRIVATE')); assert.equal((await db.query<{ n: number }>('select count(*)::int n from financial_records')).rows[0].n, 0);
    });
    await serialSubtest(t, 'auth, owner read/export isolation, direct writes and private helpers reject', async () => {
        await auth(); await assert.rejects(db.query(sql, firstArgs), /permission denied/);
        await assert.rejects(db.query('insert into tax_deadline_revisions select * from tax_deadline_revisions'), /permission denied/);
        await assert.rejects(db.query("update tax_deadline_revisions set rationale='changed'"), /permission denied/);
        await auth(other); assert.equal((await db.query('select * from tax_deadline_revisions')).rows.length, 0);
        await assert.rejects(db.query("insert into record_exports(user_id,export_type,record_count,tax_deadline_id) values($1,'json',7,$2)", [other, saved]), /foreign key/);
        await auth(''); await assert.rejects(db.query('select read_tax_deadline_context(2025)'), /permission denied/);
        await service(); await assert.rejects(db.query('select tax_deadline_context_for_owner($1,2025)', [owner]), /permission denied/);
        await assert.rejects(db.query("insert into tax_deadline_revisions select * from tax_deadline_revisions"), /permission denied/);
        await db.exec('reset role'); await assert.rejects(db.query("delete from tax_deadline_revisions where id=$1", [saved]), /immutable/);
    });
    await serialSubtest(t, 'first cash-plan transition invalidates fresh captures; exact old request recovers before mutable reads', async () => {
        const oldContext = await context(), old = await prepare(); await saveFinance();
        await assert.rejects(capture(args(old, oldContext)), /sources changed/); assert.equal(await capture(firstArgs), saved);
        await assert.rejects(capture([...firstArgs.slice(0, 7), 'Different reason', req]), /different inputs/);
        const p = await prepare(), ctx = await context(), id = await capture(args(p, ctx)); assert.notEqual(id, saved);
        await auth(); const row = (await db.query<DeadlineRevision>('select * from tax_deadline_revisions where id=$1', [id])).rows[0];
        const catalog = deadlineCatalogFromPlan(owner, 2025, await source(), documents); verifyDeadlineSnapshot(row, owner, catalog);
        assert.equal(row.input.sources.obligations.length, 4); assert.equal(row.input.sources.unassigned_tax_obligations, 1);
        assert.ok(row.input.sources.obligations.some(o => o.id === 'a_B' && o.amount_pence === 0));
        assert.ok(row.input.sources.obligations.some(o => o.id === 'a-b' && o.amount_pence === null));
    });
    await serialSubtest(t, 'fresh source/notice forgery, missing exclusions and unsafe fields reject atomically', async () => {
        const p = await prepare(), ctx = await context();
        const forge = (change: (v: typeof p.input) => void) => { const f = structuredClone(p); change(f.input); f.inputJson = canonicalJson(f.input); return args(f, ctx); };
        await assert.rejects(capture(forge(i => { i.sources.obligations[0].amount_pence = 999; })), /commitment sources/);
        await assert.rejects(capture(forge(i => { i.sources.finance_plan!.user_id = other; })), /commitment sources/);
        await assert.rejects(capture(forge(i => { i.plan.entries.find(e => e.id === 'calendar:online')!.notice_document_id = foreign; i.sources.documents = [{ id: foreign, user_id: other, file_sha256: 'b'.repeat(64) }]; })), /Notice evidence/);
        await assert.rejects(capture(forge(i => { Object.assign(i.sources.documents[0], { object_path: 'PRIVATE' }); })), /Notice evidence/);
        await assert.rejects(capture(forge(i => { i.plan.entries.pop(); })), /every deadline/);
        await assert.rejects(capture(forge(i => { Object.assign(i.plan.entries[0], { raw: 'PRIVATE' }); })), /exact deadline choices/);
        await assert.rejects(capture(forge(i => { i.evaluated_on = '2000-01-01'; })), /owner\/date\/year/);
        const prior = await prepare(2026); await assert.rejects(capture(args(prior, ctx)), /sources changed/);
        assert.equal((await context()).ordinal, 2);
    });
    await serialSubtest(t, 'year-isolated history, immutable rules and late failure retain no partial capture', async () => {
        const c = await context(2026), p = await prepare(2026), id = await capture(args(p, c)); assert.ok(id); assert.equal((await context()).ordinal, 2); assert.equal((await context(2026)).ordinal, 1);
        const ctx = await context(), current = await prepare(), modified = structuredClone(current); modified.rulesJson = canonicalJson({ ...modified.rules, source_reviewed_at: '2000-01-01' });
        await assert.rejects(capture(args(modified, ctx)), /rules version changed/);
        await db.exec('reset role'); await db.exec("create function public.fail_deadline_capture() returns trigger language plpgsql as $$ begin raise exception 'Injected deadline failure';end;$$;create trigger test_deadline_failure after insert on tax_deadline_revisions for each row execute function fail_deadline_capture();");
        const a = args(current, ctx); await assert.rejects(capture(a), /Injected deadline failure/);
        await db.exec('reset role'); assert.equal((await db.query<{ n: number }>('select count(*)::int n from tax_deadline_revisions where request_id=$1', [a[8]])).rows[0].n, 0);
        assert.equal((await context()).ordinal, 2); assert.equal((await db.query<{ n: number }>('select count(*)::int n from financial_records')).rows[0].n, 0);
    });
    await serialSubtest(t, 'targeted documents leave current catalogs while exact historical captures remain available',async()=>{
        const before=await context();await auth();
        assert.equal((await db.query('select id from current_evidence_documents where id=$1',[doc])).rows.length,1);
        await db.exec('reset role');await db.query("insert into evidence_deletion_targets(user_id,request_id,bucket_id,object_path,file_hash) values($1,$2,'document-evidence',$3,$4)",[owner,randomUUID(),owner+'/synthetic.enc','a'.repeat(64)]);
        const after=await context();assert.notEqual(after.stamp,before.stamp);
        assert.equal((await db.query('select id from current_evidence_documents where id=$1',[doc])).rows.length,0);
        assert.equal((await db.query('select id from evidence_documents where id=$1',[doc])).rows.length,1);
        await assert.rejects(db.query('select * from retained_evidence_documents'),/permission denied/);
        await assert.rejects(capture(args(await prepare(),after)),/Notice evidence/);
        assert.equal(await capture(firstArgs),saved);
        await auth(other);assert.equal((await db.query('select id from current_evidence_documents where id=$1',[doc])).rows.length,0);
        await auth('');await assert.rejects(db.query('select * from current_evidence_documents'),/permission denied/);
    });

});

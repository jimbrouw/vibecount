import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema.ts';
import { serialSubtest } from './serial-subtest.ts';
import { merchantManifest } from '../records/merchant-export.ts';

test('annual merchant rollover preserves both years, safe ancestry and zero transaction effects', async t => {
    const db = new PGlite({ extensions: { pgcrypto } }); t.after(() => db.close()); await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL('../../supabase/migrations/', import.meta.url);
    for (const n of (await readdir(dir)).filter(n => n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(n, dir), 'utf8'));
    const owner = randomUUID(), other = randomUUID(); await db.query('insert into auth.users values ($1),($2)', [owner, other]);
    const bank = (await db.query<{ id: string }>("insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values ($1,'Synthetic rollover','generic','bank','1234') returning id", [owner])).rows[0].id;
    const category = (await db.query<{ id: string }>("select id from record_categories where is_default and user_id is null and record_type='expense' limit 1")).rows[0].id;
    async function auth(user: string = owner) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); await db.exec(user ? 'set role authenticated' : 'set role anon'); }
    async function stamp() { return (await db.query<{ s: string }>('select reconciliation_export_stamp() s')).rows[0].s; }
    async function ingest(description: string) {
        await db.exec('reset role'); const attempt = randomUUID(), hash = randomBytes(32).toString('hex'), path = 'synthetic/' + attempt;
        await db.query("insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values ($1,$2,$3,$4,$5,'synthetic',100,'uploaded')", [attempt, owner, bank, hash, path]);
        await db.query("insert into storage.objects(bucket_id,name) values ('source-evidence',$1)", [path]); await db.exec('set role service_role');
        const result = (await db.query<{ r: { import_id: string } }>("select ingest_source_csv($1,$2,'synthetic.csv','mapped-csv/1','{}',$3) r", [owner, attempt, JSON.stringify(['2025-07-01', '2026-07-01'].map((date, i) => ({ row_number: i + 2, row_hash: randomBytes(32).toString('hex'), raw_encrypted: 'PRIVATE_SYNTHETIC', date, signed_pence: -1250, currency: 'GBP', description, reference: 'Synthetic', fingerprint: randomBytes(32).toString('hex') })))] )).rows[0].r;
        await auth(); return (await db.query<{ id: string; transaction_date: string }>('select id,transaction_date from bank_transactions where import_id=$1 order by transaction_date', [result.import_id])).rows.map(r => r.id);
    }
    function definition(seed: string, year = 2025, extra: Record<string, unknown> = {}) { return { seed_id: seed, status: 'active', account_id: null, tax_year_start: year, effective_from: `${year}-04-06`, expires_on: `${year + 1}-04-05`, priority: 50, classification: 'Business', business_use_bps: 10000, category_id: category, evidence_status: 'provisional', ...extra }; }
    async function create(seed: string, extra: Record<string, unknown> = {}) { return (await db.query<{ r: { rule_id: string; version_id: string; ordinal: number } }>('select save_merchant_rule(null,0,$1,$2,$3,$4) r', [JSON.stringify(definition(seed, 2025, extra)), await stamp(), 'Synthetic prior rule', randomUUID()])).rows[0].r; }
    const rows = await ingest('Synthetic rollover software'), source = await create(rows[0]), request = randomUUID(), initialStamp = await stamp(), targetDefinition = definition(rows[0], 2026);
    const sql = 'select rollover_merchant_rule($1,$2,$3,$4,$5,$6) r';
    async function rollover(sourceId = source.version_id, d: Record<string, unknown> = targetDefinition, s = initialStamp, req = request, year = 2026) { return (await db.query<{ r: { rule_id: string; version_id: string; new_postings: number } }>(sql, [sourceId, year, JSON.stringify(d), s, 'Synthetic annual review', req])).rows[0].r; }
    let target: Awaited<ReturnType<typeof rollover>>;
    await serialSubtest(t, 'reviewed rollover creates a new family and preserves both year suggestions without postings', async () => {
        const before = (await db.query<{ n: number }>('select count(*)::int n from financial_records')).rows[0].n;
        target = await rollover(); assert.notEqual(target.rule_id, source.rule_id); assert.equal(target.new_postings, 0);
        const current = (await db.query<{ id: string; tax_year_start: number }>('select id,tax_year_start from current_merchant_rules order by tax_year_start')).rows;
        assert.deepEqual(current.map(r => r.tax_year_start), [2025, 2026]);
        const choices = (await db.query<{ tax_year_start: number; suggested_rule_version_id: string; classification: string }>('select tax_year_start,suggested_rule_version_id,classification from merchant_transaction_choices order by tax_year_start')).rows;
        assert.equal(choices[0].suggested_rule_version_id, source.version_id); assert.equal(choices[1].suggested_rule_version_id, target.version_id);
        assert.ok(choices.every(r => r.classification === 'Unknown')); assert.equal((await db.query<{ n: number }>('select count(*)::int n from financial_records')).rows[0].n, before);
        assert.equal((await db.query<{ n: number }>('select count(*)::int n from merchant_rule_rollovers')).rows[0].n, 1);
        await assert.rejects(db.query('select tax_financial_stamp_for_owner($1)', [owner]), /permission denied/);
    });
    await serialSubtest(t, 'exact retry survives later source changes and fresh duplicate requests cannot add a family', async () => {
        assert.equal((await rollover()).version_id, target.version_id);
        const before = await stamp();
        await db.query('select save_merchant_rule($1,1,$2,$3,$4,$5)', [source.rule_id, JSON.stringify(definition(rows[0], 2025, { status: 'disabled' })), before, 'Disable old source after review', randomUUID()]);
        assert.equal((await rollover()).version_id, target.version_id);
        await assert.rejects(rollover(source.version_id, targetDefinition, await stamp(), randomUUID()), /latest active/);
        await assert.rejects(rollover(source.version_id, { ...targetDefinition, priority: 51 }, initialStamp, request), /different rollover/);
        await assert.rejects(rollover(source.version_id, targetDefinition, initialStamp, randomUUID()), /review changed/);
    });
    await serialSubtest(t, 'owner RLS, immutable links and method request namespaces are enforced', async () => {
        await auth(other); assert.equal((await db.query('select * from merchant_rule_rollovers')).rows.length, 0);
        await assert.rejects(rollover(source.version_id, targetDefinition, await stamp(), randomUUID()), /latest active/);
        await auth(''); await assert.rejects(db.query(sql, [source.version_id, 2026, JSON.stringify(targetDefinition), initialStamp, 'Synthetic', randomUUID()]), /permission denied/);
        await auth(); await assert.rejects(db.query('delete from merchant_rule_rollovers'), /permission denied/);
        await assert.rejects(db.query('select save_merchant_rule(null,0,$1,$2,$3,$4)', [JSON.stringify(targetDefinition), await stamp(), 'Different method', request]), /Request ID/);
        await assert.rejects(db.query("insert into merchant_rule_rollovers select * from merchant_rule_rollovers"), /permission denied/);
        await db.exec('reset role'); await assert.rejects(db.query("update merchant_rule_rollovers set rationale='changed'"), /immutable/); await auth();
    });
    await serialSubtest(t, 'scope cannot widen accounts, jump years, use stale categories or escape target dates', async () => {
        const ids = await ingest('Synthetic scope case'), s = await create(ids[0], { account_id: bank });
        const d = definition(ids[0], 2026, { account_id: bank });
        await assert.rejects(rollover(s.version_id, { ...d, account_id: null }, await stamp(), randomUUID()), /retains source identity/);
        await assert.rejects(rollover(s.version_id, { ...d, effective_from: '2026-04-05' }, await stamp(), randomUUID()), /inside the target/);
        await assert.rejects(rollover(s.version_id, { ...d, expires_on: null }, await stamp(), randomUUID()), /explicit target-year/);
        await assert.rejects(rollover(s.version_id, { ...d, tax_year_start: 2027 }, await stamp(), randomUUID(), 2027), /immediately|latest active/);
        await assert.rejects(rollover(s.version_id, { ...d, raw_evidence: 'PRIVATE' }, await stamp(), randomUUID()), /exact rollover/);
        await assert.rejects(rollover(s.version_id, { ...d, evidence_status: 'linked' }, await stamp(), randomUUID()), /evidence state/);
        const owned = (await db.query<{ id: string }>("insert into record_categories(user_id,name,record_type) values ($1,'Synthetic category','expense') returning id", [owner])).rows[0].id;
        const stale = await create(ids[0], { category_id: owned }); await db.query("update record_categories set name='Changed meaning' where id=$1", [owned]);
        await assert.rejects(rollover(stale.version_id, { ...d, category_id: owned }, await stamp(), randomUUID()), /category/);
    });
    await serialSubtest(t, 'active overlapping target rules block a duplicate and disabled suggestions create no applications', async () => {
        const ids = await ingest('Synthetic overlap case'), s = await create(ids[0]);
        await create(ids[0], { tax_year_start: 2026, effective_from: '2026-04-06', expires_on: '2027-04-05' });
        await assert.rejects(rollover(s.version_id, definition(ids[0], 2026), await stamp(), randomUUID()), /overlaps/);
        const unique = await ingest('Synthetic disabled target case'), separate = await create(unique[0]);
        const disabled = await rollover(separate.version_id, definition(unique[0], 2026, { status: 'disabled' }), await stamp(), randomUUID());
        assert.notEqual(disabled.rule_id, separate.rule_id);
        assert.equal((await db.query<{ suggested_rule_version_id: string | null }>('select suggested_rule_version_id from merchant_transaction_choices where id=$1', [unique[1]])).rows[0].suggested_rule_version_id, null);
    });
    await serialSubtest(t, 'safe export records ancestry and injected failure rolls back inner rule, outer audit and both requests', async () => {
        const links = (await db.query<Record<string, unknown> & { id: string }>('select * from merchant_rule_rollovers')).rows;
        const manifest = merchantManifest({ rules: [], versions: [], batches: [], items: [], evidence: [], reversals: [], undo: [], rollovers: links });
        assert.equal(manifest.snapshot.rollovers.length, 2); assert.equal(manifest.schema_version, 'merchant-memory/2'); assert.ok(!JSON.stringify(manifest).includes('PRIVATE'));
        const ids = await ingest('Synthetic rollback case'), s = await create(ids[0]), before = (await db.query<{ n: number }>('select count(*)::int n from merchant_rules')).rows[0].n, requests = (await db.query<{ n: number }>('select count(*)::int n from merchant_requests')).rows[0].n;
        await db.exec('reset role'); await db.exec("create function public.fail_rollover() returns trigger language plpgsql as $$begin raise exception 'Injected rollover failure';end;$$;create trigger test_rollover_failure after insert on merchant_rule_rollovers for each row execute function fail_rollover();"); await auth();
        const req = randomUUID(); await assert.rejects(rollover(s.version_id, definition(ids[0], 2026), await stamp(), req), /Injected rollover/);
        assert.equal((await db.query<{ n: number }>('select count(*)::int n from merchant_rules')).rows[0].n, before); assert.equal((await db.query<{ n: number }>('select count(*)::int n from merchant_requests')).rows[0].n, requests);
        assert.equal((await db.query<{ n: number }>('select count(*)::int n from merchant_rule_rollovers where request_id=$1', [req])).rows[0].n, 0);
    });
});

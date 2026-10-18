import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { syntheticRefundSplit } from './refund-split-fixture';
import { refundReversalClosure, type RefundClosureCatalog } from '../records/refund-closure';
import { refundSplitReview, type SplitRefundChoice } from '../records/refund-splits';

test('read-only refund graph is owner-scoped, complete and compatible with current refund arithmetic', async t => {
    const db = new PGlite({ extensions: { pgcrypto } }); t.after(() => db.close()); await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL('../../supabase/migrations/', import.meta.url); for (const n of (await readdir(dir)).filter(n => n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(n, dir), 'utf8'));
    const owner = randomUUID(), other = randomUUID(); await db.query('insert into auth.users values($1),($2)', [owner, other]);
    const account = (await db.query<{ id: string }>("insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values($1,'Synthetic graph bank','generic','bank','1234') returning id", [owner])).rows[0].id;
    async function auth(who: string = owner) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who]); await db.exec(who ? 'set role authenticated' : 'set role anon'); }
    async function ingest(amounts: number[], date: string) {
        await db.exec('reset role'); const attempt = randomUUID(), hash = randomBytes(32).toString('hex'), path = `${owner}/${account}/${attempt}.enc`;
        await db.query("insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values($1,$2,$3,$4,$5,'synthetic',10,'uploaded')", [attempt, owner, account, hash, path]);
        await db.query("insert into storage.objects(bucket_id,name) values('source-evidence',$1)", [path]);
        const rows = amounts.map((a, i) => ({ row_number: i + 2, row_hash: randomBytes(32).toString('hex'), raw_encrypted: 'PRIVATE_CIPHERTEXT', date, signed_pence: a, currency: 'GBP', description: 'PRIVATE_NORMALIZED_DESCRIPTION', reference: 'PRIVATE_REFERENCE', fingerprint: randomBytes(32).toString('hex') }));
        const result = (await db.query<{ r: { import_id: string } }>("select ingest_source_csv($1,$2,'synthetic.csv','mapped-csv/1','{}',$3) r", [owner, attempt, JSON.stringify(rows)])).rows[0].r;
        const ids = (await db.query<{ id: string }>('select t.id from bank_transactions t join source_rows s on s.id=t.source_row_id where t.import_id=$1 order by s.row_number', [result.import_id])).rows.map(r => r.id); await auth(); return { import: result.import_id, ids };
    }
    const originals = await ingest([-63029, -50000], '2026-04-05'), separate = await ingest([10000, 30000, 20000], '2026-04-06'), combined = await ingest([50000], '2026-04-06');
    const category = (await db.query<{ id: string }>("select id from record_categories where record_type='expense' and is_default limit 1")).rows[0].id;
    await db.query("select review_bank_transaction($1,0,'Mixed',$2,3000,'Synthetic qualifying original')", [originals.ids[0], category]);
    await db.query("select review_bank_transaction($1,0,'Mixed',$2,4500,'Synthetic qualifying original')", [originals.ids[1], category]);
    const group = async (id: string) => (await db.query<{ s: string }>('select refund_group_stamp($1) s', [id])).rows[0].s;
    async function approve(original: string, refund: string) { return (await db.query<{ r: { refund_id: string; recognized_pence: number } }>("select approve_refund($1,1,$2,0,$3,'Synthetic exact refund oracle',$4) r", [original, refund, await group(original), randomUUID()])).rows[0].r; }
    let firstLink = '';
    await serialSubtest(t, 'existing SQL cumulative results independently match each reference split portion', async () => {
        firstLink = (await approve(originals.ids[0], separate.ids[0])).refund_id;
        const q = await db.query<{ s: SplitRefundChoice }>("select to_jsonb(c)||jsonb_build_object('source_row_id',t.source_row_id,'recognized_record_id',t.recognized_record_id,'project_id',f.project_id,'record_transaction_id',f.bank_transaction_id,'category_valid',true) s from refund_transaction_choices c join bank_transactions t on t.id=c.id and t.user_id=c.user_id left join financial_records f on f.id=t.recognized_record_id and f.user_id=t.user_id where c.user_id=$1", [owner]);
        const stamp = (await db.query<{ s: string }>('select reconciliation_export_stamp() s')).rows[0].s;
        const preview = refundSplitReview(owner, { schema_version: 'refund-split-intent/1', refund_id: combined.ids[0], refund_version: 0, expected_stamp: stamp,
            allocations: await Promise.all(originals.ids.map(async (id, i) => ({ original_id: id, original_version: 1, refund_stamp: await group(id), amount_pence: [30000, 20000][i] }))), rationale: 'Synthetic split reference, not a new approval', request_id: randomUUID() }, { owner_id: owner, stamp, transactions: q.rows.map(r => r.s) });
        const a = await approve(originals.ids[0], separate.ids[1]), b = await approve(originals.ids[1], separate.ids[2]);
        assert.deepEqual(preview.result.portions.map(p => p.recognized_pence).sort((a, b) => a - b), [Math.abs(a.recognized_pence), Math.abs(b.recognized_pence)].sort((a, b) => a - b));
        assert.equal(preview.result.recognized_reduction_pence, 18000);
        assert.equal((await db.query<{ v: number }>('select decision_version v from bank_transactions where id=$1', [combined.ids[0]])).rows[0].v, 0); // The combined source is still Unknown.
    });
    await serialSubtest(t, 'original and import roots return complete stable metadata without leaking raw evidence or performing a write', async () => {
        const before = (await db.query<{ n: number }>('select count(*)::int n from financial_records')).rows[0].n;
        const graph = (await db.query<{ g: RefundClosureCatalog }>("select read_refund_reversal_graph('original',$1) g", [originals.ids[0]])).rows[0].g;
        const closure = refundReversalClosure(owner, { kind: 'original', id: originals.ids[0] }, graph);
        assert.equal(closure.link_ids.length, 2); assert.equal(closure.observed_refund_cash_pence, 40000); assert.equal(closure.expense_reduction_removed_pence, 12000);
        assert.ok(!JSON.stringify(graph).includes('PRIVATE')); assert.ok(!JSON.stringify(graph).includes('object_path')); assert.ok(!JSON.stringify(graph).includes('raw_encrypted'));
        const importGraph = (await db.query<{ g: RefundClosureCatalog }>("select read_refund_reversal_graph('import',$1) g", [originals.import])).rows[0].g;
        const all = refundReversalClosure(owner, { kind: 'import', id: originals.import }, importGraph); assert.equal(all.link_ids.length, 3); assert.equal(all.observed_refund_cash_pence, 60000); assert.equal(all.expense_reduction_removed_pence, 21000);
        assert.equal((await db.query<{ n: number }>('select count(*)::int n from financial_records')).rows[0].n, before);
        assert.equal((await db.query<{ n: number }>('select count(*)::int n from refund_reversals')).rows[0].n, 0);
    });
    await serialSubtest(t, 'foreign, anonymous and service callers cannot acquire another owner graph', async () => {
        await auth(other); await assert.rejects(db.query("select read_refund_reversal_graph('original',$1)", [originals.ids[0]]), /Owned refund source unavailable/);
        await auth(''); await assert.rejects(db.query("select read_refund_reversal_graph('original',$1)", [originals.ids[0]]), /permission denied/);
        await db.exec('reset role;set role service_role'); await assert.rejects(db.query("select read_refund_reversal_graph('original',$1)", [originals.ids[0]]), /permission denied/);
        await auth(); await assert.rejects(db.query("select read_refund_reversal_graph('untrusted',$1)", [originals.ids[0]]), /owned refund source/);
    });
    await serialSubtest(t, 'real split approvals prove shared and transitive SQL traversal', async () => {
        // Real approvals are confined to a disposable transaction and rolled back.
        const originals = await ingest([-1000, -1000, -1000], '2026-04-08'), refunds = await ingest([600, 400, 100], '2026-04-09');
        for (const [i,bps] of [5000,10000,3000].entries()) await db.query('select review_bank_transaction($1,0,$2,$3,$4,$5)', [originals.ids[i], bps===10000?'Business':'Mixed', category, bps, 'Synthetic future-schema original']);
        await db.exec('reset role;begin');
        try {
            await auth();
            await syntheticRefundSplit(db,refunds.ids[0],[[originals.ids[0],300],[originals.ids[1],300]]);
            await syntheticRefundSplit(db,refunds.ids[1],[[originals.ids[1],100],[originals.ids[2],300]]);
            await syntheticRefundSplit(db,refunds.ids[2],[[originals.ids[2],100]]);
            await auth();const graph=(await db.query<{g:RefundClosureCatalog}>("select read_refund_reversal_graph('original',$1) g",[originals.ids[0]])).rows[0].g;
            const closure=refundReversalClosure(owner,{kind:'original',id:originals.ids[0]},graph);
            assert.equal(closure.link_ids.length,5);assert.equal(closure.original_ids.length,3);assert.equal(closure.refund_ids.length,3);assert.equal(closure.observed_refund_cash_pence,1100);assert.equal(closure.expense_reduction_removed_pence,670);
            assert.ok(!JSON.stringify(graph).includes('PRIVATE'));
        } finally {await db.exec('rollback;reset role');await auth();}
        assert.equal((await db.query<{n:number}>("select count(*)::int n from pg_indexes where tablename='financial_records' and indexname='financial_records_ordinary_bank_unique' and indexdef like '%WHERE (refund_link_id IS NULL)%'")).rows[0].n,1);
        assert.equal((await db.query<{n:number}>('select count(*)::int n from refund_links where refund_transaction_id=any($1::uuid[])',[refunds.ids])).rows[0].n,0);
    });
    await serialSubtest(t, 'existing reversal removes active edges and changes the graph stamp without restoring source approvals', async () => {
        const before = (await db.query<{ g: RefundClosureCatalog }>("select read_refund_reversal_graph('original',$1) g", [originals.ids[0]])).rows[0].g;
        await db.query("select reverse_refund_group($1,$2,'Synthetic reversal check',$3)", [originals.ids[0], await group(originals.ids[0]), randomUUID()]);
        const after = (await db.query<{ g: RefundClosureCatalog }>("select read_refund_reversal_graph('original',$1) g", [originals.ids[0]])).rows[0].g;
        assert.notEqual(after.stamp, before.stamp); assert.equal(after.links.length, 0); assert.equal(refundReversalClosure(owner, { kind: 'original', id: originals.ids[0] }, after).observed_refund_cash_pence, 0);
        assert.equal((await db.query<{ c: string }>('select classification c from bank_transactions where id=$1', [separate.ids[0]])).rows[0].c, 'Unknown');
        assert.equal((await db.query<{ n: number }>('select count(*)::int n from refund_reversals where refund_id=$1', [firstLink])).rows[0].n, 1);
    });
});

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

test('reviewed refund closure reverses complete owned effects atomically and retains exact retry history', async t => {
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
    const category=(await db.query<{id:string}>("select id from record_categories where is_default and record_type='expense' limit 1")).rows[0].id;
    const graph=async(kind:string,id:string)=>(await db.query<{g:RefundClosureCatalog}>('select read_refund_reversal_graph($1,$2) g',[kind,id])).rows[0].g;
    const reverse=async(kind:string,id:string,stamp:string,request=randomUUID(),reason='Synthetic complete reversal')=>(await db.query<{r:{link_ids:string[];original_ids:string[];refund_ids:string[];reversed_count:number;refund_observation_count:number;observed_refund_cash_pence:number;expense_reduction_removed_pence:number;restored_prior_classifications:number}}>('select reverse_refund_closure($1,$2,$3,$4,$5) r',[kind,id,stamp,reason,request])).rows[0].r;
    async function ordinary() {
        const o=await ingest([-63029,-2],'2026-04-05'),r=await ingest([10000,53029,1,1],'2026-04-06');
        await db.query("select review_bank_transaction($1,0,'Mixed',$2,3000,'Synthetic reviewed source')",[o.ids[0],category]);
        await db.query("select review_bank_transaction($1,0,'Mixed',$2,5000,'Synthetic reviewed pennies')",[o.ids[1],category]);
        for(const [oi,ri] of [[0,0],[0,1],[1,2],[1,3]]){
            const stamp=(await db.query<{s:string}>('select refund_group_stamp($1) s',[o.ids[oi]])).rows[0].s;
            await db.query("select approve_refund($1,1,$2,0,$3,'Synthetic existing approval',$4)",[o.ids[oi],r.ids[ri],stamp,randomUUID()]);
        }
        return {o,r};
    }
    await serialSubtest(t,'foreign, anonymous, service and invalid scopes cannot reverse an owned graph',async()=>{
        const {o}=await ordinary(),g=await graph('original',o.ids[0]);
        await auth(other);await assert.rejects(reverse('original',o.ids[0],g.stamp),/Owned refund source unavailable/);
        await auth('');await assert.rejects(reverse('original',o.ids[0],g.stamp),/permission denied/);
        await db.exec('reset role;set role service_role');await assert.rejects(reverse('original',o.ids[0],g.stamp),/permission denied/);
        await auth();await assert.rejects(reverse('untrusted',o.ids[0],g.stamp),/complete refund reversal/);
        assert.equal((await graph('original',o.ids[0])).links.length,2);
    });
    await serialSubtest(t,'import scope includes disconnected families and zero-posting cash once, exact retries precede changed sources',async()=>{
        const {o,r}=await ordinary(),g=await graph('import',o.import),readback=refundReversalClosure(owner,{kind:'import',id:o.import},g),request=randomUUID();
        const versions=(await db.query('select id,decision_version from bank_transactions where import_id=$1 order by id',[o.import])).rows;
        await assert.rejects(reverse('import',o.import,'0'.repeat(32)),/context changed/);
        const result=await reverse('import',o.import,g.stamp,request);
        assert.equal(result.reversed_count,4);assert.equal(result.refund_observation_count,4);assert.equal(result.observed_refund_cash_pence,63031);
        assert.equal(result.expense_reduction_removed_pence,18910);assert.equal(result.restored_prior_classifications,0);
        assert.deepEqual(result.link_ids,readback.link_ids);assert.deepEqual(result.refund_ids,readback.refund_ids);
        assert.equal((await graph('import',o.import)).links.length,0);
        assert.deepEqual((await db.query('select id,decision_version from bank_transactions where import_id=$1 order by id',[o.import])).rows,versions);
        assert.deepEqual((await db.query<{classification:string;decision_version:number}>('select classification,decision_version from bank_transactions where id=any($1::uuid[])',[r.ids])).rows,Array.from({length:4},()=>({classification:'Unknown',decision_version:2})));
        assert.equal((await db.query<{n:number}>("select count(*)::int n from financial_records where bank_transaction_id=any($1::uuid[]) and status='approved'",[r.ids])).rows[0].n,0);
        assert.equal((await db.query<{status:string}>('select status from record_imports where id=$1',[o.import])).rows[0].status,'review');
        assert.deepEqual(await reverse('import',o.import,g.stamp,request),result);
        await assert.rejects(reverse('import',o.import,g.stamp,request,'Changed review reason'),/request changed/);
        await assert.rejects(reverse('import',o.import,g.stamp),/context changed/);
        const fresh=await graph('import',o.import);await assert.rejects(reverse('import',o.import,fresh.stamp),/No active refund/);
    });
    await serialSubtest(t,'malformed same-owner pointers and missing approved child effects cannot alter an original',async()=>{
        const {o,r}=await ordinary();
        const original=(await db.query<{recognized_record_id:string}>('select recognized_record_id from bank_transactions where id=$1',[o.ids[0]])).rows[0].recognized_record_id;
        const child=(await db.query<{id:string}>("select id from financial_records where bank_transaction_id=$1 and effect_sign=-1 and status='approved'",[r.ids[0]])).rows[0].id;
        const originalBefore=(await db.query('select * from financial_records where id=$1',[original])).rows;
        await db.exec('reset role');await db.query('update bank_transactions set recognized_record_id=$1 where id=$2',[original,r.ids[0]]);await auth();
        let g=await graph('original',o.ids[0]);await assert.rejects(reverse('original',o.ids[0],g.stamp),/posting provenance/);
        assert.deepEqual((await db.query('select * from financial_records where id=$1',[original])).rows,originalBefore);
        const zero=(await db.query<{id:string}>('select id from active_refunds where user_id=$1 and refund_transaction_id=$2 and recognized_pence=0',[owner,r.ids[3]])).rows[0].id;
        await db.exec('reset role');await db.query("insert into financial_records(user_id,record_type,record_date,description,amount,category_id,import_id,source_type,status,approved_at,bank_transaction_id,effect_sign,refund_link_id) values($1,'expense','2026-04-06','Synthetic malformed zero child',0.01,$2,$3,'csv','approved',now(),$4,-1,$5)",[owner,category,r.import,r.ids[3],zero]);await auth();
        g=await graph('original',o.ids[1]);await assert.rejects(reverse('original',o.ids[1],g.stamp),/unreviewed extra accounting effect/);
        await db.exec('reset role');await db.query('update bank_transactions set recognized_record_id=$1 where id=$2',[child,r.ids[0]]);
        await db.query("update financial_records set status='excluded',approved_at=null where id=$1",[child]);await auth();
        g=await graph('original',o.ids[0]);await assert.rejects(reverse('original',o.ids[0],g.stamp),/Complete approved refund effects/);
        assert.equal((await graph('original',o.ids[0])).links.length,2);
        assert.deepEqual((await db.query('select * from financial_records where id=$1',[original])).rows,originalBefore);
    });
    await serialSubtest(t,'a late request-history failure rolls back every reversal, exclusion and Unknown decision',async()=>{
        const {o,r}=await ordinary(),g=await graph('original',o.ids[0]);
        await db.exec("reset role;create function public.synthetic_reversal_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic late failure';end;$$;create trigger synthetic_reversal_failure before insert on public.refund_requests for each row execute function public.synthetic_reversal_failure();");
        try {await auth();await assert.rejects(reverse('original',o.ids[0],g.stamp),/Synthetic late failure/);assert.deepEqual(await graph('original',o.ids[0]),g);
            assert.deepEqual((await db.query<{classification:string;decision_version:number}>('select classification,decision_version from bank_transactions where id=any($1::uuid[])',[r.ids])).rows,Array.from({length:4},()=>({classification:'Refund',decision_version:1})));
        }finally{await db.exec('reset role;drop trigger synthetic_reversal_failure on public.refund_requests;drop function public.synthetic_reversal_failure();');await auth();}
    });
    await serialSubtest(t,'real shared cash approvals traverse and reverse all five links, every child effect and three observations once',async()=>{
        const o=await ingest([-1000,-1000,-1000],'2026-04-08'),r=await ingest([600,400,100],'2026-04-09');
        for(const [i,bps] of [5000,10000,3000].entries()) await db.query('select review_bank_transaction($1,0,$2,$3,$4,$5)',[o.ids[i],bps===10000?'Business':'Mixed',category,bps,'Synthetic forward original']);
        await db.exec('reset role;begin');
        try{
            // Exercise the shipping writer, projections and closure together.
            await auth();
            await syntheticRefundSplit(db,r.ids[0],[[o.ids[0],300],[o.ids[1],300]]);
            await syntheticRefundSplit(db,r.ids[1],[[o.ids[1],100],[o.ids[2],300]]);
            await syntheticRefundSplit(db,r.ids[2],[[o.ids[2],100]]);
            await auth();const g=await graph('original',o.ids[0]),readback=refundReversalClosure(owner,{kind:'original',id:o.ids[0]},g);
            await db.exec('savepoint legacy_guard');
            await assert.rejects(db.query("select reverse_refund_group($1,refund_group_stamp($1),'Unseen sibling scope',$2)",[o.ids[0],randomUUID()]),/complete connected refund reversal/);
            await db.exec('rollback to savepoint legacy_guard');
            const result=await reverse('original',o.ids[0],g.stamp);
            assert.deepEqual(result.link_ids,readback.link_ids);assert.equal(result.reversed_count,5);assert.equal(result.refund_observation_count,3);
            assert.equal(result.observed_refund_cash_pence,1100);assert.equal(result.expense_reduction_removed_pence,670);
            assert.equal((await db.query<{n:number}>("select count(*)::int n from financial_records where bank_transaction_id=any($1::uuid[]) and effect_sign=-1 and status='excluded'",[r.ids])).rows[0].n,5);
            assert.deepEqual((await db.query<{classification:string;decision_version:number}>('select classification,decision_version from bank_transactions where id=any($1::uuid[])',[r.ids])).rows,Array.from({length:3},()=>({classification:'Unknown',decision_version:2})));
            assert.deepEqual((await db.query<{decision_version:number}>('select decision_version from bank_transactions where id=any($1::uuid[])',[o.ids])).rows,Array.from({length:3},()=>({decision_version:1})));
        }finally{await db.exec('rollback;reset role');await auth();}
        assert.equal((await db.query<{n:number}>("select count(*)::int n from pg_indexes where tablename='financial_records' and indexname='financial_records_ordinary_bank_unique' and indexdef like '%WHERE (refund_link_id IS NULL)%'")).rows[0].n,1);
    });
});

/** Disposable synthetic database demo. No network, credentials or real financial action. */
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
import { syntheticRefundSplit } from '../lib/database/refund-split-fixture';
import { refundReversalClosure, type RefundClosureCatalog } from '../lib/records/refund-closure';

async function main(){
    const db = new PGlite({ extensions: { pgcrypto } }); await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL('../supabase/migrations/', import.meta.url); for (const n of (await readdir(dir)).filter(n => n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(n, dir), 'utf8'));
    const owner = randomUUID(), other = randomUUID(); await db.query('insert into auth.users values($1),($2)', [owner, other]);
    const account = (await db.query<{ id: string }>("insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values($1,'Synthetic graph bank','generic','bank','1234') returning id", [owner])).rows[0].id;
    async function auth(who: string = owner) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who]); await db.exec(who ? 'set role authenticated' : 'set role anon'); }
    async function ingest(amounts: number[], date: string) {
        await db.exec('reset role'); const attempt = randomUUID(), hash = randomBytes(32).toString('hex'), path = `${owner}/${account}/${attempt}.enc`;
        await db.query("insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values($1,$2,$3,$4,$5,'synthetic',10,'uploaded')", [attempt, owner, account, hash, path]);
        await db.query("insert into storage.objects(bucket_id,name) values('source-evidence',$1)", [path]);
        const rows = amounts.map((a, i) => ({ row_number: i + 2, row_hash: randomBytes(32).toString('hex'), raw_encrypted: 'SYNTHETIC_CIPHERTEXT_PLACEHOLDER', date, signed_pence: a, currency: 'GBP', description: 'Synthetic cash observation', reference: '', fingerprint: randomBytes(32).toString('hex') }));
        const result = (await db.query<{ r: { import_id: string } }>("select ingest_source_csv($1,$2,'synthetic.csv','mapped-csv/1','{}',$3) r", [owner, attempt, JSON.stringify(rows)])).rows[0].r;
        const ids = (await db.query<{ id: string }>('select t.id from bank_transactions t join source_rows s on s.id=t.source_row_id where t.import_id=$1 order by s.row_number', [result.import_id])).rows.map(r => r.id); await auth(); return { import: result.import_id, ids };
    }
    try{
        const originals=await ingest([-63029,-50000],'2026-04-05'),refund=await ingest([50000],'2026-04-06');
        const category=(await db.query<{id:string}>("select id from record_categories where is_default and record_type='expense' limit 1")).rows[0].id;
        for(const [i,bps]of [3000,4500].entries())await db.query("select review_bank_transaction($1,0,'Mixed',$2,$3,'Synthetic qualifying candidate only')",[originals.ids[i],category,bps]);
        const before=(await db.query('select id,source_row_id,transaction_date,signed_amount_pence from bank_transactions where import_id=$1 order by id',[originals.import])).rows;
        const approval=await syntheticRefundSplit(db,refund.ids[0],[[originals.ids[0],30000],[originals.ids[1],20000]]);
        assert.equal(approval.result.observed_cash_pence,50000);assert.equal(approval.result.recognized_reduction_pence,18000);
        const effects=(await db.query('select id,bank_transaction_id,record_type,record_date,amount,effect_sign,refund_link_id,status from financial_records order by id')).rows;
        const observed=(await db.query<{recognized_pence:number|string}>('select bank_transaction_id,record_count,recognized_pence,income_pence,expense_pence from bank_transaction_record_effects where bank_transaction_id=$1',[refund.ids[0]])).rows;
        assert.equal(observed.length,1);assert.equal(Number(observed[0].recognized_pence),-18000);
        const graph=(await db.query<{g:RefundClosureCatalog}>("select read_refund_reversal_graph('refund',$1) g",[refund.ids[0]])).rows[0].g;
        const review=refundReversalClosure(owner,{kind:'refund',id:refund.ids[0]},graph);
        const reversal=(await db.query<{r:{reversed_count:number}}>("select reverse_refund_closure('refund',$1,$2,'Reviewed synthetic correction only',$3) r",[refund.ids[0],graph.stamp,randomUUID()])).rows[0].r;
        assert.equal(reversal.reversed_count,2);
        assert.deepEqual((await db.query('select id,source_row_id,transaction_date,signed_amount_pence from bank_transactions where import_id=$1 order by id',[originals.import])).rows,before);
        assert.equal((await db.query<{n:number}>("select count(*)::int n from financial_records where bank_transaction_id=$1 and status='approved'",[refund.ids[0]])).rows[0].n,0);
        const out='/tmp/vibecount-refund-split-write-demo';await mkdir(out,{recursive:true});
        await writeFile(out+'/synthetic-approval-and-reversal.json',JSON.stringify({synthetic_only:true,approval,observations:observed,effects_before_reversal:effects,review,reversal},null,2)+'\n');
        await writeFile(out+'/README.md','# Synthetic split approval and reversal\n\nExecuted the actual ordered migrations and authenticated approval/reversal RPCs in disposable in-memory PostgreSQL. £500 cash is allocated £300/£200 to two originals at 30%/45%, producing £90/£90 candidate expense reductions. One observation retains both effects. Reversal excludes both and preserves original observations.\n\nAll IDs, descriptions, hashes, source objects and evidence ciphertext are synthetic placeholders. No original financial evidence, hosted account, network access, production approval, payment or filing is involved. This demonstrates database behavior; the human split form and hosted acceptance remain unfinished.\n');
        console.log('Verified actual synthetic split approval and reversal:',out);
    }finally{await db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

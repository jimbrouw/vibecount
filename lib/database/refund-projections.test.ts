import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { syntheticRefundSplit } from './refund-split-fixture';

test('observation accounting projections retain complete shared effects without multiplying source cash', async t => {
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
    const originals: Awaited<ReturnType<typeof ingest>>[]=[];for(let i=0;i<3;i++)originals.push(await ingest([-1000],'2025-08-01'));
    const refunds=await ingest([600,400,100],'2025-08-02'),categories:string[]=[];
    await db.exec('reset role');for(let i=0;i<3;i++)categories.push((await db.query<{id:string}>("insert into record_categories(user_id,name,record_type) values($1,$2,'expense') returning id",[owner,'Synthetic projection category '+i])).rows[0].id);
    await auth();for(const [i,bps]of [5000,10000,3000].entries())await db.query('select review_bank_transaction($1,0,$2,$3,$4,$5)',[originals[i].ids[0],bps===10000?'Business':'Mixed',categories[i],bps,'Synthetic projection original']);
    await serialSubtest(t,'aggregate view has owner RLS and private owner/capture helpers retain their existing grants',async()=>{
        assert.equal((await db.query('select * from bank_transaction_record_effects')).rows.length,3);
        await auth(other);assert.equal((await db.query('select * from bank_transaction_record_effects')).rows.length,0);
        await auth('');await assert.rejects(db.query('select * from bank_transaction_record_effects'),/permission denied/);await auth();
        const privileges=(await db.query<{p:boolean}>('select has_function_privilege($1,$2,$3) p',['authenticated','public.tax_calculation_input_for_owner(uuid,integer)','EXECUTE'])).rows[0].p;assert.equal(privileges,false);
        assert.equal((await db.query<{p:boolean}>('select has_function_privilege($1,$2,$3) p',['authenticated','public.capture_filing_pack(uuid,uuid,text,text,text,uuid)','EXECUTE'])).rows[0].p,false);
    });
    await db.exec('reset role;begin');
    try{
        // Disposable integration fixture using the authenticated shipping writer.
        await auth();
        const one=await syntheticRefundSplit(db,refunds.ids[0],[[originals[0].ids[0],300],[originals[1].ids[0],300]]);
        const two=await syntheticRefundSplit(db,refunds.ids[1],[[originals[1].ids[0],100],[originals[2].ids[0],300]]);
        const three=await syntheticRefundSplit(db,refunds.ids[2],[[originals[2].ids[0],100]]);
        const links=[one,two,three].flatMap(r=>r.result.portions.map(p=>p.refund_link_id));
        // Retained excluded ordinary interpretation contributes zero to every projection.
        await db.exec('reset role');
        await db.query("insert into financial_records(user_id,record_type,record_date,description,amount,import_id,source_type,status,bank_transaction_id) values($1,'income','2025-08-02','Synthetic retained excluded interpretation',6,$2,'csv','excluded',$3)",[owner,refunds.import,refunds.ids[0]]);
        await auth();
        await serialSubtest(t,'all current choices and import summaries use all children and retain one row per observation',async()=>{
            for(const name of ['transfer_transaction_choices','refund_transaction_choices','duplicate_review_transactions','receipt_allocation_balances']){
                const rows=(await db.query<{id:string;recognized_pence:number|string;record_status:string}>(`select id,recognized_pence,record_status from public.${name} where user_id=$1 and id=any($2::uuid[]) order by id`,[owner,refunds.ids])).rows;
                assert.equal(rows.length,3,name);assert.equal(rows.reduce((s,r)=>s+Number(r.recognized_pence),0),-670,name);assert.ok(rows.every(r=>r.record_status==='approved'));
            }
            const r=(await db.query<{n:number|string;category_id:string|null;record_count:number;approved_record_count:number}>('select recognized_pence n,category_id,record_count,approved_record_count from bank_transaction_record_effects where user_id=$1 and bank_transaction_id=$2',[owner,refunds.ids[0]])).rows[0];
            assert.equal(Number(r.n),-450);assert.equal(r.category_id,null);assert.equal(r.record_count,3);assert.equal(r.approved_record_count,2);
            const summary=(await db.query<{s:{transactions:number;expense_pence:number;refund_count:number;refund_pence:number}}>('select source_import_summary($1) s',[refunds.import])).rows[0].s;
            assert.equal(summary.transactions,3);assert.equal(summary.expense_pence,-670);assert.equal(summary.refund_count,5);assert.equal(summary.refund_pence,1100);
            const transitive=(await db.query<{s:{transactions:number;expense_pence:number;refund_count:number;refund_pence:number}}>('select source_import_summary($1) s',[originals[0].import])).rows[0].s;
            assert.equal(transitive.transactions,1);assert.equal(transitive.expense_pence,500);assert.equal(transitive.refund_count,5);assert.equal(transitive.refund_pence,1100);
        });
        await serialSubtest(t,'tax input retains every posting, aggregate observation total and individual refund link identity',async()=>{
            const input=(await db.query<{i:{records:{id:string;amount_pence:number;effect_sign:number;status:string;refund_link_id:string|null}[];observations:{id:string;recognized_pence:number}[]}}>('select read_tax_calculation_input(2025) i')).rows[0].i;
            assert.equal(input.observations.filter(o=>refunds.ids.includes(o.id)).length,3);assert.equal(input.observations.filter(o=>refunds.ids.includes(o.id)).reduce((s,o)=>s+o.recognized_pence,0),-670);
            assert.deepEqual(input.records.filter(r=>r.refund_link_id).map(r=>r.refund_link_id).sort(),[...links].sort());
            assert.equal(input.records.filter(r=>r.status==='approved').reduce((s,r)=>s+r.amount_pence*r.effect_sign,0),1130);
        });
        await serialSubtest(t,'explicit-owner filing reader uses aggregate observations without granting a filing-ready state',async()=>{
            await db.exec('reset role');
            // Incomplete calculation metadata selects the year only; this fixture asserts no tax calculation/capture approval.
            await db.exec("insert into tax_rulesets(id,engine_version,tax_year_start,rules,canonical_json,sha256) values('synthetic-projection-only','synthetic-only',2025,'{}','{}',encode(sha256(convert_to('{}','UTF8')),'hex'))");
            const calc=randomUUID(),input=JSON.stringify({sources:[],financial_stamp:'synthetic-only'}),result=JSON.stringify({status:'incomplete',document_status:'Draft — not submitted to HMRC'});
            await db.query("insert into tax_calculations(id,user_id,tax_year_start,ruleset_id,engine_version,input,result,input_canonical_json,result_canonical_json,input_sha256,result_sha256,rationale,author,request_id) values($1,$2,2025,'synthetic-projection-only','synthetic-only',$3::text::jsonb,$4::text::jsonb,$3::text,$4::text,encode(sha256(convert_to($3,'UTF8')),'hex'),encode(sha256(convert_to($4,'UTF8')),'hex'),'Synthetic incomplete metadata',$2,$5)",[calc,owner,input,result,randomUUID()]);
            await auth();const filing=(await db.query<{f:{calculation_is_current:boolean;observations:{id:string;recognized_pence:number}[]}}>('select read_tax_filing_pack_input($1) f',[calc])).rows[0].f;
            assert.equal(filing.calculation_is_current,false);assert.equal(filing.observations.filter(o=>refunds.ids.includes(o.id)).length,3);assert.equal(filing.observations.filter(o=>refunds.ids.includes(o.id)).reduce((s,o)=>s+o.recognized_pence,0),-670);
            await db.exec('savepoint foreign_scope');await auth(other);await assert.rejects(db.query('select read_tax_filing_pack_input($1)',[calc]),/owned saved calculation/);await db.exec('rollback to savepoint foreign_scope');await auth();
        });
    }finally{await db.exec('rollback;reset role');await auth();}
    assert.equal((await db.query<{n:number}>("select count(*)::int n from pg_indexes where tablename='financial_records' and indexname='financial_records_ordinary_bank_unique' and indexdef like '%WHERE (refund_link_id IS NULL)%'")).rows[0].n,1);
});

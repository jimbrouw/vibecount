import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { syntheticRefundSplit } from './refund-split-fixture';
import { refundSplitCatalog } from '../records/refund-split-store';
import { refundSplitReview } from '../records/refund-splits';

test('reviewed split writer preserves cash, source history and exact request recovery', async t => {
    const db = new PGlite({ extensions: { pgcrypto } }); t.after(() => db.close()); await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL('../../supabase/migrations/', import.meta.url); for (const n of (await readdir(dir)).filter(n => n.endsWith('.sql') && n < '20261018080000_reviewed_refund_splits.sql').sort()) await db.exec(await readFile(new URL(n, dir), 'utf8'));
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
    const expense=(await db.query<{id:string}>("select id from record_categories where is_default and record_type='expense' limit 1")).rows[0].id;
    const income=(await db.query<{id:string}>("select id from record_categories where is_default and record_type='income' limit 1")).rows[0].id;
    const stamp=async()=>(await db.query<{s:string}>('select reconciliation_export_stamp() s')).rows[0].s;
    const approve=async(intent:unknown)=>(await db.query<{r:Record<string,unknown>}>('select approve_refund_split($1) r',[JSON.stringify(intent)])).rows[0].r;
    async function intentFor(refund:string,portions:[string,number][]){return {schema_version:'refund-split-intent/1',refund_id:refund,refund_version:(await db.query<{v:number}>('select decision_version v from bank_transactions where id=$1',[refund])).rows[0].v,expected_stamp:await stamp(),allocations:await Promise.all(portions.map(async([original_id,amount_pence])=>({original_id,amount_pence,original_version:(await db.query<{v:number}>('select decision_version v from bank_transactions where id=$1',[original_id])).rows[0].v,refund_stamp:(await db.query<{s:string}>('select refund_group_stamp($1) s',[original_id])).rows[0].s}))),rationale:'Reviewed synthetic split evidence',request_id:randomUUID()};}
    // Seed an actual predecessor approval before replaying the forward migration.
    const legacyO=await ingest([-1000],'2026-04-05'),legacyR=await ingest([1000],'2026-04-06');
    await db.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic predecessor original')",[legacyO.ids[0],expense]);
    const legacyStamp=(await db.query<{s:string}>('select refund_group_stamp($1) s',[legacyO.ids[0]])).rows[0].s,legacyRequest=randomUUID();
    const legacyArgs=[legacyO.ids[0],1,legacyR.ids[0],0,legacyStamp,'Retained predecessor approval',legacyRequest];
    const legacySql='select approve_refund($1,$2,$3,$4,$5,$6,$7) r';
    const legacyResult=(await db.query<{r:unknown}>(legacySql,legacyArgs)).rows[0].r;
    const predecessorRecords=(await db.query('select * from financial_records where bank_transaction_id=$1',[legacyR.ids[0]])).rows;
    await db.exec('reset role');for(const n of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n>='20261018080000_reviewed_refund_splits.sql').sort())await db.exec(await readFile(new URL(n,dir),'utf8'));await auth();
    await serialSubtest(t,'upgrade preserves actual predecessor bytes and legacy request recovery after reversal',async()=>{
        assert.deepEqual((await db.query('select * from financial_records where bank_transaction_id=$1',[legacyR.ids[0]])).rows,predecessorRecords);
        assert.deepEqual((await db.query<{r:unknown}>(legacySql,legacyArgs)).rows[0].r,legacyResult);
        await db.query("select reverse_refund_closure('original',$1,$2,'Reviewed predecessor reversal',$3)",[legacyO.ids[0],await stamp(),randomUUID()]);
        assert.deepEqual((await db.query<{r:unknown}>(legacySql,legacyArgs)).rows[0].r,legacyResult);
        const changed=[...legacyArgs];changed[5]='Changed predecessor reason';await assert.rejects(db.query(legacySql,changed),/request changed/);
        const cross=await intentFor(legacyR.ids[0],[[legacyO.ids[0],1000]]);cross.request_id=legacyRequest;await assert.rejects(approve(cross),/request changed/);
    });
    await serialSubtest(t,'private helper and public approval enforce caller permissions',async()=>{
        for(const role of ['anon','service_role','authenticated'])assert.equal((await db.query<{p:boolean}>('select has_function_privilege($1,$2,$3) p',[role,'public.write_reviewed_refund_split(uuid,integer,jsonb,text,text,uuid)','EXECUTE'])).rows[0].p,false);
        await auth('');await assert.rejects(approve({}),/permission denied/);await db.exec('reset role;set role service_role');await assert.rejects(approve({}),/permission denied/);await auth();
    });
    await serialSubtest(t,'atomic catalog is private, owner-scoped, safe and matches the actual approval arithmetic',async()=>{
        const o=await ingest([-63029,-50000],'2026-04-05'),r=await ingest([50000],'2026-04-06');for(const [i,bps]of [3000,4500].entries())await db.query("select review_bank_transaction($1,0,'Mixed',$2,$3,'Synthetic catalog originals')",[o.ids[i],expense,bps]);
        const draft=await ingest([-1000],'2026-04-05');await db.exec('reset role');
        await db.query("insert into financial_records(user_id,record_type,record_date,description,amount,category_id,import_id,source_type,status,bank_transaction_id) values($1,'expense','2026-04-05','Synthetic unrelated draft',10,$2,$3,'csv','draft',$4)",[owner,expense,draft.import,draft.ids[0]]);await auth();
        const raw=(await db.query<{c:unknown}>('select read_refund_split_catalog($1) c',[r.ids[0]])).rows[0].c;
        assert.ok(!JSON.stringify(raw).includes('PRIVATE'));assert.ok(!JSON.stringify(raw).includes('object_path'));assert.ok(!JSON.stringify(raw).includes('raw_encrypted'));
        const catalog=refundSplitCatalog(raw,owner,r.ids[0]);assert.equal(catalog.transactions.find(t=>t.id===draft.ids[0])?.record_status,'draft');assert.equal(catalog.transactions.filter(t=>t.id===r.ids[0]).length,1);assert.ok(catalog.transactions.every(t=>t.id===r.ids[0]||Number(t.signed_amount_pence)<0));
        const intent=await intentFor(r.ids[0],[[o.ids[0],30000],[o.ids[1],20000]]),preview=refundSplitReview(owner,intent,catalog).result,result=await approve(intent);
        assert.equal(result.recognized_reduction_pence,preview.recognized_reduction_pence);assert.equal(result.profit_delta_pence,preview.profit_delta_pence);
        await auth(other);await assert.rejects(db.query('select read_refund_split_catalog($1)',[r.ids[0]]),/Owned refund source unavailable/);
        await auth('');await assert.rejects(db.query('select read_refund_split_catalog($1)',[r.ids[0]]),/permission denied/);await db.exec('reset role;set role service_role');await assert.rejects(db.query('select read_refund_split_catalog($1)',[r.ids[0]]),/permission denied/);await auth();
    });
    await serialSubtest(t,'strict payloads, foreign and stale source versions leave no partial effects',async()=>{
        const o=await ingest([-1000,-1000],'2026-04-05'),r=await ingest([1000],'2026-04-06');for(const id of o.ids)await db.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic originals')",[id,expense]);
        const intent=await intentFor(r.ids[0],[[o.ids[0],500],[o.ids[1],500]]),before=await stamp();
        for(const invalid of [{...intent,owner_id:other},{...intent,refund_version:'0'},{...intent,allocations:[{...intent.allocations[0],amount_pence:500.5},intent.allocations[1]]},{...intent,allocations:[intent.allocations[0],intent.allocations[0]]},{...intent,allocations:[{...intent.allocations[0],original_id:randomUUID()},intent.allocations[1]]},{...intent,allocations:[{...intent.allocations[0],original_version:0},intent.allocations[1]]},{...intent,allocations:[{...intent.allocations[0],amount_pence:499},intent.allocations[1]]}])await assert.rejects(approve(invalid));
        await auth(other);await assert.rejects(approve({...intent,expected_stamp:await stamp()}),/not found/);await auth();assert.equal(await stamp(),before);
        await db.query("select review_bank_transaction($1,0,'Personal',null,0,'Changed review')",[r.ids[0]]);await assert.rejects(approve(intent),/context changed/);
        assert.equal((await db.query<{n:number}>('select count(*)::int n from refund_links where refund_transaction_id=$1',[r.ids[0]])).rows[0].n,0);
    });
    await serialSubtest(t,'a split retains per-original category/project/year and removes one prior interpretation once',async()=>{
        const o=await ingest([-63029,-50000],'2026-04-05'),r=await ingest([50000],'2026-04-06');
        await db.exec('reset role');const category=(await db.query<{id:string}>("insert into record_categories(user_id,name,record_type) values($1,'Synthetic second expense','expense') returning id",[owner])).rows[0].id;
        const projects:string[]=[];for(let i=0;i<2;i++)projects.push((await db.query<{id:string}>("insert into projects(user_id,name) values($1,$2) returning id",[owner,'Synthetic project '+i])).rows[0].id);
        await auth();for(const [i,bps]of [3000,4500].entries())await db.query("select review_bank_transaction($1,0,'Mixed',$2,$3,'Synthetic source treatment')",[o.ids[i],[expense,category][i],bps]);
        await db.exec('reset role');for(const [i,id]of o.ids.entries())await db.query('update financial_records set project_id=$1 where bank_transaction_id=$2',[projects[i],id]);await auth();
        await db.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic mistaken income')",[r.ids[0],income]);
        const ordinary=(await db.query<{id:string}>('select id from financial_records where bank_transaction_id=$1',[r.ids[0]])).rows[0].id;
        const intent=await intentFor(r.ids[0],[[o.ids[0],30000],[o.ids[1],20000]]),result=await approve(intent);
        assert.equal(result.observed_cash_pence,50000);assert.equal(result.recognized_reduction_pence,18000);assert.equal(result.removed_ordinary_income_pence,50000);assert.equal(result.income_delta_pence,-50000);assert.equal(result.expense_delta_pence,-18000);assert.equal(result.profit_delta_pence,-32000);
        const records=(await db.query<{id:string;status:string;effect_sign:number;refund_link_id:string|null;project_id:string|null;category_id:string;record_date:string;amount:string}>('select id,status,effect_sign,refund_link_id,project_id,category_id,record_date::text,amount from financial_records where bank_transaction_id=$1',[r.ids[0]])).rows;
        assert.equal(records.length,3);assert.deepEqual(records.find(f=>f.id===ordinary),{id:ordinary,status:'excluded',effect_sign:1,refund_link_id:null,project_id:null,category_id:income,record_date:'2026-04-06',amount:'500.00'});
        const children=records.filter(f=>f.status==='approved');assert.deepEqual(children.map(f=>f.project_id).sort(),[...projects].sort());assert.deepEqual(children.map(f=>f.category_id).sort(),[expense,category].sort());assert.ok(children.every(f=>f.effect_sign===-1&&f.amount==='90.00'&&f.record_date==='2026-04-06'));
        const tx=(await db.query('select recognized_record_id,business_use_bps,category_id,decision_version from bank_transactions where id=$1',[r.ids[0]])).rows[0];assert.deepEqual(tx,{recognized_record_id:null,business_use_bps:0,category_id:null,decision_version:2});
        assert.deepEqual(await approve({...intent,allocations:[...intent.allocations].reverse()}),result);
        await assert.rejects(approve({...intent,rationale:'Changed request'}),/request changed/);
        const aggregate=(await db.query<{n:string}>('select recognized_pence n from bank_transaction_record_effects where bank_transaction_id=$1',[r.ids[0]])).rows[0];assert.equal(Number(aggregate.n),-18000);
        const reviewed=await stamp();await db.query("select reverse_refund_closure('refund',$1,$2,'Reviewed complete correction',$3)",[r.ids[0],reviewed,randomUUID()]);
        assert.deepEqual(await approve(intent),result);assert.equal((await db.query<{n:number}>("select count(*)::int n from financial_records where bank_transaction_id=$1 and status='approved'",[r.ids[0]])).rows[0].n,0);
        const v=(await db.query<{v:number}>('select decision_version v from bank_transactions where id=$1',[r.ids[0]])).rows[0].v;
        await db.query("select review_bank_transaction($1,$2,'Business',$3,10000,'Reviewed fresh ordinary income')",[r.ids[0],v,income]);
        assert.equal((await db.query<{id:string}>("select id from financial_records where bank_transaction_id=$1 and status='approved'",[r.ids[0]])).rows[0].id,ordinary);
        assert.equal((await db.query<{n:number}>("select count(*)::int n from financial_records where bank_transaction_id=$1 and effect_sign=-1 and status='excluded'",[r.ids[0]])).rows[0].n,2);
        await db.exec('reset role');await assert.rejects(db.query("insert into financial_records(user_id,record_type,record_date,description,amount,source_type,status,bank_transaction_id) values($1,'income','2026-04-06','Duplicate ordinary',1,'manual','review',$2)",[owner,r.ids[0]]),/unique constraint/);await auth();
    });
    await serialSubtest(t,'cumulative penny rounding retains final zero-recognised portions without zero postings',async()=>{
        const o=await ingest([-2,-2],'2026-04-05'),r=await ingest([2,2],'2026-04-06');for(const id of o.ids)await db.query("select review_bank_transaction($1,0,'Mixed',$2,5000,'Synthetic half penny')",[id,expense]);
        const first=await syntheticRefundSplit(db,r.ids[0],o.ids.map(id=>[id,1]));const second=await syntheticRefundSplit(db,r.ids[1],o.ids.map(id=>[id,1]));assert.equal(first.result.recognized_reduction_pence,2);assert.equal(second.result.recognized_reduction_pence,0);assert.ok(second.result.portions.every(p=>p.record_id===null&&p.recognized_pence===0));
        assert.equal((await db.query<{n:number}>('select count(*)::int n from financial_records where bank_transaction_id=$1',[r.ids[1]])).rows[0].n,0);
        const closure=(await db.query<{g:{links:unknown[]}}>("select read_refund_reversal_graph('refund',$1) g",[r.ids[1]])).rows[0].g;assert.equal(closure.links.length,4);
        await db.query("select reverse_refund_closure('refund',$1,$2,'Reviewed pennies reversal',$3)",[r.ids[1],await stamp(),randomUUID()]);
        assert.equal((await db.query<{n:number}>('select count(*)::int n from active_refunds where original_transaction_id=any($1::uuid[])',[o.ids])).rows[0].n,0);
    });
    await serialSubtest(t,'each customer-refund child matches its own invoice without posting income twice',async()=>{
        const o=await ingest([1000,1000],'2026-04-05'),r=await ingest([-500],'2026-04-06');for(const id of o.ids)await db.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic customer receipts')",[id,income]);
        const client=(await db.query<{id:string}>("insert into clients(user_id,name) values($1,'Synthetic split customer') returning id",[owner])).rows[0].id;
        const invoices:{id:string;allocation:string;credit:string;amount:number}[]=[];
        for(const [i,amount]of [300,200].entries()){
            const id=randomUUID(),revision=randomUUID(),path=`${owner}/revisions/${revision}.pdf`,number='SPLIT-'+id;
            await db.exec('reset role');await db.query("insert into storage.objects(bucket_id,name) values('invoices',$1)",[path]);await auth();
            await db.query('select save_invoice_revision($1,$2,null,$3,$4,$5)',[id,revision,JSON.stringify({client_id:client,number,invoice_date:'2026-04-05',due_date:'2026-05-05',description:'Synthetic work',payment_terms:'30 days',net_pence:1000,vat_pence:0,vat_rate_bps:0,vat_enabled:false,vat_number:'',reason:'Reviewed synthetic invoice'}),path,'a'.repeat(64)]);
            const version=(await db.query<{v:string}>('select updated_at::text v from invoices where id=$1',[id])).rows[0].v;
            await db.query("select approve_invoice_allocations($1,1,$2,'Reviewed original receipt allocation',$3,0)",[o.ids[i],JSON.stringify([{invoice_id:id,amount_pence:1000,invoice_updated_at:version}]),randomUUID()]);
            const allocation=(await db.query<{id:string}>('select id from active_invoice_allocations where invoice_id=$1',[id])).rows[0].id;
            const b=(await db.query<{balance_stamp:string;next_ordinal:number}>('select balance_stamp,next_ordinal from invoice_credit_choices where id=$1',[id])).rows[0],credit=randomUUID(),creditPath=`${owner}/credits/${credit}.pdf`;
            await db.exec('reset role');await db.query("insert into storage.objects(bucket_id,name) values('invoices',$1)",[creditPath]);await auth();
            const document={number:`CN-${number}-${String(b.next_ordinal).padStart(3,'0')}`,creditDate:'2026-04-06',invoiceNumber:number,invoiceDate:'2026-04-05',description:'Synthetic work',sellerName:'Synthetic supplier',sellerAddress:'',clientName:'Synthetic split customer',clientAddress:'',reason:'Reviewed split credit',grossPence:amount,netPence:amount,vatPence:0,taxStatus:'invoice_snapshot',vatRateBps:0,vatNumber:'',reviewHash:'b'.repeat(64)};
            await db.query("select approve_invoice_credit($1,$2,$3,'2026-04-06',$4,'Reviewed split credit',$5,$6,$7)",[id,credit,b.balance_stamp,amount,JSON.stringify(document),creditPath,'c'.repeat(64)]);
            invoices.push({id,credit,allocation,amount});
        }
        const split=await syntheticRefundSplit(db,r.ids[0],[[o.ids[0],300],[o.ids[1],200]]),marker=(await db.query<{m:string}>('select active_refund_id m from bank_transactions where id=$1',[r.ids[0]])).rows[0].m;
        assert.ok(split.result.portions.some(p=>p.refund_link_id!==marker));assert.equal((await db.query<{p:string|null}>('select recognized_record_id p from bank_transactions where id=$1',[r.ids[0]])).rows[0].p,null);
        const before=(await db.query("select id,amount,effect_sign,status from financial_records order by id")).rows;
        const assignments:string[]=[];
        for(const [i,inv]of invoices.entries()){
            const portion=split.result.portions.find(p=>p.original_id===o.ids[i])!,request=randomUUID(),reviewed=await stamp();
            const sql="select approve_invoice_refund_assignment($1,$2,$3,$4,$5,'Reviewed child returned cash',$6) r",args=[inv.credit,inv.allocation,portion.refund_link_id,inv.amount,reviewed,request];
            const result=(await db.query<{r:{assignment_id:string;recognized_income_change_pence:number}}>(sql,args)).rows[0].r;assignments.push(result.assignment_id);assert.equal(result.recognized_income_change_pence,0);
            assert.deepEqual((await db.query<{r:unknown}>(sql,args)).rows[0].r,result);
            const excessive=[...args];excessive[5]=randomUUID();excessive[4]=await stamp();excessive[3]=1;await assert.rejects(db.query(sql,excessive),/remaining refund cash/);
            const balance=(await db.query<{returned_pence:string;retained_cash_pence:string}>('select returned_pence,retained_cash_pence from invoice_payment_balances where id=$1',[inv.id])).rows[0];assert.equal(Number(balance.returned_pence),inv.amount);assert.equal(Number(balance.retained_cash_pence),1000-inv.amount);
        }
        assert.deepEqual((await db.query('select id,amount,effect_sign,status from financial_records order by id')).rows,before);
        for(const root of [{kind:'original',id:o.ids[0]},{kind:'refund',id:r.ids[0]},{kind:'import',id:o.import}])await assert.rejects(db.query("select reverse_refund_closure($1,$2,$3,'Must review sibling assignments',$4)",[root.kind,root.id,await stamp(),randomUUID()]),/every linked invoice refund assignment/);
        for(const id of assignments)await db.query("select reverse_invoice_refund_assignment($1,$2,'Reviewed child unmatch',$3)",[id,await stamp(),randomUUID()]);
        await db.query("select reverse_refund_closure('original',$1,$2,'Reviewed complete customer correction',$3)",[o.ids[1],await stamp(),randomUUID()]);
        assert.equal((await db.query<{n:number}>("select count(*)::int n from financial_records where bank_transaction_id=$1 and effect_sign=-1 and status='excluded'",[r.ids[0]])).rows[0].n,2);
    });
    await serialSubtest(t,'malformed prior cash and ordinary provenance cannot be extended or silently replaced',async()=>{
        const o=await ingest([-1000,-1000],'2026-04-05'),r=await ingest([500,500],'2026-04-06');for(const id of o.ids)await db.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic originals')",[id,expense]);
        const first=await syntheticRefundSplit(db,r.ids[0],[[o.ids[0],250],[o.ids[1],250]]);
        await db.exec('reset role;begin');
        try{
            const child=first.result.portions.find(p=>p.original_id===o.ids[1])!;
            // Privileged corruption fixture: half a shared observation was reversed outside its guarded RPC.
            await db.query("insert into refund_reversals(user_id,refund_id,author,rationale,request_id) values($1,$2,$1,'Synthetic malformed half reversal',$3)",[owner,child.refund_link_id,first.intent.request_id]);await auth();
            const intent=await intentFor(r.ids[1],[[o.ids[0],500]]),before=await stamp();await db.exec('savepoint malformed_extension');await assert.rejects(approve(intent),/completely allocated/);await db.exec('rollback to savepoint malformed_extension');assert.equal(await stamp(),before);
        }finally{await db.exec('rollback;reset role');await auth();}
        await db.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic prior income')",[r.ids[1],income]);
        await db.exec('reset role');await db.query("update financial_records set record_date='2026-04-07' where bank_transaction_id=$1",[r.ids[1]]);await auth();
        const intent=await intentFor(r.ids[1],[[o.ids[0],250],[o.ids[1],250]]),before=await stamp();await assert.rejects(approve(intent),/existing interpretation/);assert.equal(await stamp(),before);
    });
    await serialSubtest(t,'late request insert failure rolls back all children, ordinary exclusion and decisions',async()=>{
        const o=await ingest([-1000,-1000],'2026-04-05'),r=await ingest([1000],'2026-04-06');for(const id of o.ids)await db.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic originals')",[id,expense]);await db.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic prior income')",[r.ids[0],income]);const intent=await intentFor(r.ids[0],[[o.ids[0],500],[o.ids[1],500]]),before=await stamp();
        await db.exec("reset role;create function public.synthetic_split_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic split late failure';end;$$;create trigger synthetic_split_failure before insert on public.refund_requests for each row execute function public.synthetic_split_failure();");
        try{await auth();await assert.rejects(approve(intent),/Synthetic split late failure/);assert.equal(await stamp(),before);assert.equal((await db.query<{n:number}>('select count(*)::int n from refund_links where refund_transaction_id=$1',[r.ids[0]])).rows[0].n,0);assert.equal((await db.query<{s:string}>("select status s from financial_records where bank_transaction_id=$1",[r.ids[0]])).rows[0].s,'approved');}
        finally{await db.exec('reset role;drop trigger synthetic_split_failure on public.refund_requests;drop function public.synthetic_split_failure();');await auth();}
    });    await serialSubtest(t,'oversized opposite-source catalogs reject without returning partial choices',async()=>{
        const r=await ingest([1],'2026-04-06');await db.exec('begin');
        try{await ingest(Array(5000).fill(-1),'2026-04-05');await ingest(Array(5000).fill(-1),'2026-04-05');await assert.rejects(db.query('select read_refund_split_catalog($1)',[r.ids[0]]),/exceeds the complete review limit/);}
        finally{await db.exec('rollback;reset role');await auth();}
    });

});

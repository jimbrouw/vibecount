import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { syntheticRefundSplit } from './refund-split-fixture';
import { sourceImportReversalReview, type ImportReversalContext } from '../records/import-reversal';

test('reviewed import reversal removes complete effects once and preserves source evidence', async t => {
    const db = new PGlite({ extensions: { pgcrypto } }); t.after(() => db.close()); await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL('../../supabase/migrations/', import.meta.url); for (const n of (await readdir(dir)).filter(n => n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(n, dir), 'utf8'));
    const owner = randomUUID(), other = randomUUID(); await db.query('insert into auth.users values($1),($2)', [owner, other]);
    const account = (await db.query<{ id: string }>("insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values($1,'Synthetic graph bank','generic','bank','1234') returning id", [owner])).rows[0].id;
    async function auth(who: string = owner) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who]); await db.exec(who ? 'set role authenticated' : 'set role anon'); }
    async function ingest(amounts: number[], date: string, selectedAccount = account) {
        await db.exec('reset role'); const attempt = randomUUID(), hash = randomBytes(32).toString('hex'), path = `${owner}/${selectedAccount}/${attempt}.enc`;
        await db.query("insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values($1,$2,$3,$4,$5,'synthetic',10,'uploaded')", [attempt, owner, selectedAccount, hash, path]);
        await db.query("insert into storage.objects(bucket_id,name) values('source-evidence',$1)", [path]);
        const rows = amounts.map((a, i) => ({ row_number: i + 2, row_hash: randomBytes(32).toString('hex'), raw_encrypted: 'PRIVATE_CIPHERTEXT', date, signed_pence: a, currency: 'GBP', description: 'PRIVATE_NORMALIZED_DESCRIPTION', reference: 'PRIVATE_REFERENCE', fingerprint: randomBytes(32).toString('hex') }));
        const result = (await db.query<{ r: { import_id: string } }>("select ingest_source_csv($1,$2,'synthetic.csv','mapped-csv/1','{}',$3) r", [owner, attempt, JSON.stringify(rows)])).rows[0].r;
        const ids = (await db.query<{ id: string }>('select t.id from bank_transactions t join source_rows s on s.id=t.source_row_id where t.import_id=$1 order by s.row_number', [result.import_id])).rows.map(r => r.id); await auth(); return { import: result.import_id, ids };
    }
    const expense=(await db.query<{id:string}>("select id from record_categories where is_default and record_type='expense' limit 1")).rows[0].id;
    const income=(await db.query<{id:string}>("select id from record_categories where is_default and record_type='income' limit 1")).rows[0].id;
    await db.exec('reset role');const secondAccount=(await db.query<{id:string}>("insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values($1,'Synthetic counterpart','generic','bank','5678') returning id",[owner])).rows[0].id;await auth();
    const context=async(id:string)=>(await db.query<{c:ImportReversalContext}>('select read_source_import_reversal_context($1) c',[id])).rows[0].c;
    const reverse=async(id:string,stamp:string,request=randomUUID(),reason='Reviewed complete synthetic import reversal')=>(await db.query<{r:{reset_ids:string[];excluded_approved_record_ids:string[];income_delta_pence:number;expense_delta_pence:number;profit_delta_pence:number;discarded_import_ids:string[]}}> ('select reverse_source_import_reviewed($1,$2,$3,$4) r',[id,stamp,reason,request])).rows[0].r;
    const client=(await db.query<{id:string}>("insert into clients(user_id,name) values($1,'Synthetic import client') returning id",[owner])).rows[0].id;
    async function fixture(){
        const target=await ingest([-1000,600,-700,1000,-200,-1000],'2026-04-06'),otherOriginals=await ingest([-1000,-1000,500],'2026-04-05'),otherRefunds=await ingest([400,100,200],'2026-04-07'),counterpart=await ingest([700],'2026-04-06',secondAccount);
        for(const [id,bps]of [[target.ids[0],5000],[target.ids[5],10000],[otherOriginals.ids[0],10000],[otherOriginals.ids[1],3000]] as const)await db.query('select review_bank_transaction($1,0,$2,$3,$4,$5)',[id,bps===10000?'Business':'Mixed',expense,bps,'Synthetic qualifying source']);
        for(const id of [target.ids[3],otherOriginals.ids[2]])await db.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic freelance receipt')",[id,income]);
        await db.query("select review_bank_transaction($1,0,'Personal',null,0,'Synthetic exclusion')",[target.ids[4]]);
        await syntheticRefundSplit(db,target.ids[1],[[target.ids[0],300],[otherOriginals.ids[0],300]]);
        await syntheticRefundSplit(db,otherRefunds.ids[0],[[otherOriginals.ids[0],100],[otherOriginals.ids[1],300]]);
        await syntheticRefundSplit(db,otherRefunds.ids[1],[[otherOriginals.ids[1],100]]);
        await syntheticRefundSplit(db,otherRefunds.ids[2],[[target.ids[5],200]]);
        await db.query("select approve_transfer_pair($1,0,$2,0,'transfer','Synthetic owned transfer',$3)",[target.ids[2],counterpart.ids[0],randomUUID()]);
        const invoice=randomUUID(),revision=randomUUID(),path=`${owner}/revisions/${revision}.pdf`,number='IMPORT-'+invoice;
        await db.exec('reset role');await db.query("insert into storage.objects(bucket_id,name) values('invoices',$1)",[path]);await auth();
        await db.query('select save_invoice_revision($1,$2,null,$3,$4,$5)',[invoice,revision,JSON.stringify({client_id:client,number,invoice_date:'2026-04-05',due_date:'2026-05-05',description:'Synthetic work',payment_terms:'30 days',net_pence:1500,vat_pence:0,vat_rate_bps:0,vat_enabled:false,vat_number:'',reason:'Reviewed synthetic invoice'}),path,'a'.repeat(64)]);
        for(const [id,amount]of [[target.ids[3],1000],[otherOriginals.ids[2],500]] as const){
            const version=(await db.query<{v:string}>('select updated_at::text v from invoices where id=$1',[invoice])).rows[0].v;
            await db.query("select approve_invoice_allocations($1,1,$2,'Synthetic receipt match',$3,0)",[id,JSON.stringify([{invoice_id:invoice,amount_pence:amount,invoice_updated_at:version}]),randomUUID()]);
        }
        const credit=randomUUID(),creditPath=`${owner}/credits/${credit}.pdf`,b=(await db.query<{balance_stamp:string;next_ordinal:number}>('select balance_stamp,next_ordinal from invoice_credit_choices where id=$1',[invoice])).rows[0];
        await db.exec('reset role');await db.query("insert into storage.objects(bucket_id,name) values('invoices',$1)",[creditPath]);await auth();
        const document={number:`CN-${number}-${String(b.next_ordinal).padStart(3,'0')}`,creditDate:'2026-04-06',invoiceNumber:number,invoiceDate:'2026-04-05',description:'Synthetic work',sellerName:'Synthetic supplier',sellerAddress:'',clientName:'Synthetic import client',clientAddress:'',reason:'Reviewed synthetic credit',grossPence:900,netPence:900,vatPence:0,taxStatus:'invoice_snapshot',vatRateBps:0,vatNumber:'',reviewHash:'b'.repeat(64)};
        await db.query("select approve_invoice_credit($1,$2,$3,'2026-04-06',900,'Reviewed synthetic credit',$4,$5,$6)",[invoice,credit,b.balance_stamp,JSON.stringify(document),creditPath,'c'.repeat(64)]);
        return {target,otherOriginals,otherRefunds,counterpart,invoice};
    }
    await serialSubtest(t,'foreign, anonymous and service callers cannot read or reverse a preserved import',async()=>{
        const f=await fixture(),c=await context(f.target.import);assert.ok(!JSON.stringify(c).includes('PRIVATE'));assert.ok(!JSON.stringify(c).includes('object_path'));
        await auth(other);await assert.rejects(context(f.target.import),/Owned preserved import/);await assert.rejects(reverse(f.target.import,c.financial_stamp),/Owned preserved import/);
        await auth('');await assert.rejects(context(f.target.import),/permission denied/);await assert.rejects(reverse(f.target.import,c.financial_stamp),/permission denied/);
        await db.exec('reset role;set role service_role');await assert.rejects(context(f.target.import),/permission denied/);await assert.rejects(reverse(f.target.import,c.financial_stamp),/permission denied/);await auth();
    });
    await serialSubtest(t,'shared/transitive/disconnected refunds, transfer and invoice release match read-back without duplicate decisions',async()=>{
        const f=await fixture(),c=await context(f.target.import),review=sourceImportReversalReview(owner,c),request=randomUUID();
        assert.equal(review.refund_closure.link_ids.length,6);assert.equal(review.refund_closure.observed_refund_cash_pence,1300);assert.equal(review.refund_closure.expense_reduction_removed_pence,870);
        assert.equal(review.income_delta_pence,-1000);assert.equal(review.expense_delta_pence,-630);assert.equal(review.profit_delta_pence,-370);assert.equal(review.reset_ids.length,10);
        assert.equal(review.invoices[0].released_allocation_pence,1000);assert.equal(review.invoices[0].refund_due_before_pence,900);assert.equal(review.invoices[0].outstanding_before_pence,0);assert.equal(review.invoices[0].outstanding_after_pence,100);assert.equal(review.invoices[0].retained_after_pence,500);
        const originalsBefore=(await db.query('select id,classification,decision_version from bank_transactions where import_id=$1 order by id',[f.otherOriginals.import])).rows;
        const sourcesBefore=(await db.query('select id,source_row_id,signed_amount_pence,transaction_date from bank_transactions where id=any($1::uuid[]) order by id',[c.transactions.map(t=>t.id)])).rows;
        const totals=async()=>(await db.query<{income:string;expense:string}>("select coalesce(sum(amount*100*effect_sign) filter(where record_type='income'),0)::text income,coalesce(sum(amount*100*effect_sign) filter(where record_type='expense'),0)::text expense from financial_records where user_id=$1 and status='approved'",[owner])).rows[0],before=await totals();
        const result=await reverse(f.target.import,c.financial_stamp,request),after=await totals();
        assert.deepEqual(result.reset_ids,review.reset_ids);assert.deepEqual([...result.excluded_approved_record_ids].sort(),review.excluded_record_ids);assert.equal(Number(after.income)-Number(before.income),review.income_delta_pence);assert.equal(Number(after.expense)-Number(before.expense),review.expense_delta_pence);
        assert.deepEqual(result.discarded_import_ids,[f.target.import]);assert.equal((await db.query<{s:string}>('select status s from record_imports where id=$1',[f.target.import])).rows[0].s,'discarded');
        for(const imp of [f.otherOriginals.import,f.otherRefunds.import,f.counterpart.import])assert.equal((await db.query<{s:string}>('select status s from record_imports where id=$1',[imp])).rows[0].s,'review');
        for(const t of c.transactions.filter(t=>review.reset_ids.includes(t.id))){const current=(await db.query<{classification:string;decision_version:number}>('select classification,decision_version from bank_transactions where id=$1',[t.id])).rows[0];assert.deepEqual(current,{classification:'Unknown',decision_version:t.decision_version+1});}
        assert.deepEqual((await db.query('select id,classification,decision_version from bank_transactions where import_id=$1 order by id',[f.otherOriginals.import])).rows,originalsBefore);
        assert.deepEqual((await db.query('select id,source_row_id,signed_amount_pence,transaction_date from bank_transactions where id=any($1::uuid[]) order by id',[c.transactions.map(t=>t.id)])).rows,sourcesBefore);
        const b=(await db.query<{outstanding_pence:string;retained_cash_pence:string;credited_pence:string}>('select outstanding_pence,retained_cash_pence,credited_pence from invoice_payment_balances where id=$1',[f.invoice])).rows[0];assert.equal(Number(b.outstanding_pence),100);assert.equal(Number(b.retained_cash_pence),500);assert.equal(Number(b.credited_pence),900);
        assert.equal((await db.query<{n:number}>('select count(*)::int n from active_invoice_allocations where invoice_id=$1',[f.invoice])).rows[0].n,1);
        await db.query('select reopen_source_import($1)',[f.target.import]);const afterReopen=await context(f.target.import);assert.deepEqual(await reverse(f.target.import,c.financial_stamp,request),result);assert.deepEqual(await context(f.target.import),afterReopen);
        await assert.rejects(reverse(f.target.import,c.financial_stamp,request,'Changed request'),/request changed/);await assert.rejects(reverse(f.target.import,c.financial_stamp),/context changed/);
        await assert.rejects(db.query('delete from source_import_reversal_requests'),/permission denied/);
    });
    await serialSubtest(t,'late request-history failure rolls back every child, exclusion, source decision and import event',async()=>{
        const f=await fixture(),c=await context(f.target.import),events=(await db.query('select * from source_import_events where import_id=$1 order by id',[f.target.import])).rows;
        await db.exec("reset role;create function public.synthetic_import_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic import late failure';end;$$;create trigger synthetic_import_failure before insert on public.source_import_reversal_requests for each row execute function public.synthetic_import_failure();");
        try{await auth();await assert.rejects(reverse(f.target.import,c.financial_stamp),/Synthetic import late failure/);assert.deepEqual(await context(f.target.import),c);assert.deepEqual((await db.query('select * from source_import_events where import_id=$1 order by id',[f.target.import])).rows,events);}
        finally{await db.exec('reset role;drop trigger synthetic_import_failure on public.source_import_reversal_requests;drop function public.synthetic_import_failure();');await auth();}
    });
});

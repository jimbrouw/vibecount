/** Actual guarded RPC demonstration in disposable synthetic PostgreSQL only. */
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
import { syntheticRefundSplit } from '../lib/database/refund-split-fixture';
import { sourceImportReversalReview, type ImportReversalContext } from '../lib/records/import-reversal';
async function main(){
    const db = new PGlite({ extensions: { pgcrypto } }); await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL('../supabase/migrations/', import.meta.url); for (const n of (await readdir(dir)).filter(n => n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(n, dir), 'utf8'));
    const owner = randomUUID(), other = randomUUID(); await db.query('insert into auth.users values($1),($2)', [owner, other]);
    const account = (await db.query<{ id: string }>("insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values($1,'Synthetic graph bank','generic','bank','1234') returning id", [owner])).rows[0].id;
    async function auth(who: string = owner) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who]); await db.exec(who ? 'set role authenticated' : 'set role anon'); }
    async function ingest(amounts: number[], date: string, selectedAccount = account) {
        await db.exec('reset role'); const attempt = randomUUID(), hash = randomBytes(32).toString('hex'), path = `${owner}/${selectedAccount}/${attempt}.enc`;
        await db.query("insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values($1,$2,$3,$4,$5,'synthetic',10,'uploaded')", [attempt, owner, selectedAccount, hash, path]);
        await db.query("insert into storage.objects(bucket_id,name) values('source-evidence',$1)", [path]);
        const rows = amounts.map((a, i) => ({ row_number: i + 2, row_hash: randomBytes(32).toString('hex'), raw_encrypted: 'SYNTHETIC_CIPHERTEXT_PLACEHOLDER', date, signed_pence: a, currency: 'GBP', description: 'Synthetic source observation', reference: '', fingerprint: randomBytes(32).toString('hex') }));
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
    try{
        const f=await fixture(),c=await context(f.target.import),review=sourceImportReversalReview(owner,c),result=await reverse(f.target.import,c.financial_stamp);
        assert.deepEqual(result.reset_ids,review.reset_ids);assert.equal(result.profit_delta_pence,-370);assert.deepEqual(result.discarded_import_ids,[f.target.import]);
        for(const t of c.transactions.filter(t=>review.reset_ids.includes(t.id))){const current=(await db.query<{v:number;c:string}>('select decision_version v,classification c from bank_transactions where id=$1',[t.id])).rows[0];assert.equal(current.v,t.decision_version+1);assert.equal(current.c,'Unknown');}
        const balance=(await db.query<{outstanding_pence:string;retained_cash_pence:string;credited_pence:string}>('select outstanding_pence,retained_cash_pence,credited_pence from invoice_payment_balances where id=$1',[f.invoice])).rows[0];
        assert.equal(Number(balance.outstanding_pence),100);assert.equal(Number(balance.retained_cash_pence),500);
        const out='/tmp/vibecount-import-reversal-demo';await mkdir(out,{recursive:true});
        await writeFile(out+'/synthetic-review-and-reversal.json',JSON.stringify({synthetic_only:true,review,result,invoice_after:balance},null,2)+'\n');
        await writeFile(out+'/README.md','# Synthetic complete import reversal\n\nExecuted actual ordered migrations and authenticated RPCs in disposable in-memory PostgreSQL. The selected import includes an original, shared refund, transfer, receipt, personal exclusion and disconnected original. Six refund portions span four refund observations and three other imports. Ten affected observations reset once each; only the selected import is discarded. Net profit changes by minus £3.70. Releasing a £10 invoice match retains another £5 receipt and £9 credit, producing £1 outstanding.\n\nAll files, ciphertext, hashes, objects, identities and financial evidence are synthetic placeholders. No hosted or real financial action occurred.\n');
        console.log('Verified actual synthetic full import reversal:',out);
    }finally{await db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

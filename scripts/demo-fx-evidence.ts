import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
import { fxDocumentFactReadback, parseFxEvidenceCatalog, validateFxDocumentFactIntent, type FxDocumentFactIntent } from '../lib/fx/document-facts';
import { rateFromDecimal } from '../lib/fx/currency';
type Saved = { family_id:string;revision_id:string;ordinal:number;state:string };
async function main(){
    const db=new PGlite({extensions:{pgcrypto}});
    try{
        await db.exec(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../supabase/migrations/',import.meta.url);
        for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
        const owner=randomUUID();await db.query('insert into auth.users(id) values($1)',[owner]);
        async function auth(){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');}
        async function document(){
            await db.exec('reset role');const attempt=randomUUID(),hash=randomBytes(32).toString('hex'),path=`${owner}/${attempt}.enc`;
            await db.query("insert into document_upload_attempts(id,user_id,file_hash,state,planned_objects) values($1,$2,$3,'uploaded',$4)",[attempt,owner,hash,JSON.stringify([{hash,size:100,media_type:'application/pdf',path,key_id:'synthetic',name_encrypted:'synthetic'}])]);
            await db.query("insert into storage.objects(bucket_id,name) values('document-evidence',$1)",[path]);await db.exec('set role service_role');
            await db.query("select register_document_intake($1,$2,2025,'invoice','opaque-evidence/1')",[owner,attempt]);
            const id=(await db.query<{id:string}>('select id from evidence_documents where user_id=$1 and file_hash=$2',[owner,hash])).rows[0].id;return id;
        }
        const invoiceDoc=await document(),conversionDoc=await document();await db.exec('reset role');
        const account=(await db.query<{id:string}>("insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values($1,'Synthetic FX receipt','starling','bank','1234') returning id",[owner])).rows[0].id;
        const attempt=randomUUID(),hash=randomBytes(32).toString('hex'),path=`${owner}/${attempt}.enc`;
        await db.query("insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values($1,$2,$3,$4,$5,'synthetic',100,'uploaded')",[attempt,owner,account,hash,path]);
        await db.query("insert into storage.objects(bucket_id,name) values('source-evidence',$1)",[path]);await db.exec('set role service_role');
        const ingest=(await db.query<{r:{import_id:string}}>("select ingest_source_csv($1,$2,'synthetic.csv','mapped-csv/1','{}',$3) r",[owner,attempt,JSON.stringify([{row_number:2,row_hash:randomBytes(32).toString('hex'),raw_encrypted:'synthetic',date:'2026-04-06',signed_pence:79000,currency:'GBP',description:'Synthetic receipt',reference:'',fingerprint:randomBytes(32).toString('hex')}])])).rows[0].r;
        const tx=(await db.query<{id:string}>('select id from bank_transactions where import_id=$1',[ingest.import_id])).rows[0].id;await auth();
        const context=async()=>parseFxEvidenceCatalog(owner,(await db.query<{r:unknown}>('select read_fx_evidence_catalog() r')).rows[0].r);
        const save=async(intent:FxDocumentFactIntent)=>(await db.query<{r:Saved}>('select review_fx_document_evidence($1) r',[JSON.stringify(validateFxDocumentFactIntent(intent))])).rows[0].r;
        const financial=async()=>(await db.query<{s:string}>('select reconciliation_export_stamp() s')).rows[0].s,before=await financial();
        const invoice:FxDocumentFactIntent={schema_version:'fx-document-fact-intent/1',ruleset_id:'vibecount-currencies/1',family_id:randomUUID(),expected_ordinal:0,kind:'invoice',state:'verified',document_id:invoiceDoc,invoice_evidence_revision_id:null,transaction_id:null,transaction_version:null,data:{currency:'USD',original_total_minor:100000,invoice_date:'2026-04-05',invoice_reference:'FX-DEMO'},human_read_original:true,expected_stamp:(await context()).stamp,rationale:'Synthetic fixture models human original review',request_id:randomUUID()};
        const invoicePreview=fxDocumentFactReadback(owner,invoice,await context()),savedInvoice=await save(invoice);
        const proof:FxDocumentFactIntent={...invoice,family_id:randomUUID(),kind:'conversion',document_id:conversionDoc,invoice_evidence_revision_id:savedInvoice.revision_id,transaction_id:tx,transaction_version:0,data:{rate:rateFromDecimal('USD','GBP','0.79'),conversion_date:'2026-04-06',evidence_date:'2026-04-07',invoice_portion_minor:100000,gbp_cash_portion_pence:79000,fee_mode:'none'},expected_stamp:(await context()).stamp,request_id:randomUUID()};
        const proofPreview=fxDocumentFactReadback(owner,proof,await context()),savedProof=await save(proof),verified=await context();
        assert.equal(verified.facts.find(f=>f.id===savedProof.revision_id)!.usable,true);
        await save({...invoice,expected_ordinal:savedInvoice.ordinal,state:'provisional',human_read_original:false,expected_stamp:(await context()).stamp,request_id:randomUUID()});
        const stale=await context();assert.equal(stale.facts.find(f=>f.id===savedProof.revision_id)!.usable,false);
        const withdrawal:FxDocumentFactIntent={...proof,expected_ordinal:savedProof.ordinal,state:'withdrawn',document_id:null,invoice_evidence_revision_id:null,transaction_id:null,transaction_version:null,data:null,human_read_original:false,expected_stamp:stale.stamp,request_id:randomUUID()};
        const withdrawn=await save(withdrawal);assert.deepEqual(await save(proof),savedProof);assert.equal((await context()).facts.find(f=>f.id===withdrawn.revision_id)!.state,'withdrawn');
        assert.equal(await financial(),before);
        for(const table of ['financial_records','invoices','invoice_settlements'])assert.equal((await db.query<{n:number}>('select count(*)::integer n from '+table)).rows[0].n,0);
        const out='/tmp/vibecount-fx-evidence-demo';await mkdir(out,{recursive:true});
        await writeFile(out+'/synthetic-proof-history.json',JSON.stringify({synthetic_only:true,invoice_preview:invoicePreview,proof_preview:proofPreview,verified,stale,withdrawn:await context(),financial_stamp_unchanged:true,financial_records_created:0,canonical_invoices_created:0,settlements_created:0},null,2)+'\n');
        await writeFile(out+'/README.md','# Synthetic reviewed FX evidence\n\nExecuted actual document registration, GBP source intake and authenticated FX evidence review RPCs in disposable PostgreSQL. A reviewed USD 1,000 invoice proof and £790 conversion proof preserve dates across 5/6 April. New provisional invoice facts make old verified conversion proof stale. Withdrawal retains the original snapshot; exact retry returns historical success without restoring it. Financial state remains unchanged.\n\nObject/ciphertext metadata, hashes, identities and human-review attestations are synthetic fixture placeholders. They do not prove readable/decryptable original financial evidence. No canonical foreign invoice, settlement, accounting posting, real provider connection or hosted write is made. The human application form and full FX approval workflow remain incomplete.\n');
        console.log('Verified actual synthetic FX evidence history:',out);
    }finally{await db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { fxDocumentFactReadback, parseFxEvidenceCatalog } from '../fx/document-facts';
import { rateFromDecimal } from '../fx/currency';

type Fact = { id: string; family_id: string; ordinal: number; kind: string; state: string; usable: boolean; source_current: boolean; data: Record<string, unknown>; source_snapshot: unknown };
type Catalog = { owner_id: string; stamp: string; documents: {id:string}[]; receipts: {id:string}[]; facts: Fact[]; counts: {documents:number;receipts:number;facts:number} };
type Result = { family_id:string;revision_id:string;ordinal:number;state:string;recognized_income_change_pence:number;canonical_invoice_change:number;settlement_change:number };

test('reviewed FX document facts retain owned evidence, stale history and zero financial effects', async t => {
    const db = new PGlite({ extensions: { pgcrypto } }); t.after(() => db.close());
    await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL('../../supabase/migrations/', import.meta.url);
    for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
    const owner = randomUUID(), other = randomUUID(); await db.query('insert into auth.users(id) values($1),($2)', [owner, other]);
    async function auth(user = owner) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); await db.exec('set role authenticated'); }
    async function document(user = owner, zip = false, missing = false) {
        await db.exec('reset role'); const attempt = randomUUID(), hash = randomBytes(32).toString('hex'), path = `PRIVATE/${user}/${attempt}.enc`;
        await db.query("insert into document_upload_attempts(id,user_id,file_hash,state,planned_objects) values($1,$2,$3,'uploaded',$4)", [attempt, user, hash, JSON.stringify([{ hash, size:100, media_type:zip?'application/zip':'application/pdf',path,key_id:'PRIVATE',name_encrypted:'PRIVATE' }])]);
        await db.query("insert into storage.objects(bucket_id,name) values('document-evidence',$1)", [path]);
        await db.exec('set role service_role'); await db.query("select register_document_intake($1,$2,2025,'invoice','opaque-evidence/1')", [user, attempt]);
        await db.exec('reset role'); const doc = (await db.query<{id:string}>('select id from evidence_documents where user_id=$1 and file_hash=$2', [user,hash])).rows[0].id;
        if (missing) await db.query("delete from storage.objects where bucket_id='document-evidence' and name=$1", [path]);
        await auth(); return { id:doc, path };
    }
    const invoiceDoc = await document(), conversionDoc = await document(), foreignDoc = await document(other), zipDoc = await document(owner,true), absentDoc = await document(owner,false,true);
    await db.exec('reset role');
    const orphan=randomUUID(),orphanPath=`PRIVATE/${orphan}.enc`;
    await db.query("insert into evidence_documents(id,user_id,file_hash,media_type,size_bytes,object_path,key_id) values($1,$2,$3,'application/pdf',100,$4,'PRIVATE')",[orphan,owner,randomBytes(32).toString('hex'),orphanPath]);
    await db.query("insert into storage.objects(bucket_id,name) values('document-evidence',$1)",[orphanPath]);
    const account = (await db.query<{id:string}>("insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values($1,'Synthetic FX receipt','starling','bank','1234') returning id",[owner])).rows[0].id;
    const attempt=randomUUID(),hash=randomBytes(32).toString('hex'),path=`PRIVATE/${attempt}.enc`;
    await db.query("insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values($1,$2,$3,$4,$5,'PRIVATE',100,'uploaded')",[attempt,owner,account,hash,path]);
    await db.query("insert into storage.objects(bucket_id,name) values('source-evidence',$1)",[path]);await db.exec('set role service_role');
    const source=(await db.query<{r:{import_id:string}}>("select ingest_source_csv($1,$2,'synthetic.csv','mapped-csv/1','{}',$3) r",[owner,attempt,JSON.stringify([{row_number:2,row_hash:randomBytes(32).toString('hex'),raw_encrypted:'PRIVATE',date:'2026-04-06',signed_pence:79000,currency:'GBP',description:'PRIVATE',reference:'PRIVATE',fingerprint:randomBytes(32).toString('hex')}])])).rows[0].r;
    const tx=(await db.query<{id:string}>('select id from bank_transactions where import_id=$1',[source.import_id])).rows[0].id;await auth();
    const catalog=async()=>(await db.query<{r:Catalog}>('select read_fx_evidence_catalog() r')).rows[0].r;
    const financial=async()=>(await db.query<{s:string}>('select reconciliation_export_stamp() s')).rows[0].s;
    const approve=async(intent:Record<string,unknown>)=>(await db.query<{r:Result}>('select review_fx_document_evidence($1) r',[JSON.stringify(intent)])).rows[0].r;
    async function invoice(state='verified',family:string=randomUUID(),ordinal=0) { return {schema_version:'fx-document-fact-intent/1',ruleset_id:'vibecount-currencies/1',family_id:family,expected_ordinal:ordinal,kind:'invoice',state,document_id:invoiceDoc.id,invoice_evidence_revision_id:null,transaction_id:null,transaction_version:null,data:{currency:'USD',original_total_minor:100000,invoice_date:'2026-04-05',invoice_reference:'FX-100'},human_read_original:state==='verified',expected_stamp:(await catalog()).stamp,rationale:'PRIVATE rationale is not catalog metadata',request_id:randomUUID()}; }
    async function conversion(parent:string,state='verified',family:string=randomUUID(),ordinal=0,version=0) { return {...await invoice(state,family,ordinal),kind:'conversion',document_id:conversionDoc.id,invoice_evidence_revision_id:parent,transaction_id:tx,transaction_version:version,data:{rate:rateFromDecimal('USD','GBP','0.79'),conversion_date:'2026-04-06',evidence_date:'2026-04-07',invoice_portion_minor:100000,gbp_cash_portion_pence:79000,fee_mode:'none'}}; }
    async function withdraw(family:string,kind:string,ordinal:number) { return {...await invoice('withdrawn',family,ordinal),kind,document_id:null,data:null,human_read_original:false}; }
    let inv:Result,proof:Result,originalResult:Result,originalIntent:Record<string,unknown>,proofIntent:Record<string,unknown>;
    await serialSubtest(t,'multi-purpose evidence previews the exact registration retained by invoice and conversion review',async()=>{
        await db.exec('begin');
        try {
            // Deliberately sort the unrelated registration first, independent of random UUID order.
            await db.exec('reset role');
            const batch=randomUUID();
            await db.query("insert into document_batches(id,user_id,root_document_id,tax_year_start,purpose,parser_version) values($1,$2,$3,2024,'employment','opaque-evidence/1')",[batch,owner,invoiceDoc.id]);
            await db.query("insert into document_batch_items(id,user_id,batch_id,document_id,ordinal,original_name_encrypted) values('00000000-0000-0000-0000-000000000001',$1,$2,$3,0,'PRIVATE')",[owner,batch,invoiceDoc.id]);
            await auth();const before=await financial(),context=await catalog(),intent=await invoice();
            const preview=fxDocumentFactReadback(owner,intent,context).result.document!;
            assert.equal(preview.registration.purpose,'invoice');assert.equal(preview.registration.tax_year_start,2025);
            const saved=await approve(intent),current=await catalog();
            assert.deepEqual((current.facts.find(f=>f.id===saved.revision_id)!.source_snapshot as {document_source:unknown}).document_source,preview);
            const conversionIntent={...await conversion(saved.revision_id),document_id:invoiceDoc.id};
            const conversionPreview=fxDocumentFactReadback(owner,conversionIntent,current).result.document!;
            const converted=await approve(conversionIntent),after=await catalog();
            assert.deepEqual((after.facts.find(f=>f.id===converted.revision_id)!.source_snapshot as {document_source:unknown}).document_source,conversionPreview);
            assert.ok(after.facts.every(f=>f.usable));assert.equal(await financial(),before);
            assert.deepEqual(await approve(intent),saved);
        } finally {await db.exec('rollback');await auth();}
    });
    await serialSubtest(t,'selection upgrade invalidates open previews while preserving historical proof, recovery and withdrawal',async()=>{
        await db.exec('begin');
        try {
            const predecessor=await readFile(new URL('20261018130000_reviewed_fx_document_facts.sql',dir),'utf8');
            const sourceFunction=predecessor.slice(predecessor.indexOf('create function public.fx_document_source('),predecessor.indexOf('create function public.fx_document_fact_source_current('));
            const stampFunction=predecessor.slice(predecessor.indexOf('create function public.fx_evidence_review_stamp('),predecessor.indexOf('create function public.read_fx_evidence_catalog('));
            await db.exec('reset role');await db.exec((sourceFunction+stampFunction).replaceAll('create function','create or replace function'));
            const batch=randomUUID();
            await db.query("insert into document_batches(id,user_id,root_document_id,tax_year_start,purpose,parser_version) values($1,$2,$3,2024,'employment','opaque-evidence/1')",[batch,owner,conversionDoc.id]);
            await db.query("insert into document_batch_items(id,user_id,batch_id,document_id,ordinal,original_name_encrypted) values('00000000-0000-0000-0000-000000000001',$1,$2,$3,0,'PRIVATE')",[owner,batch,conversionDoc.id]);
            await auth();const before=await financial(),invoiceIntent=await invoice(),savedInvoice=await approve(invoiceIntent);
            const proofIntent=await conversion(savedInvoice.revision_id),savedProof=await approve(proofIntent);
            const legacy=await catalog(),retained=legacy.facts.find(f=>f.id===savedProof.revision_id)!;
            assert.equal((retained.source_snapshot as {document_source:{registration:{purpose:string}}}).document_source.registration.purpose,'employment');
            const pending=await conversion(savedInvoice.revision_id,'verified',savedProof.family_id,1);
            await db.exec('reset role');await db.exec(await readFile(new URL('20261018140000_fx_evidence_source_selection.sql',dir),'utf8'));await auth();
            const upgraded=await catalog();assert.notEqual(upgraded.stamp,legacy.stamp);
            assert.deepEqual(upgraded.facts.find(f=>f.id===savedProof.revision_id),retained);
            assert.ok(upgraded.facts.every(f=>f.usable));
            await db.exec('savepoint stale_preview');await assert.rejects(approve(pending),/changed/);await db.exec('rollback to savepoint stale_preview');
            assert.deepEqual(await approve(invoiceIntent),savedInvoice);assert.deepEqual(await approve(proofIntent),savedProof);
            const withdrawnProof=await approve(await withdraw(savedProof.family_id,'conversion',1));
            const withdrawnContext=await catalog();assert.deepEqual(withdrawnContext.facts.find(f=>f.id===withdrawnProof.revision_id)!.source_snapshot,retained.source_snapshot);
            const refreshed={...pending,expected_ordinal:2,expected_stamp:withdrawnContext.stamp},preview=fxDocumentFactReadback(owner,refreshed,withdrawnContext).result.document!;
            assert.equal(preview.registration.purpose,'invoice');
            const saved=await approve(refreshed),current=(await catalog()).facts.find(f=>f.id===saved.revision_id)!;
            assert.deepEqual((current.source_snapshot as {document_source:unknown}).document_source,preview);
            // Historical withdrawal still copies a pre-upgrade source exactly, without reselecting it.
            const legacyWithdrawal=await withdraw(savedInvoice.family_id,'invoice',1);const withdrawn=await approve(legacyWithdrawal);
            assert.deepEqual((await catalog()).facts.find(f=>f.id===withdrawn.revision_id)!.source_snapshot,legacy.facts.find(f=>f.id===savedInvoice.revision_id)!.source_snapshot);
            assert.deepEqual(await approve(proofIntent),savedProof);assert.equal(await financial(),before);
            for(const role of ['authenticated','service_role','anon']){
                await db.exec('reset role;set role '+role);await db.exec('savepoint private_helper');
                await assert.rejects(db.query('select fx_document_source($1,$2,false)',[owner,invoiceDoc.id]),/permission denied/);
                await db.exec('rollback to savepoint private_helper');
            }
        } finally {await db.exec('rollback');await auth();}
    });
    await serialSubtest(t,'strict review and owner boundaries reject unsupported or unpreserved evidence',async()=>{
        const before=await catalog(),base=await invoice();assert.equal(before.counts.documents,3);assert.equal(before.counts.receipts,1);assert.equal(before.counts.facts,0);
        for(const patch of [{extra:'PRIVATE'},{human_read_original:false},{expected_ordinal:null},{expected_stamp:'0'.repeat(32)},{document_id:foreignDoc.id},{document_id:zipDoc.id},{document_id:absentDoc.id},{document_id:orphan}])await assert.rejects(approve({...base,...patch}));
        for(const patch of [{currency:'XYZ'},{original_total_minor:0},{original_total_minor:'100000'},{original_total_minor:1000000000000},{invoice_date:'2026-02-30'},{invoice_reference:'unsafe free text'},{raw_pdf:'PRIVATE'}])await assert.rejects(approve({...base,data:{...base.data,...patch}}));
        for(const role of ['anon','service_role']){await db.exec('reset role;set role '+role);await assert.rejects(catalog(),/permission denied/);await assert.rejects(approve(base),/permission denied/);}
        await auth(other);assert.equal((await catalog()).facts.length,0);await assert.rejects(approve(base));await auth();
        for(const table of ['fx_document_fact_requests','fx_document_fact_families','fx_document_fact_revisions']){await assert.rejects(db.query('delete from '+table),/permission denied/);}
        assert.deepEqual(await catalog(),before);
    });
    await serialSubtest(t,'verified invoice and conversion facts pin original evidence and cross-year receipt without financial changes',async()=>{
        const before=await financial(),provisional=await invoice('provisional'),draft=await approve(provisional);
        await assert.rejects(approve(await conversion(draft.revision_id)),/current verified invoice/);
        originalIntent=await invoice('verified',draft.family_id,1);inv=await approve(originalIntent);originalResult=inv;
        assert.deepEqual(await approve(provisional),draft);assert.equal((await catalog()).facts[0].state,'verified');
        await assert.rejects(approve({...originalIntent,rationale:'Changed review'}),/request changed/);
        await assert.rejects(approve(await invoice()),/existing reviewed invoice facts/);
        proofIntent=await conversion(inv.revision_id);proof=await approve(proofIntent);
        assert.equal(proof.recognized_income_change_pence,0);assert.equal(proof.canonical_invoice_change,0);assert.equal(proof.settlement_change,0);assert.equal(await financial(),before);
        const c=await catalog();assert.equal(parseFxEvidenceCatalog(owner,c).facts.length,2);assert.equal(c.facts.length,2);assert.ok(c.facts.every(f=>f.usable&&f.source_current));assert.ok(!JSON.stringify(c).includes('PRIVATE'));assert.equal(c.counts.facts,2);
        const snapshot=c.facts.find(f=>f.id===proof.revision_id)!.source_snapshot as {receipt:{transaction_date:string};invoice_evidence:{data:{invoice_date:string}}};
        assert.equal(snapshot.receipt.transaction_date,'2026-04-06');assert.equal(snapshot.invoice_evidence.data.invoice_date,'2026-04-05');
        await auth(other);assert.equal((await catalog()).facts.length,0);assert.equal((await db.query('select * from fx_document_fact_revisions')).rows.length,0);
        await assert.rejects(approve({...proofIntent,family_id:randomUUID(),document_id:foreignDoc.id,expected_stamp:(await catalog()).stamp}),/current verified invoice/);await auth();
        assert.equal((await db.query('select * from financial_records')).rows.length,0);assert.equal((await db.query('select * from invoices')).rows.length,0);assert.equal((await db.query('select * from invoice_settlements')).rows.length,0);
    });
    await serialSubtest(t,'conversion shape, direction, portions and normalized exact recovery are enforced by the real writer',async()=>{
        const base=await conversion(inv.revision_id),before=await catalog();
        for(const patch of [{extra:'PRIVATE'},{fee_mode:'withheld'},{invoice_portion_minor:'100000'},{invoice_portion_minor:0},{invoice_portion_minor:1.1},{gbp_cash_portion_pence:79001},{conversion_date:'2026-02-30'},{evidence_date:'2026-02-30'},{rate:rateFromDecimal('GBP','USD','0.79')},{rate:rateFromDecimal('EUR','GBP','0.79')},{rate:{...rateFromDecimal('USD','GBP','0.79'),denominator:'0'}},{invoice_portion_minor:200000,gbp_cash_portion_pence:158000}])await assert.rejects(approve({...base,data:{...base.data,...patch}}));
        for(const patch of [{transaction_version:'0'},{transaction_version:1},{document_id:foreignDoc.id},{invoice_evidence_revision_id:proof.revision_id}])await assert.rejects(approve({...base,...patch}));
        const equivalent=structuredClone(proofIntent),data=equivalent.data as Record<string,unknown>;
        data.rate={...rateFromDecimal('USD','GBP','0.79'),numerator:'158',denominator:'200'};
        for(const key of ['family_id','request_id','document_id','invoice_evidence_revision_id','transaction_id'])equivalent[key]=(equivalent[key] as string).toUpperCase();
        equivalent.rationale='  '+equivalent.rationale+'  ';assert.deepEqual(await approve(equivalent),proof);
        assert.deepEqual(await catalog(),before);
    });
    await serialSubtest(t,'newer invoice facts supersede verified ancestry without fallback; stale expected ordinals cannot save',async()=>{
        const old=(await catalog()).stamp,updated=await invoice('verified',inv.family_id,inv.ordinal);inv=await approve(updated);
        let c=await catalog();const stale=c.facts.find(f=>f.family_id===proof.family_id)!;assert.equal(stale.state,'verified');assert.equal(stale.source_current,false);assert.equal(stale.usable,false);
        await assert.rejects(approve({...await conversion(proofIntent.invoice_evidence_revision_id as string),expected_stamp:c.stamp}),/current verified invoice/);
        await assert.rejects(approve({...await invoice('verified',inv.family_id,1),expected_stamp:old}));
        const pending=await invoice('provisional',inv.family_id,inv.ordinal);inv=await approve(pending);c=await catalog();assert.equal(c.facts.find(f=>f.family_id===inv.family_id)!.usable,false);
        await assert.rejects(approve(await conversion(inv.revision_id)),/current verified invoice/);
        inv=await approve(await invoice('verified',inv.family_id,inv.ordinal));
        proofIntent=await conversion(inv.revision_id,'verified',proof.family_id,proof.ordinal);proof=await approve(proofIntent);assert.equal((await catalog()).facts.find(f=>f.id===proof.revision_id)!.usable,true);
    });
    await serialSubtest(t,'late request failure rolls back new families and revisions together',async()=>{
        const intent=await invoice();intent.data={...intent.data,invoice_reference:'FX-ROLLBACK'};const before=await catalog();
        await db.exec("reset role;create function public.fail_fx_fact_request() returns trigger language plpgsql as $$begin raise exception 'Injected request failure';end;$$;create trigger fail_fx_fact_request before insert on public.fx_document_fact_requests for each row execute function public.fail_fx_fact_request();");await auth();
        await assert.rejects(approve(intent),/Injected request failure/);assert.deepEqual(await catalog(),before);
        await db.exec('reset role;drop trigger fail_fx_fact_request on public.fx_document_fact_requests;drop function public.fail_fx_fact_request();');await auth();
    });
    await serialSubtest(t,'receipt reinterpretation/discard and missing objects make evidence stale but cannot prevent withdrawal or exact recovery',async()=>{
        const category=(await db.query<{id:string}>("select id from record_categories where is_default and record_type='income' limit 1")).rows[0].id;
        await db.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic actual receipt review')",[tx,category]);
        assert.equal((await catalog()).facts.find(f=>f.id===proof.revision_id)!.source_current,false);
        proofIntent=await conversion(inv.revision_id,'verified',proof.family_id,proof.ordinal,1);proof=await approve(proofIntent);
        const context=(await db.query<{r:{financial_stamp:string}}>('select read_source_import_reversal_context($1) r',[source.import_id])).rows[0].r;
        await db.query("select reverse_source_import_reviewed($1,$2,'Synthetic source withdrawal',$3)",[source.import_id,context.financial_stamp,randomUUID()]);
        const previous=(await catalog()).facts.find(f=>f.id===proof.revision_id)!;assert.equal(previous.source_current,false);
        const undo=await withdraw(proof.family_id,'conversion',proof.ordinal),withdrawn=await approve(undo);
        parseFxEvidenceCatalog(owner,await catalog());
        const current=(await catalog()).facts.find(f=>f.id===withdrawn.revision_id)!;assert.equal(current.state,'withdrawn');assert.equal(current.usable,false);assert.deepEqual(current.source_snapshot,previous.source_snapshot);
        assert.deepEqual(await approve(proofIntent),proof);await assert.rejects(approve({...proofIntent,human_read_original:false}));
        await db.exec('reset role');await db.query("delete from storage.objects where bucket_id='document-evidence' and name=$1",[invoiceDoc.path]);await auth();
        const oldInvoice=(await catalog()).facts.find(f=>f.id===inv.revision_id)!;assert.equal(oldInvoice.source_current,false);
        const invoiceUndo=await approve(await withdraw(inv.family_id,'invoice',inv.ordinal));assert.deepEqual((await catalog()).facts.find(f=>f.id===invoiceUndo.revision_id)!.source_snapshot,oldInvoice.source_snapshot);
        assert.deepEqual(await approve(originalIntent),originalResult);
    });
    await serialSubtest(t,'immutable history, absent family revisions and catalog bounds fail closed',async()=>{
        await db.exec('reset role');await assert.rejects(db.query("update fx_document_fact_revisions set state='provisional'"),/immutable/i);await auth();
        await db.exec('begin;reset role');await db.query("insert into fx_document_fact_families(id,user_id,kind) values($1,$2,'invoice')",[randomUUID(),owner]);await db.exec('set role authenticated');await assert.rejects(catalog(),/Complete FX evidence/);await db.exec('rollback');await auth();
        await db.exec('begin;reset role');await db.query("insert into fx_document_fact_families(id,user_id,kind) select gen_random_uuid(),$1,'invoice' from generate_series(1,10001)",[owner]);await db.exec('set role authenticated');await assert.rejects(catalog(),/safe catalog limit/);await db.exec('rollback');await auth();
    });
});

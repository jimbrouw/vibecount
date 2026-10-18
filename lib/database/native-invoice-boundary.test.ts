import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
test('native invoice compatibility preserves predecessor amounts, snapshots, retries and containment',async t=>{
    const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir=new URL('../../supabase/migrations/',import.meta.url),name='20261018160000_native_invoice_boundary.sql';
    for(const migration of (await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<name).sort())await db.exec(await readFile(new URL(migration,dir),'utf8'));
    const owner=randomUUID(),other=randomUUID(),client=randomUUID(),invoice=randomUUID(),draft=randomUUID(),revision=randomUUID(),path=`${owner}/revisions/${revision}.pdf`;
    await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);await db.query("insert into clients(id,user_id,name) values($1,$2,'Synthetic preserved native')",[client,owner]);
    await db.query("insert into storage.objects(bucket_id,name) values('invoices',$1)",[path]);
    await db.query("insert into invoices(id,user_id,client_id,number,description,amount) values($1,$2,$3,'ZERO-DRAFT','Unfinalised',0)",[draft,owner,client]);
    async function auth(id=owner){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
    const data={client_id:client,number:'NATIVE-120',invoice_date:'2026-04-05',due_date:'2026-05-05',description:'Synthetic native reviewed invoice',payment_terms:'30 days',net_pence:10000,vat_pence:2000,vat_rate_bps:2000,vat_enabled:true,vat_number:'GB-SYNTHETIC',reason:'Original confirmed',review_hash:'b'.repeat(64)};
    const args=[invoice,revision,null,JSON.stringify(data),path,'a'.repeat(64)],save='select save_invoice_revision($1,$2,$3,$4,$5,$6) r';
    await auth();const originalResult=(await db.query<{r:unknown}>(save,args)).rows[0].r;
    const before=(await db.query<{j:unknown}>('select to_jsonb(i) j from invoices i where id=$1',[invoice])).rows[0].j;
    const prior=(await db.query<{j:unknown}>('select to_jsonb(r) j from invoice_revisions r where id=$1',[revision])).rows[0].j;
    const stamp=(await db.query<{s:string}>('select reconciliation_export_stamp() s')).rows[0].s;
    await db.exec('reset role');await db.exec(await readFile(new URL(name,dir),'utf8'));await auth();
    await serialSubtest(t,'forward migration retains exact wire scale, old columns, history body and financial stamp',async()=>{
        const columns=['origin','original_total_minor','currency_ruleset_id','source_fact_revision_id','source_fact_family_id'];
        assert.deepEqual((await db.query<{j:unknown}>('select to_jsonb(i)-$2::text[] j from invoices i where id=$1',[invoice,columns])).rows[0].j,before);
        assert.deepEqual((await db.query<{j:unknown}>('select to_jsonb(r)-$2::text[] j from invoice_revisions r where id=$1',[revision,['origin','source_fact_revision_id','source_snapshot']])).rows[0].j,prior);
        assert.equal((await db.query<{a:string}>('select amount::text a from invoices where id=$1',[invoice])).rows[0].a,'120.00');
        assert.equal((await db.query<{s:string}>('select reconciliation_export_stamp() s')).rows[0].s,stamp);
        assert.deepEqual((await db.query<{r:unknown}>(save,args)).rows[0].r,originalResult);
        const type=(await db.query<{data_type:string;numeric_precision:number;numeric_scale:number}>("select data_type,numeric_precision,numeric_scale from information_schema.columns where table_schema='public' and table_name='invoices' and column_name='amount'")).rows[0];assert.deepEqual(type,{data_type:'numeric',numeric_precision:12,numeric_scale:2});
    });
    await serialSubtest(t,'native drafts keep one amount and external metadata cannot masquerade as native money',async()=>{
        await db.query('update invoices set amount=12.34 where id=$1',[draft]);
        const row=(await db.query<{origin:string;amount:string;original_total_minor:null}>('select origin,amount,original_total_minor from invoices where id=$1',[draft])).rows[0];assert.equal(row.origin,'native_gbp');assert.equal(Number(row.amount),12.34);assert.equal(row.original_total_minor,null);
        for(const sql of ["update invoices set origin='preserved_external' where id=$1","update invoices set currency='USD' where id=$1","update invoices set original_total_minor=1234 where id=$1","update invoices set currency_ruleset_id='vibecount-currencies/1' where id=$1","update invoices set amount=null where id=$1"])await assert.rejects(db.query(sql,[draft]));
        await db.exec('reset role');await assert.rejects(db.query("update invoices set origin='preserved_external' where id=$1",[draft]));await assert.rejects(db.query("update invoice_revisions set origin='preserved_external' where id=$1",[revision]),/immutable/i);await auth();
    });
    await serialSubtest(t,'hostile privileged external candidates cannot enter native RPCs or contextual relationships',async()=>{
        await db.exec('begin;reset role');
        try{
            // Disposable corrupt-row simulation only: the shipping schema still rejects all external rows.
            await db.exec('alter table invoices drop constraint invoice_native_origin_scope;alter table invoices drop constraint invoices_currency_check;alter table invoices alter column amount drop not null;');
            const candidate=randomUUID();await db.query("insert into invoices(id,user_id,client_id,number,description,amount,origin,currency,status) values($1,$2,$3,'HOSTILE-EXTERNAL','Unapproved fixture',null,'preserved_external','GBP','finalised')",[candidate,owner,client]);
            const expected=(await db.query<{u:string}>('select updated_at::text u from invoices where id=$1',[candidate])).rows[0].u;
            await auth();await db.exec('savepoint guarded');await assert.rejects(db.query(save,[candidate,randomUUID(),expected,JSON.stringify({...data,number:'HOSTILE-EXTERNAL'}),path,'a'.repeat(64)]),/preserved invoice evidence/);await db.exec('rollback to savepoint guarded');
            for(const table of ['invoice_settlements','invoice_credit_notes','invoice_refund_assignments','financial_records']){
                await db.exec('reset role;savepoint guarded_relation');
                await assert.rejects(db.query('insert into '+table+'(user_id,invoice_id) values($1,$2)',[owner,candidate]),/currency-aware invoice relationship/);
                await db.exec('rollback to savepoint guarded_relation');
            }
            const record=randomUUID();await db.query("insert into financial_records(id,user_id,invoice_id,record_type,record_date,amount,description,source_type,status) values($1,$2,$3,'income','2026-04-05',12,'Synthetic contextual link','manual','draft')",[record,owner,invoice]);
            await auth();await db.exec('savepoint guarded_update');await assert.rejects(db.query('update financial_records set invoice_id=$1 where id=$2',[candidate,record]),/currency-aware invoice relationship/);await db.exec('rollback to savepoint guarded_update');
        }finally{await db.exec('rollback');await auth();}
        assert.equal((await db.query('select * from invoices where origin<>$1',['native_gbp'])).rows.length,0);
    });
    await serialSubtest(t,'owner grants and private boundary helper remain restricted',async()=>{
        await auth(other);assert.equal((await db.query('select * from invoices')).rows.length,0);assert.equal((await db.query('select * from invoice_revisions')).rows.length,0);await assert.rejects(db.query(save,args));
        for(const role of ['anon','authenticated','service_role']){await db.exec('reset role;set role '+role);await assert.rejects(db.query('select require_native_invoice_relationship()'),/permission denied/);}
        await auth();assert.deepEqual((await db.query<{r:unknown}>(save,args)).rows[0].r,originalResult);
    });
});

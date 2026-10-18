import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { ACCOUNT_EXPORT_FIELDS, ACCOUNT_EXPORT_TABLES } from '../records/account-export-fields';
test('partial account export context covers exact owned projections without financial or history mutation',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url),name='20261018170000_partial_account_export_context.sql';
 for(const file of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<name).sort())await db.exec(await readFile(new URL(file,dir),'utf8'));
 const owner=randomUUID(),other=randomUUID(),client=randomUUID(),invoice=randomUUID(),record=randomUUID(),reminder=randomUUID(),revision=randomUUID();
 await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);
 await db.query("insert into user_settings(id,legal_name,bank_details,companies_house_api_key) values($1,'Synthetic owner','PRIVATE_BANK','PRIVATE_KEY')",[owner]);
 await db.query("insert into clients(id,user_id,name,email) values($1,$2,'Synthetic client','customer@example.invalid')",[client,owner]);
 await db.query("insert into invoices(id,user_id,client_id,number,description,amount) values($1,$2,$3,'DRAFT-120','Synthetic draft',120)",[invoice,owner,client]);
 await db.query("insert into financial_records(id,user_id,record_type,record_date,description,amount,status) values($1,$2,'income','2026-04-05','Synthetic record',30,'draft')",[record,owner]);
 await db.query("insert into invoice_reminders(id,user_id,invoice_id,client_id,recipient_email,subject,message) values($1,$2,$3,$4,'customer@example.invalid','Synthetic subject','PRIVATE_MESSAGE')",[reminder,owner,invoice,client]);
 const before=(await db.query<{data:unknown}>("select jsonb_build_object('invoice',(select to_jsonb(i) from invoices i where id=$1),'record',(select to_jsonb(r) from financial_records r where id=$2)) data",[invoice,record])).rows[0].data;
 await db.exec(await readFile(new URL(name,dir),'utf8'));
 async function auth(id=owner){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
 async function context(){return(await db.query<{r:{stamp:string;counts:Record<string,number>;owner_id:string}}>('select read_partial_account_export_context() r')).rows[0].r;}
 await auth();
 await serialSubtest(t,'ordered upgrade preserves existing row bytes and restricts context owners/grants',async()=>{
  assert.deepEqual((await db.query<{data:unknown}>("select jsonb_build_object('invoice',(select to_jsonb(i) from invoices i where id=$1),'record',(select to_jsonb(r) from financial_records r where id=$2)) data",[invoice,record])).rows[0].data,before);
  const first=await context();assert.match(first.stamp,/^[a-f0-9]{64}$/);assert.equal(first.counts.invoices,1);assert.equal(first.counts.settings,1);assert.equal(first.counts.invoiceRevisions,0);assert.doesNotMatch(JSON.stringify(first),/PRIVATE/);
  await auth(other);const empty=await context();assert.equal(empty.owner_id,other);assert.ok(Object.values(empty.counts).every(n=>n===0));
  for(const role of ['anon','service_role']){await db.exec('reset role;set role '+role);await assert.rejects(context(),/permission denied/)}
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");await db.exec('set role authenticated');await assert.rejects(context(),/Sign in/);await auth();
 });
 await serialSubtest(t,'changes in every included table invalidate context, including non-financial settings/client/reminder edits',async()=>{
  let previous=(await context()).stamp;
  for(const [sql,args] of [
   ["update user_settings set legal_name='Changed owner' where id=$1",[owner]],
   ["update clients set name='Changed client' where id=$1",[client]],
   ["update invoices set amount=121 where id=$1",[invoice]],
   ["update financial_records set amount=31 where id=$1",[record]],
   ["update invoice_reminders set status='skipped' where id=$1",[reminder]],
  ] as const){await db.query(sql,[...args]);const current=(await context()).stamp;assert.notEqual(current,previous);previous=current;}
  await db.exec('reset role');await db.query("insert into invoice_revisions(id,user_id,invoice_id,version,snapshot,author) values($1,$2,$3,0,'{}',$2)",[revision,owner,invoice]);await auth();assert.notEqual((await context()).stamp,previous);assert.equal((await context()).counts.invoiceRevisions,1);
 });
 await serialSubtest(t,'SQL context and application allowlists stay equal without secret/path/snapshot columns',async()=>{
  const sql=await readFile(new URL(name,dir),'utf8');
  for(const [key,fields] of Object.entries(ACCOUNT_EXPORT_FIELDS)){
   const table=ACCOUNT_EXPORT_TABLES[key as keyof typeof ACCOUNT_EXPORT_TABLES];const match=sql.match(new RegExp('select ([a-z0-9_,]+) from public\\.'+table+' where'))!;
   assert.ok(match,table);assert.deepEqual(match[1].split(','),fields);
   await db.query('select '+fields.join(',')+' from '+table+' where '+(key==='settings'?'id':'user_id')+'=$1',[owner]);
  }
  assert.doesNotMatch(sql,/companies_house_api_key|bank_details|pdf_path|source_snapshot|provider_message_id/);
 });
});

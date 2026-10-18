import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID,randomBytes } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { syntheticRefundSplit } from './refund-split-fixture';
import { parseFinancialReview } from '../records/financial-review';
test('atomic financial review covers full counts, signed money, samples and service-only operational capture',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../../supabase/migrations/',import.meta.url),migration='20261018180000_financial_review_coverage.sql';
 for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<migration).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 const owner=randomUUID(),other=randomUUID(),client=randomUUID(),invoice=randomUUID(),legacy=randomUUID();
 await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);await db.query("insert into clients(id,user_id,name) values($1,$2,'PRIVATE_CLIENT')",[client,owner]);
 await db.query("insert into invoices(id,user_id,client_id,number,description,amount,status,due_date,paid_at,delivery_status) values($1,$2,$3,'PRIVATE_REFERENCE','PRIVATE_DESCRIPTION',120,'finalised','2026-10-01',now(),'paid')",[invoice,owner,client]);
 for(let n=0;n<25;n++)await db.query("insert into financial_records(user_id,record_type,record_date,description,amount,effect_sign,status) values($1,'income','2026-10-06','PRIVATE_RECORD',10,$2,'approved')",[owner,1]);
 const account=(await db.query<{id:string}>("insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values($1,'Synthetic source','generic','bank','1234') returning id",[owner])).rows[0].id;
 const attempt=randomUUID(),path=owner+'/'+attempt+'.enc';
 await db.query("insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values($1,$2,$3,$4,$5,'synthetic',100,'uploaded')",[attempt,owner,account,randomBytes(32).toString('hex'),path]);
 await db.query("insert into storage.objects(bucket_id,name) values('source-evidence',$1)",[path]);
 const imported=(await db.query<{r:{import_id:string}}>("select ingest_source_csv($1,$2,'synthetic-review.csv','mapped-csv/1','{}',$3::jsonb) r",[owner,attempt,JSON.stringify([1000,-1000,5000,-3000].map((signed_pence,n)=>({row_number:n+2,row_hash:randomBytes(32).toString('hex'),raw_encrypted:'synthetic',date:'2026-10-06',signed_pence,currency:'GBP',description:'PRIVATE_SOURCE',reference:'PRIVATE_REFERENCE',fingerprint:randomBytes(32).toString('hex')})))])).rows[0].r;
 const tx=(await db.query<{id:string}>("select t.id from bank_transactions t join source_rows s on s.id=t.source_row_id where t.import_id=$1 order by s.row_number",[imported.import_id])).rows;
 const income=(await db.query<{id:string}>("select id from record_categories where is_default and record_type='income' limit 1")).rows[0].id;
 const expense=(await db.query<{id:string}>("select id from record_categories where is_default and record_type='expense' limit 1")).rows[0].id;
 await auth();await db.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic original review')",[tx[0].id,income]);
 await syntheticRefundSplit(db,tx[1].id,[[tx[0].id,1000]]);
 await db.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic initial review')",[tx[3].id,expense]);
 await db.query("select review_bank_transaction($1,1,'Personal',null,0,'Synthetic personal exclusion')",[tx[3].id]);
 await db.exec('reset role');
 await db.query("insert into quarterly_readiness_checks(id,user_id,tax_year_start,tax_quarter,status,notes) values($1,$2,2026,2,'ok','Historical all clear')",[legacy,owner]);
 const before=(await db.query<{r:unknown}>('select to_jsonb(c) r from quarterly_readiness_checks c where id=$1',[legacy])).rows[0].r;
 await db.exec(await readFile(new URL(migration,dir),'utf8'));
 async function auth(id=owner){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
 async function read(id=owner){await auth(id);const raw=(await db.query<{r:unknown}>("select read_financial_review(2026,'2026-10-18') r")).rows[0].r;return{raw,safe:parseFinancialReview(id,2026,'2026-10-18',raw)}}
 await serialSubtest(t,'full signed totals differ from explicit bounded samples and manual paid markers remain cash-unproven',async()=>{
  const {raw,safe}=await read();assert.equal(safe.approved_count,27);assert.equal(safe.recent_records.length,20);assert.equal(safe.quarters[2].income_pence,25000);assert.equal(safe.quarters[2].net_pence,25000);assert.equal(safe.native_overdue_count,1);assert.equal(safe.overdue_invoices[0].outstanding_pence,12000);assert.equal(safe.overdue_invoices[0].manual_paid_marker,true);assert.doesNotMatch(JSON.stringify(raw),/PRIVATE_/);assert.equal(safe.unresolved_source_count,1);assert.equal(safe.source_count,4);
  const row=(await db.query<{r:unknown}>('select to_jsonb(c)-$2::text[] r from quarterly_readiness_checks c where id=$1',[legacy,['coverage_version','source_stamp','external_invoice_count','unresolved_source_count','checked_as_of']])).rows[0].r;assert.deepEqual(row,before);
 });
 await serialSubtest(t,'owner/private/service grants and invalid date scopes fail before capture',async()=>{
  const otherReview=await read(other);assert.equal(otherReview.safe.approved_count,0);assert.equal(otherReview.safe.invoice_groups.length,0);
  await auth();await assert.rejects(db.query("select read_financial_review(2025,'2026-10-18')"));await assert.rejects(db.query("select financial_review_catalog($1,2026,'2026-10-18')",[owner]),/permission denied/);await assert.rejects(db.query("select capture_quarter_readiness($1,2026,3,'2026-10-18')",[owner]),/permission denied/);
  await db.exec('reset role;set role anon');await assert.rejects(db.query("select read_financial_review(2026,'2026-10-18')"),/permission denied/);
 });
 await serialSubtest(t,'unresolved source coverage persists without changing the underlying catalog token',async()=>{
  const previous=(await read()).safe.stamp;await db.exec('reset role;set role service_role');
  await db.query("select capture_quarter_readiness($1,2026,3,'2026-10-18')",[owner]);
  const row=(await db.query<{unresolved_source_count:number;status:string}>('select unresolved_source_count,status from quarterly_readiness_checks where user_id=$1 and tax_quarter=3',[owner])).rows[0];assert.equal(row.unresolved_source_count,1);assert.equal(row.status,'needs_attention');assert.equal((await read()).safe.stamp,previous);
 });
 await serialSubtest(t,'known excluded duplicates and personal interpretations do not become unresolved sources',async()=>{
  await db.exec('reset role');await db.query("update bank_transactions set dedupe_status='duplicate' where id=$1",[tx[2].id]);
  assert.equal((await read()).safe.unresolved_source_count,0);
 });
 await serialSubtest(t,'manual drafts are unfinished interpretations even without imported source rows',async()=>{
  await db.exec('reset role');await db.query("insert into financial_records(user_id,record_type,record_date,description,amount,status) values($1,'expense','2026-10-06','Synthetic unfinished manual draft',1,'draft')",[owner]);
  const r=(await read()).safe;assert.equal(r.review_count,1);assert.equal(r.quarters[2].review_count,1);
 });
 await serialSubtest(t,'service capture derives counts and status, cannot turn no activity into all clear, and retains coverage',async()=>{
  await db.exec('reset role;set role service_role');await db.query("select capture_quarter_readiness($1,2026,3,'2026-10-18')",[owner]);
  const row=(await db.query<{status:string;overdue_invoice_count:number;external_invoice_count:number;coverage_version:string}>('select * from quarterly_readiness_checks where user_id=$1 and tax_quarter=3',[owner])).rows[0];assert.equal(row.status,'needs_attention');assert.equal(row.overdue_invoice_count,1);assert.equal(row.external_invoice_count,0);assert.equal(row.coverage_version,'vibecount.financial-review/1');
  await db.query("select capture_quarter_readiness($1,2026,3,'2026-10-18')",[other]);assert.equal((await db.query<{status:string}>('select status from quarterly_readiness_checks where user_id=$1',[other])).rows[0].status,'needs_attention');
 });
});

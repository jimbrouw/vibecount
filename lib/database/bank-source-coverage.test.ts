import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {TEST_SCHEMA_BOOTSTRAP} from './test-schema';
import {serialSubtest} from './serial-subtest';
import {bankValuationFixture,openSyntheticForeignAdmission} from './bank-valuation-fixture';
import {parseBankSourceCoverage} from '../records/bank-source-coverage';
import {fxConversionLotFixture} from './fx-lot-fixture';
import {rateFromDecimal} from '../fx/currency';

test('complete bank coverage counts every currency/valuation state while native decisions retain guarded request recovery',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../../supabase/migrations/',import.meta.url),target='20261019100000_bank_source_coverage.sql';
 for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<target).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 const native=await fxConversionLotFixture(db);await db.exec('reset role');
 const oldBank=(await db.query<{r:unknown}>('select to_jsonb(t) r from bank_transactions t where id=$1',[native.tx])).rows[0].r;
 const oids=(await db.query("select oid,proacl from pg_proc where pronamespace='public'::regnamespace and proname in('review_bank_transaction_v1','save_merchant_rule','approve_merchant_batch','review_tax_inputs','ingest_source_csv','ingest_source_csv_v20_base') order by oid")).rows;
 const records=(await db.query<{r:unknown}>('select to_jsonb(f) r from financial_records f order by id')).rows;
 await db.exec(await readFile(new URL(target,dir),'utf8'));
 assert.deepEqual((await db.query("select oid,proacl from pg_proc where pronamespace='public'::regnamespace and proname in('review_bank_transaction_v1','save_merchant_rule','approve_merchant_batch','review_tax_inputs','ingest_source_csv','ingest_source_csv_v20_base') order by oid")).rows,oids);
 assert.deepEqual((await db.query<{r:unknown}>('select to_jsonb(t) r from bank_transactions t where id=$1',[native.tx])).rows[0].r,oldBank);
 const read=async(owner:string)=>parseBankSourceCoverage((await db.query<{r:unknown}>('select bank_source_coverage_for_owner($1) r',[owner])).rows[0].r,owner);
 await serialSubtest(t,'native source bytes, function identities/grants and recognised effects remain unchanged',async()=>{
  const c=await read(native.f.owner);assert.equal(c.counts.native_observations,1);assert.equal(c.counts.active_blocked_observations,0);assert.equal(c.observations[0].valuation_status,'not_applicable');
  assert.deepEqual((await db.query<{r:unknown}>('select to_jsonb(f) r from financial_records f order by id')).rows,records);
  await native.f.auth();const changed=(await db.query<{r:unknown}>("select review_bank_transaction($1,1,'Business',$2,10000,'Same native review') r",[native.tx,(await db.query<{id:string}>("select id from record_categories where record_type='income' and is_default limit 1")).rows[0].id])).rows[0].r;assert.ok(changed);
  await assert.rejects(db.query("insert into financial_records(user_id,bank_transaction_id,record_type,record_date,description,amount,source_type,status) values($1,$2,'income','2026-04-06','Unreviewed direct write',1,'csv','approved')",[native.f.owner,native.tx]),/reviewed classification/);
  await db.exec('reset role');
 });
 await openSyntheticForeignAdmission(db);const f=await bankValuationFixture(db);
 let priorStamp='';
 await serialSubtest(t,'raw observations appear even when native positive cash views omit every foreign row',async()=>{
  const c=await read(f.owner);assert.equal(c.counts.observations,1);assert.equal(c.counts.foreign_observations,1);assert.equal(c.counts.foreign_accounts,1);assert.equal(c.counts.active_blocked_observations,1);
  assert.equal(c.observations[0].valuation_status,'unvalued');assert.equal(c.observations[0].signed_amount_pence,null);assert.equal(c.observations[0].original_signed_minor,'-10001');priorStamp=c.stamp;
  assert.equal((await db.query('select id from receipt_allocation_balances where user_id=$1',[f.owner])).rows.length,0);
  assert.doesNotMatch(JSON.stringify(c),/object_path|key_id|raw_encrypted|Synthetic foreign observation|1234/);
 });
 await serialSubtest(t,'provisional, reviewed zero, stale and withdrawn heads stay explicit and change the complete source stamp',async()=>{
  let saved=await f.record(await f.intent({state:'provisional',human_read_original:false}));let c=await read(f.owner);assert.equal(c.observations[0].valuation_status,'provisional');assert.notEqual(c.stamp,priorStamp);
  saved=await f.record(await f.intent({expected_ordinal:1,data:{method:'documented_rate/1',rate:rateFromDecimal('KWD','GBP','0.00001'),valuation_date:'2026-04-06',evidence_date:'2026-04-07'}}));c=await read(f.owner);assert.equal(c.counts.reviewed_zero_observations,1);assert.equal(c.observations[0].valuation!.signed_gbp_pence,'0');assert.equal(c.counts.active_blocked_observations,1);priorStamp=c.stamp;
  await db.query('delete from storage.objects where name=$1',[f.documentPath]);c=await read(f.owner);assert.equal(c.observations[0].valuation_status,'stale');assert.equal(c.counts.reviewed_zero_observations,0);assert.notEqual(c.stamp,priorStamp);
  await f.record(await f.intent({expected_ordinal:2,state:'withdrawn',document_id:null,transaction_version:null,data:null,human_read_original:false}));c=await read(f.owner);assert.equal(c.observations[0].valuation_status,'withdrawn');assert.ok(saved);
  await db.query("update record_imports set status='discarded' where id=$1",[f.imported]);c=await read(f.owner);assert.equal(c.counts.observations,1);assert.equal(c.counts.active_blocked_observations,0);assert.equal(c.counts.foreign_accounts,1);
 });
 await serialSubtest(t,'legacy native classifications, direct approved postings, currency rewrites and merchant seed rules cannot accept foreign units',async()=>{
  const g=await bankValuationFixture(db,'USD','1.25');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[g.owner]);await db.exec('set role authenticated');
  await assert.rejects(db.query("select review_bank_transaction($1,0,'Personal',null,0,'Unsupported currency')",[g.transaction]),/actual GBP/);
  const category=(await db.query<{id:string}>("select id from record_categories where record_type='income' and is_default limit 1")).rows[0].id;
  const definition={seed_id:g.transaction,account_id:g.account,tax_year_start:2025,effective_from:'2025-04-06',expires_on:null,classification:'Business',business_use_bps:10000,category_id:category,priority:50,status:'active',evidence_status:'provisional'};
  await assert.rejects(db.query("select save_merchant_rule(null,0,$1,reconciliation_export_stamp(),'Foreign seed guard',$2)",[JSON.stringify(definition),randomUUID()]),/actual GBP/);
  const entry={transaction_id:g.transaction,version:0,origin:'manual',rule_version_id:null,classification:'Business',business_use_bps:10000,category_id:category,document_ids:[],evidence_status:'missing'};
  await assert.rejects(db.query("select approve_merchant_batch($1,reconciliation_export_stamp(),'Foreign batch guard',$2)",[JSON.stringify([entry]),randomUUID()]),/actual GBP/);
  const fact={action:'fact',family_id:null,expected_ordinal:0,kind:'trade_adjustment',label:'Foreign source guard',data:{adjustment_type:'add_back',amount_pence:1,treatment:'evidence_reviewed'},state:'verified',document_ids:[],transaction_ids:[g.transaction],record_ids:[]};
  await assert.rejects(db.query("select review_tax_inputs(2025,$1,tax_review_stamp(2025),'Foreign tax source guard',$2)",[JSON.stringify(fact),randomUUID()]),/actual GBP/);
  for(const table of ['merchant_rules','merchant_rule_versions','merchant_requests','merchant_review_batches','classification_decisions','tax_fact_families','tax_fact_revisions'])assert.equal((await db.query('select 1 from '+table+' where user_id=$1',[g.owner])).rows.length,0);
  await db.exec('reset role');await assert.rejects(db.query("insert into financial_records(user_id,bank_transaction_id,record_type,record_date,description,amount,source_type,status) values($1,$2,'income','2026-04-05','No inferred GBP',1,'csv','approved')",[g.owner,g.transaction]),/actual GBP/);
  await assert.rejects(db.query("update bank_transactions set classification='Personal' where id=$1",[g.transaction]),/actual GBP/);
  await assert.rejects(db.query("update financial_accounts set currency='EUR' where id=$1",[g.account]),/original currency/);
  assert.equal((await db.query('select id from financial_records where bank_transaction_id=$1',[g.transaction])).rows.length,0);
  const c=await read(g.owner);assert.equal(c.counts.active_blocked_observations,1);
 });
 await serialSubtest(t,'linked legacy foreign tax records cannot bypass source eligibility',async()=>{
  const g=await bankValuationFixture(db,'USD','2.50');await db.exec('begin');
  try{
   // Simulate a retained pre-guard row only inside this rolled-back fixture.
   await db.exec('alter table financial_records disable trigger native_bank_posting_fence');
   const record=(await db.query<{id:string}>("insert into financial_records(user_id,bank_transaction_id,record_type,record_date,description,amount,source_type,status) values($1,$2,'income','2026-04-05','Synthetic legacy foreign effect',1,'csv','approved') returning id",[g.owner,g.transaction])).rows[0].id;
   await db.exec('alter table financial_records enable trigger native_bank_posting_fence');
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[g.owner]);await db.exec('set role authenticated');
   const fact={action:'fact',family_id:null,expected_ordinal:0,kind:'trade_adjustment',label:'Legacy linked record guard',data:{adjustment_type:'add_back',amount_pence:1,treatment:'evidence_reviewed'},state:'verified',document_ids:[],transaction_ids:[],record_ids:[record]};
   await assert.rejects(db.query("select review_tax_inputs(2025,$1,tax_review_stamp(2025),'Linked foreign source guard',$2)",[JSON.stringify(fact),randomUUID()]),/actual GBP/);
  }finally{await db.exec('rollback;reset role')}
  assert.equal((await db.query('select 1 from financial_records where user_id=$1',[g.owner])).rows.length,0);
 });
 await serialSubtest(t,'native ingestion rejects fresh foreign accounts but recovers retained native imports before missing objects',async()=>{
  const g=await bankValuationFixture(db,'USD','3.25'),attempt=randomUUID(),path='SYNTHETIC/'+attempt+'.enc',hash='c'.repeat(64);
  await db.query("insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values($1,$2,$3,$4,$5,'synthetic',100,'uploaded')",[attempt,g.owner,g.account,hash,path]);
  await db.query("insert into storage.objects(bucket_id,name) values('source-evidence',$1)",[path]);
  const rows=[{row_number:2,row_hash:'d'.repeat(64),raw_encrypted:'SYNTHETIC',date:'2026-04-06',signed_pence:125,currency:'GBP',description:'Native row on foreign account',reference:'',fingerprint:'e'.repeat(64)}];
  await db.exec('set role service_role');await assert.rejects(db.query("select ingest_source_csv($1,$2,'synthetic.csv','mapped-csv/1','{}',$3)",[g.owner,attempt,JSON.stringify(rows)]),/Native CSV registration requires a GBP account/);await db.exec('reset role');
  assert.equal((await db.query('select 1 from record_imports where user_id=$1 and file_hash=$2',[g.owner,hash])).rows.length,0);
  const source=(await db.query<{account_id:string;file_hash:string;import_id:string;object_path:string}>('select t.account_id,i.file_hash,i.id import_id,f.object_path from bank_transactions t join record_imports i on i.id=t.import_id join record_source_files f on f.id=i.source_file_id where t.id=$1',[native.tx])).rows[0];
  const retry=randomUUID();await db.query("insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values($1,$2,$3,$4,$5,'synthetic',100,'uploaded')",[retry,native.f.owner,source.account_id,source.file_hash,'SYNTHETIC/'+retry+'.enc']);
  await db.query("delete from storage.objects where bucket_id='source-evidence' and name=$1",[source.object_path]);
  const before=(await db.query('select id from financial_records where user_id=$1 order by id',[native.f.owner])).rows;
  await native.f.service();const recovered=(await db.query<{r:unknown}>("select ingest_source_csv($1,$2,'synthetic.csv','mapped-csv/1','{}',$3) r",[native.f.owner,retry,JSON.stringify(rows)])).rows[0].r;await db.exec('reset role');
  assert.deepEqual(recovered,{import_id:source.import_id,created:false,transactions:0});assert.deepEqual((await db.query('select id from financial_records where user_id=$1 order by id',[native.f.owner])).rows,before);
 });
 await serialSubtest(t,'owner-only public reader and private helpers deny anonymous/service/cross-owner scope',async()=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.other]);await db.exec('set role authenticated');const c=parseBankSourceCoverage((await db.query<{r:unknown}>('select read_bank_source_coverage() r')).rows[0].r,f.other);assert.equal(c.counts.observations,0);
  for(const role of ['authenticated','anon','service_role']){
   await db.exec('reset role;set role '+role);await assert.rejects(db.query('select bank_source_coverage_for_owner($1)',[f.owner]),/permission denied/);await assert.rejects(db.query('select assert_native_bank_scope($1,$2)',[f.owner,[f.transaction]]),/permission denied/);
   if(role!=='authenticated')await assert.rejects(db.query('select read_bank_source_coverage()'),/permission denied/);
  }
  await db.exec('reset role');
 });
});

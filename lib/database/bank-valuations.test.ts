import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { bankValuationFixture, openSyntheticForeignAdmission } from './bank-valuation-fixture';
import { parseBankValuationRevision } from '../records/bank-valuation';
import { convertCurrencyMinor, rateFromDecimal } from '../fx/currency';
import { decryptSource, sourceContext, documentContext } from '../records/source-crypto';
import { fxConversionLotFixture } from './fx-lot-fixture';

test('private bank valuation persistence preserves GBP admission and closes exact foreign source history', async t => {
 const db = new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir = new URL('../../supabase/migrations/',import.meta.url), migration='20261019090000_private_bank_valuations.sql';
 for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<migration).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 const native=await fxConversionLotFixture(db);await db.exec('reset role');
 const nativeBefore=(await db.query<{r:unknown}>('select to_jsonb(t) r from bank_transactions t where id=$1',[native.tx])).rows[0].r;
 const recordsBefore=(await db.query<{r:unknown}>('select to_jsonb(f) r from financial_records f order by id')).rows;
 const coreFunctions=async()=> (await db.query("select oid,proacl,pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace and proname in('approve_fx_invoice_allocations','reverse_fx_conversion_lot','review_bank_transaction','ingest_source_csv') order by oid")).rows;
 const coresBefore=await coreFunctions();
 const owner=randomUUID(),account=randomUUID();await db.query('insert into auth.users values($1)',[owner]);
 await db.query("insert into financial_accounts(id,user_id,label,provider,account_type,masked_identifier) values($1,$2,'Native parity','starling','bank','1234')",[account,owner]);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
 const before=(await db.query<{s:string}>('select reconciliation_export_stamp() s')).rows[0].s,
  guard=(await db.query<{id:number}>("select 'protect_transaction_source()'::regprocedure::oid id")).rows[0].id;
 await db.exec(await readFile(new URL(migration,dir),'utf8'));
 assert.equal((await db.query<{s:string}>('select reconciliation_export_stamp() s')).rows[0].s,before);
 assert.equal((await db.query<{id:number}>("select 'protect_transaction_source()'::regprocedure::oid id")).rows[0].id,guard);
 assert.deepEqual((await db.query<{r:unknown}>("select to_jsonb(t)-'original_signed_minor'-'source_units_ruleset' r from bank_transactions t where id=$1",[native.tx])).rows[0].r,nativeBefore);
 assert.deepEqual((await db.query<{r:unknown}>('select to_jsonb(f) r from financial_records f order by id')).rows,recordsBefore);
 assert.deepEqual(await coreFunctions(),coresBefore);
 await assert.rejects(db.query("insert into financial_accounts(user_id,label,provider,account_type,currency,masked_identifier) values($1,'Not enabled','generic','bank','USD','1234')",[owner]),/currency_check/);
 const closed=(await db.query<{yes:boolean}>("select attnotnull yes from pg_attribute where attrelid='bank_transactions'::regclass and attname='signed_amount_pence'")).rows[0].yes;assert.equal(closed,true);
 // Only this disposable fixture opens predecessor admission guards; application migration does not.
 await openSyntheticForeignAdmission(db);const f=await bankValuationFixture(db);
 let intent=await f.intent(),saved:ReturnType<typeof parseBankValuationRevision>;
 const counts=async()=> (await db.query<{n:string}>("select (select count(*) from financial_records)::text||':'||(select count(*) from invoice_settlements)::text||':'||(select count(*) from settlement_requests)::text||':'||(select count(*) from classification_decisions)::text n")).rows[0].n;
 const effects=await counts();
 await serialSubtest(t,'review derives signed exact GBP including separate dates and encrypted source provenance without financial effects',async()=>{
  saved=parseBankValuationRevision(f.owner,await f.record(intent));assert.equal(saved.signed_gbp_pence,-2500);
  assert.deepEqual(saved.conversion,convertCurrencyMinor(-10001,rateFromDecimal('KWD','GBP','2.5')));
  assert.equal(saved.source_snapshot.economic_source.cash_date,'2026-04-05');assert.equal(saved.data.valuation_date,'2026-04-06');
  assert.equal(saved.source_snapshot.document_source.registration.purpose,'other');assert.equal(saved.source_snapshot.economic_source.row_sha256.length,64);
  assert.deepEqual(decryptSource(f.cipher,f.key,sourceContext(f.owner,f.account,f.hash)),f.sourceBytes);
  assert.deepEqual(decryptSource(f.rawCipher,f.key,sourceContext(f.owner,f.account,f.hash,2)),f.raw);
  assert.deepEqual(decryptSource(f.documentCipher,f.key,documentContext(f.owner,f.documentHash)),f.documentBytes);
  assert.deepEqual(await f.record(intent),await f.record(intent));assert.equal(await counts(),effects);
  assert.equal((await db.query<{r:boolean}>('select bank_valuation_source_current($1,$2) r',[f.owner,saved.id])).rows[0].r,true);
  assert.doesNotMatch(JSON.stringify(saved),/object_path|key_id|raw_encrypted|Synthetic foreign observation/);
 });
 await serialSubtest(t,'fresh version/current sources and full owner/account/import/row/currency closure are mandatory',async()=>{
  await assert.rejects(f.record(await f.intent({expected_ordinal:1,transaction_version:1})),/decision version/);
  await assert.rejects(f.record(await f.intent({expected_ordinal:1,expected_stamp:'0'.repeat(32)})),/changed/);
  const otherStamp=(await db.query<{s:string}>('select bank_valuation_review_stamp($1) s',[f.other])).rows[0].s;
  await assert.rejects(f.record(await f.intent({expected_ordinal:0,expected_stamp:otherStamp}),f.other),/owned dimensioned/);
  await assert.rejects(f.record({...intent,request_id:randomUUID(),expected_ordinal:0,expected_stamp:await f.stamp()}),/revision changed/);
  await db.exec('begin');try{
   await db.query("update financial_accounts set currency='USD' where id=$1",[f.account]);
   await assert.rejects(f.record(await f.intent({expected_ordinal:1,data:{...intent.data,rate:rateFromDecimal('USD','GBP','2.5')}})),/source closure/);
  }finally{await db.exec('rollback');}
  const second=await bankValuationFixture(db,'USD','1.25',f.owner);
  await db.exec('begin');try{
   // The old FKs allow a same-owner source row on a different import; valuation must reject that closure.
   await db.exec('alter table bank_transactions disable trigger immutable_transaction_source');
   await db.query('update bank_transactions set import_id=$1 where id=$2',[second.imported,f.transaction]);
   await assert.rejects(f.record(await f.intent({expected_ordinal:1})),/source closure/);
  }finally{await db.exec('rollback');}
  assert.equal(await counts(),effects);
 });
 await serialSubtest(t,'privileged forged revisions and orphan requests cannot bypass static/deferred history closure',async()=>{
  const fresh={...saved,id:randomUUID(),request_id:randomUUID(),ordinal:2,previous_revision_id:saved.id,reviewed_stamp:await f.stamp()};
  for(const patch of [{signed_gbp_pence:1},{source_snapshot:{...saved.source_snapshot,economic_source:{...saved.source_snapshot.economic_source,row_sha256:'a'.repeat(64)}}},
   {conversion:{...saved.conversion,target_minor:1}},{data:{...saved.data,rate:rateFromDecimal('USD','GBP','2.5')}},
   {previous_revision_id:null},{transaction_version:10}]){
   await assert.rejects(db.query('insert into bank_valuation_revisions select(jsonb_populate_record(null::bank_valuation_revisions,$1)).*',[JSON.stringify({...fresh,...patch})]),/differs|closure|rate must match/);
  }
  await assert.rejects(db.query('insert into bank_valuation_revisions select(jsonb_populate_record(null::bank_valuation_revisions,$1)).*',[JSON.stringify(fresh)]),/Complete valuation|foreign key/);
  const orphan=await f.intent({expected_ordinal:1});
  await assert.rejects(db.query('insert into bank_valuation_requests(user_id,request_id,intent,result) values($1,$2,$3,$4)',[f.owner,orphan.request_id,JSON.stringify(orphan),JSON.stringify(saved)]),/Complete valuation/);
  assert.equal((await db.query('select id from bank_valuation_revisions where user_id=$1',[f.owner])).rows.length,1);
 });
 await serialSubtest(t,'review cannot supersede valuation while a recognised accounting effect is still approved',async()=>{
  await db.exec('begin');try{
   await db.query("insert into financial_records(user_id,bank_transaction_id,record_type,record_date,description,amount,source_type,status) values($1,$2,'expense','2026-04-05','Synthetic dependency',25,'csv','approved')",[f.owner,f.transaction]);
   await assert.rejects(f.record(await f.intent({expected_ordinal:1})),/dependent financial/);
  }finally{await db.exec('rollback');}
  assert.equal(await counts(),effects);
 });
 await serialSubtest(t,'successors retain predecessor and reviewed zero is distinct from missing while old intent retries remain exact',async()=>{
  const next=await f.intent({expected_ordinal:1,data:{...intent.data,rate:rateFromDecimal('KWD','GBP','0.00001')}});
  const zero=parseBankValuationRevision(f.owner,await f.record(next));assert.equal(zero.signed_gbp_pence,0);assert.equal(zero.previous_revision_id,saved.id);
  assert.equal(zero.source_snapshot.economic_source.original_signed_minor,-10001);assert.equal(await counts(),effects);
  assert.equal((await db.query<{r:boolean}>('select bank_valuation_source_current($1,$2) r',[f.owner,saved.id])).rows[0].r,false);
  assert.deepEqual(parseBankValuationRevision(f.owner,await f.record(intent)),saved);
  await db.query('update bank_transactions set decision_version=decision_version+1 where id=$1',[f.transaction]);
  assert.equal((await db.query<{r:boolean}>('select bank_valuation_source_current($1,$2) r',[f.owner,zero.id])).rows[0].r,true,'future posting version increments do not rewrite economic valuation');
  saved=zero;intent=next;
 });
 await serialSubtest(t,'retained exact retries and withdrawal survive source loss without claiming fresh evidence',async()=>{
  await db.query("delete from storage.objects where name in($1,$2)",[f.path,f.documentPath]);
  assert.deepEqual(parseBankValuationRevision(f.owner,await f.record(intent)),saved);
  assert.equal((await db.query<{r:boolean}>('select bank_valuation_source_current($1,$2) r',[f.owner,saved.id])).rows[0].r,false);
  await assert.rejects(f.record(await f.intent({expected_ordinal:2,transaction_version:1})),/source closure/);
  const withdrawn=parseBankValuationRevision(f.owner,await f.record(await f.intent({expected_ordinal:2,state:'withdrawn',transaction_version:null,document_id:null,data:null,human_read_original:false})));
  assert.equal(withdrawn.state,'withdrawn');assert.deepEqual(withdrawn.source_snapshot,saved.source_snapshot);assert.deepEqual(withdrawn.conversion,saved.conversion);
  assert.equal(withdrawn.previous_revision_id,saved.id);assert.equal(await counts(),effects);
  await assert.rejects(f.record({...intent,rationale:'Changed retained request'}),/request changed/);
 });
 await serialSubtest(t,'owner reads, immutable history, direct writes and all private RPC grants fail closed',async()=>{
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.owner]);await db.exec('set role '+role);
   await assert.rejects(db.query('select record_bank_valuation($1,$2)',[f.owner,JSON.stringify(intent)]),/permission denied/);
   await assert.rejects(db.query('select bank_valuation_review_stamp($1)',[f.owner]),/permission denied/);
   await assert.rejects(db.query('insert into bank_valuation_revisions default values'),/permission denied/);
   await assert.rejects(db.query('insert into bank_valuation_requests default values'),/permission denied/);
   await assert.rejects(db.query('insert into bank_valuation_families default values'),/permission denied/);
   assert.equal((await db.query<{n:number}>("select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and proname like '%bank_valuation%' and has_function_privilege(current_user,oid,'EXECUTE')")).rows[0].n,0,'All private helpers, not only the writer, remain inaccessible.');
   if(role==='anon')await assert.rejects(db.query('select * from bank_valuation_revisions'),/permission denied/);
  }
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.other]);await db.exec('set role authenticated');
  assert.equal((await db.query('select id from bank_valuation_revisions')).rows.length,0);
  await db.exec('reset role');await assert.rejects(db.query('update bank_valuation_revisions set signed_gbp_pence=1 where id=$1',[saved.id]),/immutable/);
  await assert.rejects(db.query('update bank_transactions set original_signed_minor=1 where id=$1',[f.transaction]),/immutable/);
  await assert.rejects(db.query('delete from bank_valuation_requests'),/immutable/);
 });
});

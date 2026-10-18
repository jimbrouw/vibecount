import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { fxConversionLotFixture } from './fx-lot-fixture';
import { serialSubtest } from './serial-subtest';
import { parseFxSettlementCatalog } from '../fx/settlement-catalog';
import { validateFxSettlementIntent } from '../fx/settlement';
import { checkSettlementSources } from '../fx/settlement-source';
import { parseFxReviewedRequest,parseFxReviewedResult } from '../fx/reviewed-request';
import { rateFromDecimal } from '../fx/currency';

test('durable reviewed FX request prepares without effects, commits exact proof and recovers complete reversal after source loss',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../../supabase/migrations/',import.meta.url),migration='20261019080000_reviewed_fx_requests.sql';
 for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<migration).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 const x=await fxConversionLotFixture(db),{f}=x;
 const catalog=async()=>{await f.auth();return parseFxSettlementCatalog(f.owner,(await db.query<{r:unknown}>('select read_fx_settlement_catalog() r')).rows[0].r)};
 const c=await catalog(),parent=c.evidence.facts.find(r=>r.id===x.intent.source_fact_revision_id)!,conversion=c.evidence.facts.find(r=>r.id===x.conversion)!;
 let intent=validateFxSettlementIntent({schema_version:'fx-settlement-intent/1',ruleset_id:c.ruleset_id,receipt_id:x.tx,receipt_version:1,expected_stamp:c.financial_stamp,rationale:'Synthetic durable reviewed FX request',request_id:randomUUID(),fee_mode:'none',receipt_valuation_id:null,receipt_valuation_evidence_revision_id:null,allocations:[{invoice_id:x.intent.invoice_id,invoice_revision_id:(x.saved as {revision_id:string}).revision_id,invoice_minor:1,cash_minor:0,conversion_date:'2026-04-06',rate:rateFromDecimal('KWD','GBP','2.5'),invoice_evidence_id:parent.family_id,invoice_evidence_revision_id:parent.id,conversion_evidence_id:conversion.family_id,conversion_evidence_revision_id:conversion.id,conversion_lot_id:x.lot,conversion_lot_version:0}]});
 await db.exec('reset role');const records=(await db.query('select to_jsonb(r) r from financial_records r order by id')).rows,oids=(await db.query("select oid::text from pg_proc where oid in('approve_fx_invoice_allocations(jsonb)'::regprocedure,'reverse_fx_conversion_lot(uuid,text,text,uuid)'::regprocedure) order by oid")).rows;
 await db.exec(await readFile(new URL(migration,dir),'utf8'));
 const prepare=async(kind:string,i:unknown,confirmed:boolean|null=true)=>{await f.auth();return(await db.query<{r:unknown}>('select prepare_fx_reviewed_request($1,$2,$3) r',[kind,JSON.stringify(i),confirmed])).rows[0].r};
 const read=async(id:string)=>{await f.auth();return parseFxReviewedRequest(f.owner,(await db.query<{r:unknown}>('select read_fx_reviewed_request($1) r',[id])).rows[0].r)};
 const commit=async(id:string,confirmed:boolean|null=true)=>{await f.auth();return(await db.query<{r:unknown}>('select commit_fx_reviewed_request($1,$2) r',[id,confirmed])).rows[0].r};
 const cancel=async(id:string)=>{await f.auth();return(await db.query<{r:unknown}>('select cancel_fx_reviewed_request($1,true) r',[id])).rows[0].r};
 const proof=async(i:typeof intent)=>checkSettlementSources(f.owner,i,{recover:async(request)=>{await f.auth();return(await db.query<{r:unknown}>('select to_jsonb(c) r from fx_settlement_source_checks c where request_id=$1',[request])).rows[0]?.r??null},catalog,metadata:async()=>f.metadata,key:()=>Buffer.from(f.key),download:async()=>f.cipher,record:async(input,sources,outcome)=>{await f.service();return(await db.query<{r:unknown}>('select record_fx_settlement_source_check($1,$2,$3,$4) r',[f.owner,JSON.stringify(input),JSON.stringify(sources),outcome])).rows[0].r}});
 let allocated:unknown,undo:{schema_version:string;lot_id:string;lot_version:number;expected_stamp:string;rationale:string;request_id:string},reversed:unknown;
 await serialSubtest(t,'preparation freezes exact safe review with no financial/proof/lot effects; retry and pending lock retain identity',async()=>{
  for(const confirmation of [false,null])await assert.rejects(prepare('allocate',intent,confirmation),/confirm/);
  const saved=await prepare('allocate',intent),r=await read(intent.request_id);assert.equal(r.state,'prepared');assert.equal(r.review.kind,'allocate');assert.equal(r.review.receipt.signed_cash_pence,2501);assert.deepEqual(await prepare('allocate',intent),saved);
  await assert.rejects(prepare('allocate',{...intent,rationale:'Changed retained review'}),/request changed/);
  await assert.rejects(prepare('allocate',{...intent,request_id:randomUUID()}),/existing saved FX request/);
  await db.exec('reset role');for(const table of ['invoice_settlements','settlement_requests','fx_conversion_lots','fx_settlement_source_checks'])assert.equal((await db.query('select * from '+table)).rows.length,0);
  assert.deepEqual((await db.query('select to_jsonb(r) r from financial_records r order by id')).rows,records);assert.deepEqual((await db.query("select oid::text from pg_proc where oid in('approve_fx_invoice_allocations(jsonb)'::regprocedure,'reverse_fx_conversion_lot(uuid,text,text,uuid)'::regprocedure) order by oid")).rows,oids);assert.equal((await catalog()).financial_stamp,intent.expected_stamp);
 });
 await serialSubtest(t,'expired, future-dated and unavailable immutable proofs require explicit cancellation and a new reviewed request',async()=>{
  for(const checkedAt of ['2000-01-01T00:00:00Z','2999-01-01T00:00:00Z',null]){
   await db.exec('reset role');const sources=(await db.query<{r:unknown}>('select fx_settlement_source_context($1,$2,true) r',[f.owner,JSON.stringify(intent)])).rows[0].r;
   if(checkedAt)await db.query("insert into fx_settlement_source_checks(user_id,request_id,intent,sources,outcome,author,checked_at) values($1,$2,$3,$4,'verified',$1,$5)",[f.owner,intent.request_id,JSON.stringify(intent),JSON.stringify(sources),checkedAt]);
   else{await f.service();await db.query("select record_fx_settlement_source_check($1,$2,$3,'unavailable')",[f.owner,JSON.stringify(intent),JSON.stringify(sources)]);}
   await assert.rejects(commit(intent.request_id),/Fresh exact/);assert.equal((await read(intent.request_id)).state,'prepared');await cancel(intent.request_id);
   intent={...intent,request_id:randomUUID()};await prepare('allocate',intent);
  }
 });
 await serialSubtest(t,'only explicit confirmation with fresh full-intent proof can commit; result and completed retries match frozen readback',async()=>{
  await assert.rejects(commit(intent.request_id,false),/confirm/);await assert.rejects(commit(intent.request_id),/Fresh exact/);
  const checked=await proof(intent);assert.equal(checked.outcome,'verified');allocated=await commit(intent.request_id);
  const r=await read(intent.request_id);assert.equal(r.state,'completed');assert.deepEqual(parseFxReviewedResult(allocated,r.review),r.result);assert.deepEqual(await commit(intent.request_id),allocated);
  await assert.rejects(cancel(intent.request_id),/already exists/);await db.exec('reset role');assert.equal((await db.query('select * from invoice_settlements')).rows.length,1);assert.deepEqual((await db.query('select to_jsonb(r) r from financial_records r order by id')).rows,records);
  const bad=structuredClone(allocated) as {rows:{cash_minor:number}[]};bad.rows[0].cash_minor=1;assert.throws(()=>parseFxReviewedResult(bad,r.review));
 });
 await serialSubtest(t,'cancellation opens a new review, rejects later execution and does not change financial stamp',async()=>{
  const current=await catalog();undo={schema_version:'fx-lot-reversal-intent/1',lot_id:x.lot,lot_version:1,expected_stamp:current.financial_stamp,rationale:'Synthetic saved complete reversal',request_id:randomUUID()};
  await prepare('reverse',undo);await cancel(undo.request_id);assert.equal((await read(undo.request_id)).state,'cancelled');await assert.rejects(commit(undo.request_id),/cancelled/);assert.equal((await catalog()).financial_stamp,current.financial_stamp);
  await db.exec('reset role');await db.query("delete from storage.objects where bucket_id='document-evidence' and name=$1",[f.path]);
  assert.deepEqual(await commit(intent.request_id),allocated);assert.equal((await read(intent.request_id)).state,'completed');
  undo={...undo,request_id:randomUUID(),expected_stamp:(await catalog()).financial_stamp};await prepare('reverse',undo);const r=await read(undo.request_id);assert.equal(r.review.kind,'reverse');if(r.review.kind!=='reverse')throw Error();assert.equal(r.review.parts.active_count,1);assert.equal(r.review.parts.cash_pence,0);
 });
 await serialSubtest(t,'complete retained reversal works without current bytes and exact completed recovery precedes changed heads/sources',async()=>{
  reversed=await commit(undo.request_id);const r=await read(undo.request_id);assert.equal(r.state,'completed');assert.deepEqual(parseFxReviewedResult(reversed,r.review),r.result);assert.deepEqual(await commit(undo.request_id),reversed);assert.deepEqual(await commit(intent.request_id),allocated);
  await db.exec('reset role');assert.equal((await db.query('select * from invoice_settlements')).rows.length,2);assert.equal((await db.query('select * from active_dimensioned_invoice_allocations')).rows.length,0);assert.deepEqual((await db.query('select to_jsonb(r) r from financial_records r order by id')).rows,records);
 });
 await serialSubtest(t,'owned safe readers, confirmations, immutable tables and narrow wrapper grants isolate direct and service writes',async()=>{
  await f.auth(f.other);for(const id of [intent.request_id,undo.request_id])await assert.rejects(db.query('select read_fx_reviewed_request($1)',[id]),/unavailable/);await assert.rejects(db.query('select commit_fx_reviewed_request($1,true)',[intent.request_id]),/unavailable/);
  for(const role of ['authenticated','anon','service_role']){await db.exec('reset role');await db.exec('set role '+role);for(const sql of ['select approve_fx_invoice_allocations(null)','select reverse_fx_conversion_lot(null,null,null,null)','select fx_reviewed_snapshot(null,null)','select fx_reviewed_payload_hash(null,null)','delete from fx_reviewed_requests','delete from fx_reviewed_request_cancellations'])await assert.rejects(db.query(sql),/permission denied/);if(role!=='authenticated')for(const sql of ['select prepare_fx_reviewed_request(null,null,true)','select commit_fx_reviewed_request(null,true)','select cancel_fx_reviewed_request(null,true)','select read_fx_reviewed_request(null)','select read_fx_reviewed_requests(null)'])await assert.rejects(db.query(sql),/permission denied/);}
 });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { fxConversionLotFixture } from './fx-lot-fixture';
import { serialSubtest } from './serial-subtest';
import { parseFxSettlementCatalog } from '../fx/settlement-catalog';
import { selectedSettlementSources, checkSettlementSources, parseSettlementSourceCheck } from '../fx/settlement-source';
import { validateFxSettlementIntent } from '../fx/settlement';
import { rateFromDecimal } from '../fx/currency';

test('private full-intent settlement source proof preserves financial history and verifies exact owned evidence',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url),migration='20261019070000_fx_settlement_source_checks.sql';
 for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<migration).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 const x=await fxConversionLotFixture(db),{f}=x;
 const catalog=async()=>{await f.auth();return parseFxSettlementCatalog(f.owner,(await db.query<{r:unknown}>('select read_fx_settlement_catalog() r')).rows[0].r)};
 const original=await catalog(),invoice=original.evidence.facts.find(fact=>fact.id===x.intent.source_fact_revision_id)!,conversion=original.evidence.facts.find(fact=>fact.id===x.conversion)!;
 const intent=validateFxSettlementIntent({schema_version:'fx-settlement-intent/1',ruleset_id:original.ruleset_id,receipt_id:x.tx,receipt_version:1,expected_stamp:original.financial_stamp,rationale:'Synthetic bound allocation source proof',request_id:randomUUID(),fee_mode:'none',receipt_valuation_id:null,receipt_valuation_evidence_revision_id:null,allocations:[{invoice_id:x.intent.invoice_id,invoice_revision_id:(x.saved as {revision_id:string}).revision_id,invoice_minor:1,cash_minor:0,conversion_date:'2026-04-06',rate:rateFromDecimal('KWD','GBP','2.5'),invoice_evidence_id:invoice.family_id,invoice_evidence_revision_id:invoice.id,conversion_evidence_id:conversion.family_id,conversion_evidence_revision_id:conversion.id,conversion_lot_id:x.lot,conversion_lot_version:0}]});
 const sources=selectedSettlementSources(f.owner,intent,original);
 await db.exec('reset role');const before=(await db.query('select to_jsonb(r) r from financial_records r where user_id=$1 order by id',[f.owner])).rows,oids=(await db.query("select oid::text from pg_proc where oid in('fx_evidence_review_stamp()'::regprocedure,'approve_fx_invoice_allocations(jsonb)'::regprocedure,'reverse_fx_conversion_lot(uuid,text,text,uuid)'::regprocedure) order by oid")).rows;
 await db.exec(await readFile(new URL(migration,dir),'utf8'));
 const service=async()=>{await f.service();await db.query("select set_config('request.jwt.claim.sub','',false)")};
 const record=async(input:typeof intent= intent,snapshot:unknown=sources,outcome='verified')=>{await service();return(await db.query<{r:unknown}>('select record_fx_settlement_source_check($1,$2,$3,$4) r',[f.owner,JSON.stringify(input),JSON.stringify(snapshot),outcome])).rows[0].r};
 let saved:ReturnType<typeof parseSettlementSourceCheck>;
 await serialSubtest(t,'upgrade leaves public function identities and financial bytes unchanged; private owner stamp matches authenticated state',async()=>{
  await db.exec('reset role');assert.deepEqual((await db.query("select oid::text from pg_proc where oid in('fx_evidence_review_stamp()'::regprocedure,'approve_fx_invoice_allocations(jsonb)'::regprocedure,'reverse_fx_conversion_lot(uuid,text,text,uuid)'::regprocedure) order by oid")).rows,oids);
  assert.deepEqual((await db.query('select to_jsonb(r) r from financial_records r where user_id=$1 order by id',[f.owner])).rows,before);
  await db.query("insert into financial_records(user_id,record_type,record_date,amount,description,source_type,status) values($1,'expense','2026-04-07',999,'Synthetic unrelated owner','manual','draft')",[f.other]);
  for(const owner of [f.owner,f.other]){await f.auth(owner);const publicStamp=(await db.query<{s:string}>('select fx_evidence_review_stamp() s')).rows[0].s;await db.exec('reset role');assert.equal((await db.query<{s:string}>('select fx_evidence_review_stamp_for_owner($1) s',[owner])).rows[0].s,publicStamp);}
  assert.equal((await catalog()).financial_stamp,intent.expected_stamp);
 });
 await serialSubtest(t,'real encrypted bytes verify once for the shared document while retaining both intent-bound fact snapshots',async()=>{
  let reads=0;const keys:Uint8Array[]=[];
  saved=await checkSettlementSources(f.owner,intent,{recover:async()=>null,catalog,metadata:async()=>f.metadata,key:()=>{const key=Buffer.from(f.key);keys.push(key);return key},download:async()=>{reads++;return f.cipher},record:(i,s,o)=>record(i,s,o)});
  assert.equal(saved.outcome,'verified');assert.equal(saved.sources.length,2);assert.equal(reads,1);assert.ok(keys.every(k=>k.every(b=>b===0)));
  assert.deepEqual(saved.intent,intent);assert.equal((await catalog()).financial_stamp,intent.expected_stamp);
  await db.exec('reset role');assert.equal((await db.query('select id from fx_conversion_lots')).rows.length,0);assert.equal((await db.query('select id from invoice_settlements')).rows.length,0);assert.equal((await db.query('select * from settlement_requests')).rows.length,0);assert.deepEqual((await db.query('select to_jsonb(r) r from financial_records r where user_id=$1 order by id',[f.owner])).rows,before);
  for(const secret of ['object_path','key_id','raw_encrypted','SYNTHETIC_NAME','.enc'])assert.ok(!JSON.stringify(saved).includes(secret));
 });
 await serialSubtest(t,'changed request, partial/foreign source, altered receipt and stale financial context cannot record verified proof',async()=>{
  await assert.rejects(record({...intent,rationale:'Changed retained request'}),/request changed/);
  await assert.rejects(record({...intent,request_id:randomUUID()},sources.slice(1)),/snapshot differs/);
  const bad=structuredClone(sources);bad[0].document_id=randomUUID();await assert.rejects(record({...intent,request_id:randomUUID()},bad),/snapshot differs/);
  const changed=structuredClone(intent);changed.request_id=randomUUID();changed.receipt_version++;await assert.rejects(record(changed),/owned invoice and conversion/);
  await assert.rejects(record({...intent,request_id:randomUUID(),expected_stamp:'0'.repeat(32)}),/financial context changed/);
  const foreign=structuredClone(intent);foreign.request_id=randomUUID();foreign.allocations[0].invoice_evidence_revision_id=randomUUID();await assert.rejects(record(foreign),/owned invoice and conversion/);
  await db.exec('reset role');assert.equal((await db.query('select id from fx_settlement_source_checks')).rows.length,1);
 });
 await serialSubtest(t,'source loss preserves exact verified history, records unavailable evidence and prevents new verified proof',async()=>{
  await db.exec('reset role');await db.query("delete from storage.objects where bucket_id='document-evidence' and name=$1",[f.path]);
  assert.deepEqual(parseSettlementSourceCheck(f.owner,await record()),saved);
  await assert.rejects(record({...intent,request_id:randomUUID()}),/Current settlement source/);
  const unavailable=parseSettlementSourceCheck(f.owner,await record({...intent,request_id:randomUUID()},sources,'unavailable'));assert.equal(unavailable.outcome,'unavailable');
  await assert.rejects(record(unavailable.intent,sources,'verified'),/request changed/);
  const recovered=await checkSettlementSources(f.owner,intent,{recover:async()=>saved,catalog:async()=>{throw Error('MUST_NOT_READ')},metadata:async()=>{throw Error('MUST_NOT_READ')},key:()=>{throw Error('MUST_NOT_READ')},download:async()=>{throw Error('MUST_NOT_READ')},record:async()=>{throw Error('MUST_NOT_READ')}});assert.deepEqual(recovered,saved);
 });
 await serialSubtest(t,'proof table is immutable and owner-scoped; service recorder cannot expand into financial or helper grants',async()=>{
  await f.auth(f.owner);assert.equal((await db.query('select id from fx_settlement_source_checks')).rows.length,2);await f.auth(f.other);assert.equal((await db.query('select id from fx_settlement_source_checks')).rows.length,0);
  for(const role of ['authenticated','anon','service_role']){await db.exec('reset role');await db.exec('set role '+role);
   for(const sql of ['update fx_settlement_source_checks set outcome=\'verified\'','delete from fx_settlement_source_checks',"insert into fx_settlement_source_checks(user_id,request_id,intent,sources,outcome,author) values(null,null,'{}','[]','verified',null)",'select fx_evidence_review_stamp_for_owner(null)','select fx_settlement_source_context(null,null,true)','select approve_fx_invoice_allocations(null)','select reverse_fx_conversion_lot(null,null,null,null)'])await assert.rejects(db.query(sql),/permission denied/);
   if(role!=='service_role')await assert.rejects(db.query('select record_fx_settlement_source_check(null,null,null,null)'),/permission denied/);
  }
  await db.exec('reset role');await assert.rejects(db.query("update fx_settlement_source_checks set outcome='unavailable'"),/immutable/i);
 });
});

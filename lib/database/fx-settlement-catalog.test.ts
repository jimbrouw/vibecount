import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { fxConversionLotFixture } from './fx-lot-fixture';
import { authoritativeFxSettlementReview, fxSettlementChoices, parseFxSettlementCatalog } from '../fx/settlement-catalog';
import { readFxSettlementCatalog } from '../fx/settlement-catalog-store';
import { rateFromDecimal } from '../fx/currency';

test('authoritative FX catalog separates approval choices and retained reversible history', async t => {
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url),migration='20261019020000_fx_settlement_catalog.sql';
 for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<migration).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 const x=await fxConversionLotFixture(db),{f}=x;await db.exec('reset role');
 const before=(await db.query<{s:string}>('select reconciliation_export_stamp() s')).rows[0].s;
 await db.exec(await readFile(new URL(migration,dir),'utf8'));await db.exec(await readFile(new URL('20261019030000_fx_dependency_review.sql',dir),'utf8'));
 const raw=async()=>{await f.auth();return(await db.query<{r:unknown}>('select read_fx_settlement_catalog() r')).rows[0].r;};
 const read=async()=>parseFxSettlementCatalog(f.owner,await raw());
 const make=async(portion=5000,cash=1250)=>{const c=await read(),choice=fxSettlementChoices(c).find(c=>c.conversion_fact_revision_id===x.conversion)!;return {
  schema_version:'fx-settlement-intent/1',ruleset_id:'vibecount-currencies/1',receipt_id:x.tx,receipt_version:1,expected_stamp:c.financial_stamp,rationale:'Synthetic authoritative FX read-back',request_id:randomUUID(),fee_mode:'none',receipt_valuation_id:null,receipt_valuation_evidence_revision_id:null,
  allocations:[{invoice_id:x.intent.invoice_id,invoice_revision_id:(x.saved as {revision_id:string}).revision_id,invoice_minor:portion,cash_minor:cash,conversion_date:'2026-04-06',rate:rateFromDecimal('KWD','GBP','2.5'),invoice_evidence_id:x.intent.source_fact_family_id,invoice_evidence_revision_id:x.intent.source_fact_revision_id,conversion_evidence_id:choice.conversion_family_id,conversion_evidence_revision_id:x.conversion,conversion_lot_id:choice.lot_id??x.lot,conversion_lot_version:choice.lot_version}]};};
 const approve=async(i:unknown)=>{await f.auth();await db.exec('reset role');return(await db.query<{r:unknown}>('select approve_fx_invoice_allocations($1) r',[JSON.stringify(i)])).rows[0].r;};
 const reverse=async()=>{const c=await read();await db.exec('reset role');return(await db.query<{r:unknown}>('select reverse_fx_conversion_lot($1,$2,$3,$4) r',[x.lot,c.financial_stamp,'Synthetic catalog reversal',randomUUID()])).rows[0].r;};
 await serialSubtest(t,'upgrade is read-only, current fact families differ from canonical revisions, and proposed lots are explicit',async()=>{
  const c=await read();assert.equal((await db.query<{s:string}>('select reconciliation_export_stamp() s')).rows[0].s,before);
  assert.equal(c.counts.invoices,1);assert.equal(c.lots.length,0);const option=fxSettlementChoices(c).find(c=>c.conversion_fact_revision_id===x.conversion)!;
  assert.equal(option.binding_state,'unbound');assert.equal(option.lot_id,null);assert.equal(option.eligible,true);
  const p=await make(),preview=authoritativeFxSettlementReview(f.owner,p,await raw());assert.equal(preview.result.rows[0].conversion_lot_binding_state,'proposed');
  assert.notEqual(preview.result.rows[0].invoice_revision_id,preview.result.rows[0].invoice_evidence.revision_id);
  assert.equal(preview.result.rows[0].cash_minor,1250);assert.equal(preview.result.recognized_income_change_pence,0);
  assert.deepEqual(await readFxSettlementCatalog({rpc:async()=>({data:await raw(),error:null})},f.owner),await read());
  assert.equal((await db.query('select id from fx_conversion_lots')).rows.length,0);
 });
 await serialSubtest(t,'strict complete projection validates unselected data and discards private properties',async()=>{
  const current=await raw();const clone=()=>structuredClone(current) as Record<string,unknown> & {invoices:Record<string,unknown>[];receipts:Record<string,unknown>[];lots:Record<string,unknown>[];counts:Record<string,unknown>};
  for(const mutate of [(c:ReturnType<typeof clone>)=>{c.owner_id=randomUUID();},(c:ReturnType<typeof clone>)=>{c.counts.invoices=0;},(c:ReturnType<typeof clone>)=>{c.invoices.push(c.invoices[0]);c.counts.invoices=2;},(c:ReturnType<typeof clone>)=>{c.receipts[0].decision_version=null;},(c:ReturnType<typeof clone>)=>{c.receipts.find(r=>r.id===x.tx)!.recognized_gbp_pence=null;},(c:ReturnType<typeof clone>)=>{c.invoices[0].invoice_date='2026-02-30';},(c:ReturnType<typeof clone>)=>{c.invoices[0].allocated_minor=1;}]){const c=clone();mutate(c);assert.throws(()=>parseFxSettlementCatalog(f.owner,c));}
  const c=clone();Object.assign(c,{object_path:'PRIVATE',key_id:'PRIVATE'});for(const r of [...c.invoices,...c.receipts])Object.assign(r,{raw_cells:['PRIVATE'],description:'PRIVATE',storage_path:'PRIVATE'});
  const parsed=parseFxSettlementCatalog(f.owner,c);assert.ok(!JSON.stringify(parsed).includes('PRIVATE'));const old=JSON.stringify(parsed);c.receipts[0].signed_minor=1;assert.equal(JSON.stringify(parsed),old);
  const oversize=clone();oversize.private_blob='x'.repeat(2000001);assert.throws(()=>parseFxSettlementCatalog(f.owner,oversize),/payload/);
  await assert.rejects(readFxSettlementCatalog({rpc:async()=>({data:current,error:{message:'Synthetic error'}})},f.owner));
 });
 await serialSubtest(t,'exact family/revision bindings and atomic context reject changed selections',async()=>{
  const p=await make(),c=await raw();
  for(const patch of [{invoice_evidence_id:randomUUID()},{invoice_evidence_revision_id:p.allocations[0].invoice_revision_id},{invoice_revision_id:x.intent.source_fact_revision_id},{conversion_evidence_id:randomUUID()},{conversion_lot_version:1}]){const changed=structuredClone(p);Object.assign(changed.allocations[0],patch);assert.throws(()=>authoritativeFxSettlementReview(f.owner,changed,c));}
  assert.throws(()=>authoritativeFxSettlementReview(f.owner,{...p,expected_stamp:'0'.repeat(32)},c));
 });
 await serialSubtest(t,'a changed receipt decision invalidates the live choice without guessing a successor version',async()=>{
  const old=await make();await f.auth();await db.exec('begin');
  try{await db.query("select review_bank_transaction($1,1,'Personal',null,0,'Synthetic changed receipt')",[x.tx]);
   const changed=await raw(),c=parseFxSettlementCatalog(f.owner,changed);assert.equal(fxSettlementChoices(c).find(c=>c.conversion_fact_revision_id===x.conversion)!.eligible,false);
   assert.throws(()=>authoritativeFxSettlementReview(f.owner,old,changed));
  }finally{await db.exec('rollback');}
 });
 await serialSubtest(t,'shared native cash and partial FX events derive independent balances and all-event versions',async()=>{
  await f.auth();const native=(await db.query<{t:string}>('select to_jsonb(updated_at) t from invoices where id=$1',[f.native])).rows[0].t;
  await db.query('select approve_invoice_allocations($1,$2,$3,$4,$5,$6)',[x.tx,1,JSON.stringify([{invoice_id:f.native,invoice_updated_at:native,amount_pence:1}]),'Synthetic shared cash',randomUUID(),0]);
  const first=await make();await approve(first);let c=await read();assert.equal(c.lots[0].version,1);assert.equal(c.lots[0].active_count,1);assert.equal(c.lots[0].prior_invoice_minor,5000);assert.equal(c.receipts.find(r=>r.id===x.tx)!.allocated_minor,1251);
  const next=await make();assert.equal(authoritativeFxSettlementReview(f.owner,next,await raw()).result.rows[0].conversion_lot_binding_state,'persisted');await approve(next);
  const zeroChoice=fxSettlementChoices(await read()).find(c=>c.conversion_fact_revision_id===x.conversion)!;assert.equal(zeroChoice.available_cash_minor,0);assert.equal(zeroChoice.remaining_documented_invoice_minor,1);assert.equal(zeroChoice.eligible,true);
  const last=await make(1,0);const preview=authoritativeFxSettlementReview(f.owner,last,await raw()).result;assert.equal(preview.unallocated_cash_minor,0);assert.equal(preview.rows[0].cash_minor,0);await approve(last);
  c=await read();assert.equal(c.lots[0].version,3);assert.equal(c.lots[0].active_count,3);assert.equal(c.lots[0].prior_invoice_minor,10001);assert.equal(c.lots[0].prior_cash_minor,2500);assert.equal(c.invoices[0].allocated_minor,10001);assert.equal(fxSettlementChoices(c).find(c=>c.conversion_fact_revision_id===x.conversion)!.blocked_reason,'invoice_fully_allocated');
  await reverse();c=await read();assert.equal(c.lots[0].version,6);assert.equal(c.lots[0].active_count,0);assert.equal(c.receipts.find(r=>r.id===x.tx)!.allocated_minor,1);assert.equal(c.invoices[0].allocated_minor,0);
  const again=await make();assert.equal(again.allocations[0].conversion_lot_version,6);assert.equal(again.allocations[0].conversion_lot_id,x.lot);assert.equal(authoritativeFxSettlementReview(f.owner,again,await raw()).result.rows[0].conversion_lot_version,6);
  const forged=structuredClone(again);forged.allocations[0].conversion_lot_id=randomUUID();const fresh=await raw();assert.throws(()=>authoritativeFxSettlementReview(f.owner,forged,fresh),/identity/);
 });
 await serialSubtest(t,'duplicate document recipes cannot obtain fresh rounding histories',async()=>{
  const another=await x.review(await x.conversionIntent()),c=await read();const choice=fxSettlementChoices(c).find(c=>c.conversion_fact_revision_id===another)!;
  assert.equal(choice.eligible,false);assert.equal(choice.blocked_reason,'recipe_already_bound');
 });
 await serialSubtest(t,'source loss removes fresh eligibility but keeps exact active and reversed ancestry',async()=>{
  await approve(await make());const before=await read();await db.exec('reset role');await db.query("delete from storage.objects where bucket_id='document-evidence' and name=$1",[f.path]);
  const lost=await read();assert.notEqual(lost.financial_stamp,before.financial_stamp);assert.equal(lost.lots[0].active_count,1);assert.equal(lost.lots[0].conversion_fact_revision_id,x.conversion);
  assert.equal(fxSettlementChoices(lost).find(c=>c.conversion_fact_revision_id===x.conversion)!.eligible,false);
  await reverse();const after=await read();assert.equal(after.lots[0].version,8);assert.equal(after.lots[0].active_count,0);assert.equal(after.lots[0].invoice_document_sha256,lost.lots[0].invoice_document_sha256);
  await db.exec('reset role');assert.deepEqual((await db.query<{r:unknown}>('select to_jsonb(r) r from financial_records r where bank_transaction_id=$1',[x.tx])).rows,x.before);
 });
 await serialSubtest(t,'withdrawn latest evidence never hides the retained earlier fact or creates a new family lot',async()=>{
  await f.auth();const previous=(await read()).evidence.facts.find(f=>f.id===x.conversion)!;
  await x.review(await x.conversionIntent({family_id:previous.family_id,expected_ordinal:1,state:'withdrawn',human_read_original:false,document_id:null,invoice_evidence_revision_id:null,transaction_id:null,transaction_version:null,data:null}));
  const c=await read(),option=fxSettlementChoices(c).find(c=>c.conversion_family_id===previous.family_id)!;
  assert.equal(option.eligible,false);assert.equal(option.binding_state,'persisted');assert.equal(option.lot_id,x.lot);assert.equal(c.lots[0].conversion_fact_revision_id,x.conversion);assert.notEqual(option.conversion_fact_revision_id,x.conversion);
 });
 await serialSubtest(t,'SQL rejects oversized complete payloads and excessive collections without truncating',async()=>{
  await f.auth();await db.exec('reset role');await db.exec('begin');
  try{
   await db.query("insert into fx_document_fact_families(id,user_id,kind) select gen_random_uuid(),$1,'conversion' from generate_series(1,2000)",[f.owner]);
   await db.query(`insert into fx_document_fact_revisions(user_id,family_id,kind,ordinal,state,ruleset_id,document_id,invoice_evidence_revision_id,transaction_id,transaction_version,data,source_snapshot,reviewed_stamp,rationale,human_read_original,author,request_id)
    select f.user_id,f.id,'conversion',1,'provisional',r.ruleset_id,r.document_id,r.invoice_evidence_revision_id,r.transaction_id,r.transaction_version,r.data,r.source_snapshot,r.reviewed_stamp,'Synthetic payload-bound fixture',false,f.user_id,r.request_id
    from fx_document_fact_families f cross join fx_document_fact_revisions r where f.user_id=$1 and r.id=$2 and not exists(select 1 from fx_document_fact_revisions x where x.family_id=f.id)`,[f.owner,x.conversion]);
   await f.auth();assert.ok((await db.query<{bytes:number}>("select octet_length(read_fx_evidence_catalog()::text) bytes")).rows[0].bytes>2000000);
   await db.exec('savepoint payload_check');await assert.rejects(db.query('select read_fx_settlement_catalog()'),/payload limit/);await db.exec('rollback to savepoint payload_check');
  }finally{await db.exec('rollback');}
  await f.auth();await db.exec('reset role');await db.exec('begin');
  try{await db.query("insert into fx_document_fact_families(id,user_id,kind) select gen_random_uuid(),$1,'conversion' from generate_series(1,10001)",[f.owner]);await f.auth();await assert.rejects(db.query('select read_fx_settlement_catalog()'),/catalog limit/);}finally{await db.exec('rollback');}
 });
 await serialSubtest(t,'other owners see no sources, anonymous/service cannot execute and financial writers stay private',async()=>{
  await db.exec('reset role');const other=randomUUID();await db.query('insert into auth.users values($1)',[other]);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);await db.exec('set role authenticated');
  const otherCatalog=parseFxSettlementCatalog(other,(await db.query<{r:unknown}>('select read_fx_settlement_catalog() r')).rows[0].r);assert.deepEqual(otherCatalog.counts,{invoices:0,receipts:0,lots:0});assert.equal(otherCatalog.evidence.facts.length,0);
  for(const role of ['anon','service_role']){await db.exec('reset role');await db.exec(`set role ${role}`);await assert.rejects(db.query('select read_fx_settlement_catalog()'),/permission denied/);}
  await db.exec('reset role');for(const role of ['authenticated','anon','service_role']){const rows=(await db.query<{allowed:boolean}>("select has_function_privilege($1,'approve_fx_invoice_allocations(jsonb)','execute') or has_function_privilege($1,'reverse_fx_conversion_lot(uuid,text,text,uuid)','execute') allowed",[role])).rows;assert.equal(rows[0].allowed,false);}
 });
});

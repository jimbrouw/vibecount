import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { fxConversionLotFixture } from './fx-lot-fixture';
import { rateFromDecimal } from '../fx/currency';
import { validateFxSettlementIntent } from '../fx/settlement';

test('private dimensioned FX settlement/reversal preserves GBP contracts and recognised income', async t => {
 const db = new PGlite({ extensions: { pgcrypto } });t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir = new URL('../../supabase/migrations/',import.meta.url),migration='20261019010000_dimensioned_fx_settlements.sql';
 for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<migration).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 const x=await fxConversionLotFixture(db),{f,intent:canonical,tx,lot,conversion}=x;
 await f.auth();const nativeUpdated=(await db.query<{t:string}>('select to_jsonb(updated_at) t from invoices where id=$1',[f.native])).rows[0].t;
 const nativeArgs=[tx,1,JSON.stringify([{invoice_id:f.native,invoice_updated_at:nativeUpdated,amount_pence:1}]),'Synthetic native compatibility',randomUUID(),0];
 const nativeResult=(await db.query<{r:{allocation_ids:string[]}}>('select approve_invoice_allocations($1,$2,$3,$4,$5,$6) r',nativeArgs)).rows[0].r;
 const nativeUndo=[nativeResult.allocation_ids[0],'Synthetic native compatibility reversal',randomUUID()];
 const nativeUndoResult=(await db.query<{r:unknown}>('select reverse_invoice_allocation($1,$2,$3) r',nativeUndo)).rows[0].r;
 const nativeEvents=(await db.query<{r:unknown}>('select to_jsonb(s) r from invoice_settlements s order by id')).rows;
 await f.auth(); const oldStamp=(await db.query<{s:string}>('select reconciliation_export_stamp() s')).rows[0].s;
 const stampOids=(await db.query<{r:unknown}>("select oid::text r from pg_proc where oid in('reconciliation_export_stamp()'::regprocedure,'tax_financial_stamp_for_owner(uuid)'::regprocedure) order by oid")).rows;
 const nativeBefore=(await db.query<{r:unknown}>('select to_jsonb(i) r from invoices i where id=$1',[f.native])).rows[0].r;
 const nativeView=(await db.query<{r:unknown}>('select to_jsonb(b) r from invoice_payment_balances b where id=$1',[f.native])).rows[0].r;
 await db.exec('reset role');await db.exec(await readFile(new URL(migration,dir),'utf8'));
 async function auth(){await f.auth();}
 async function owner(){await auth();await db.exec('reset role');}
 const stamp=async()=>{await auth();return(await db.query<{s:string}>('select fx_settlement_review_stamp() s')).rows[0].s;};
 let baselineVersion=0;
 const makeIntent=async(portion=5000,cash=1250,version=0,request=randomUUID())=>{
  await auth();const proof=(await db.query<{family_id:string}>('select family_id from fx_document_fact_revisions where id=$1',[conversion])).rows[0];
  return validateFxSettlementIntent({schema_version:'fx-settlement-intent/1',ruleset_id:'vibecount-currencies/1',receipt_id:tx,receipt_version:1,expected_stamp:await stamp(),rationale:'Synthetic reviewed FX tranche',request_id:request,fee_mode:'none',receipt_valuation_id:null,receipt_valuation_evidence_revision_id:null,
   allocations:[{invoice_id:canonical.invoice_id,invoice_revision_id:(x.saved as {revision_id:string}).revision_id,invoice_minor:portion,cash_minor:cash,conversion_date:'2026-04-06',rate:rateFromDecimal('KWD','GBP','2.5'),invoice_evidence_id:canonical.source_fact_family_id,invoice_evidence_revision_id:canonical.source_fact_revision_id,conversion_evidence_id:proof.family_id,conversion_evidence_revision_id:conversion,conversion_lot_id:lot,conversion_lot_version:version+baselineVersion}]});
 };
 const approve=async(i:unknown)=>{await owner();return(await db.query<{r:Record<string,unknown>}>('select approve_fx_invoice_allocations($1) r',[JSON.stringify(i)])).rows[0].r;};
 const reverse=async(s:string,request:string)=>{await owner();return(await db.query<{r:Record<string,unknown>}>('select reverse_fx_conversion_lot($1,$2,$3,$4) r',[lot,s,'Synthetic complete lot reversal',request])).rows[0].r;};
 let first:Awaited<ReturnType<typeof makeIntent>>,firstResult:Record<string,unknown>,second:Awaited<ReturnType<typeof makeIntent>>;
 await serialSubtest(t,'upgrade preserves native row/view and empty-FX stamp; public/private owner stamps agree',async()=>{
  await auth();assert.equal((await db.query<{s:string}>('select reconciliation_export_stamp() s')).rows[0].s,oldStamp);
  assert.deepEqual((await db.query<{r:unknown}>("select oid::text r from pg_proc where oid in('reconciliation_export_stamp()'::regprocedure,'tax_financial_stamp_for_owner(uuid)'::regprocedure) order by oid")).rows,stampOids);
  await db.query('select * from current_tax_profiles');
  assert.deepEqual((await db.query<{r:unknown}>('select to_jsonb(i) r from invoices i where id=$1',[f.native])).rows[0].r,nativeBefore);
  assert.deepEqual((await db.query<{r:unknown}>('select to_jsonb(b) r from invoice_payment_balances b where id=$1',[f.native])).rows[0].r,nativeView);
  await owner();assert.equal((await db.query<{s:string}>('select tax_financial_stamp_for_owner($1) s',[f.owner])).rows[0].s,oldStamp);
  assert.deepEqual((await db.query<{r:unknown}>("select to_jsonb(s)-array['settlement_kind','invoice_minor','invoice_currency','invoice_revision_id','conversion_lot_id','lot_event_ordinal','fx_snapshot'] r from invoice_settlements s order by id")).rows,nativeEvents);
  assert.deepEqual((await db.query<{r:unknown}>('select approve_invoice_allocations($1,$2,$3,$4,$5,$6) r',nativeArgs)).rows[0].r,nativeResult);
  assert.deepEqual((await db.query<{r:unknown}>('select reverse_invoice_allocation($1,$2,$3) r',nativeUndo)).rows[0].r,nativeUndoResult);

 });
 await serialSubtest(t,'late request insertion failure rolls back lot, settlement and request together',async()=>{
  const pending=await makeIntent();await owner();
  await db.exec("create function synthetic_fx_late_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic late FX request failure';end;$$;create trigger synthetic_fx_late_failure before insert on settlement_requests for each row execute function synthetic_fx_late_failure();");
  try{await assert.rejects(approve(pending),/late FX request failure/);}finally{await owner();await db.exec('drop trigger synthetic_fx_late_failure on settlement_requests;drop function synthetic_fx_late_failure()');}
  assert.equal((await db.query('select id from fx_conversion_lots where id=$1',[lot])).rows.length,0);assert.equal((await db.query("select id from invoice_settlements where settlement_kind='fx_gbp_cash'")).rows.length,0);
  assert.equal((await db.query('select request_id from settlement_requests where request_id=$1',[pending.request_id])).rows.length,0);
 });
 await serialSubtest(t,'multi-invoice batches roll back late failures and discharge mixed currencies against one GBP receipt',async()=>{
  const factInput=await x.conversionIntent({kind:'invoice',invoice_evidence_revision_id:null,transaction_id:null,transaction_version:null,data:{...f.factIntent.data,invoice_reference:'SYNTHETIC-SECOND',currency:'USD',original_total_minor:2500}});
  const factId=await x.review(factInput);
  await auth();const otherCanonical={...canonical,invoice_id:randomUUID(),request_id:randomUUID(),source_fact_family_id:factInput.family_id,source_fact_revision_id:factId,expected_stamp:(await db.query<{s:string}>('select external_invoice_review_stamp() s')).rows[0].s};
  const proof=await f.proof(otherCanonical);const otherSaved=await f.capture(otherCanonical,proof.id);
  const otherConversion=await x.review(await x.conversionIntent({invoice_evidence_revision_id:factId,data:{rate:rateFromDecimal('USD','GBP','0.5'),conversion_date:'2026-04-06',evidence_date:'2026-04-07',invoice_portion_minor:2500,gbp_cash_portion_pence:1250,fee_mode:'none'}}));await auth();
  const family=(await db.query<{family_id:string}>('select family_id from fx_document_fact_revisions where id=$1',[otherConversion])).rows[0].family_id;
  const batch=await makeIntent(),otherLot=randomUUID();batch.allocations.push({...batch.allocations[0],invoice_id:otherCanonical.invoice_id,invoice_revision_id:(otherSaved as {revision_id:string}).revision_id,invoice_evidence_id:factInput.family_id,invoice_evidence_revision_id:factId,conversion_evidence_id:family,conversion_evidence_revision_id:otherConversion,conversion_lot_id:otherLot,invoice_minor:2500,rate:rateFromDecimal('USD','GBP','0.5')});
  const normalized=validateFxSettlementIntent(batch);normalized.allocations[1].conversion_lot_version=99;
  await assert.rejects(approve(normalized),/history changed/);
  assert.equal((await db.query('select id from fx_conversion_lots where id=any($1::uuid[])',[[lot,otherLot]])).rows.length,0);
  assert.equal((await db.query("select id from invoice_settlements where settlement_kind='fx_gbp_cash'")).rows.length,0);
  assert.equal((await db.query('select request_id from settlement_requests where request_id=$1',[batch.request_id])).rows.length,0);
  const complete=validateFxSettlementIntent(batch);complete.request_id=randomUUID();const result=await approve(complete);assert.equal(result.allocated_cash_pence,2500);
  assert.deepEqual(new Set((result.rows as {invoice_currency:string}[]).map(r=>r.invoice_currency)),new Set(['KWD','USD']));
  await reverse(await stamp(),randomUUID());const otherStamp=await stamp();await owner();
  await db.query('select reverse_fx_conversion_lot($1,$2,$3,$4)',[otherLot,otherStamp,'Synthetic complete batch release',randomUUID()]);
  baselineVersion=2;assert.equal((await db.query("select id from active_dimensioned_invoice_allocations where settlement_kind='fx_gbp_cash'")).rows.length,0);
  assert.deepEqual((await db.query<{r:unknown}>('select to_jsonb(f) r from financial_records f where bank_transaction_id=$1',[tx])).rows,x.before);

 });
 await serialSubtest(t,'partial allocations derive independent cumulative amounts and create no recognised record',async()=>{
  first=await makeIntent();firstResult=await approve(first);assert.equal(firstResult.allocated_cash_pence,1250);assert.deepEqual(await approve(first),firstResult);
  second=await makeIntent(5001,1250,1);await approve(second);
  await auth();const b=(await db.query<{allocated_pence:string|number;unallocated_pence:string|number}>('select allocated_pence,unallocated_pence from receipt_allocation_balances where id=$1',[tx])).rows[0];assert.equal(Number(b.allocated_pence),2500);assert.equal(Number(b.unallocated_pence),1);
  assert.equal((await db.query('select id from active_invoice_allocations where invoice_id=$1',[canonical.invoice_id])).rows.length,2);
  assert.equal((await db.query('select id from invoice_payment_balances where id=$1',[canonical.invoice_id])).rows.length,0);
  const dimensioned=(await db.query<{allocated_original_minor:number;outstanding_original_minor:number;allocated_cash_pence:number;settlement_state:string}>('select allocated_original_minor,outstanding_original_minor,allocated_cash_pence,settlement_state from external_invoice_settlement_balances where id=$1',[canonical.invoice_id])).rows[0];assert.equal(Number(dimensioned.allocated_original_minor),10001);assert.equal(Number(dimensioned.outstanding_original_minor),0);assert.equal(Number(dimensioned.allocated_cash_pence),2500);assert.equal(dimensioned.settlement_state,'settled');
  assert.deepEqual((await db.query<{r:unknown}>('select to_jsonb(f) r from financial_records f where bank_transaction_id=$1',[tx])).rows,x.before);
  await owner();const publicStamp=(await db.query<{s:string}>('select reconciliation_export_stamp() s')).rows[0].s;assert.equal((await db.query<{s:string}>('select tax_financial_stamp_for_owner($1) s',[f.owner])).rows[0].s,publicStamp);assert.notEqual(publicStamp,oldStamp);
 });
 await serialSubtest(t,'capacity, expected history, proof and changed requests reject atomically',async()=>{
  for(const patch of [{rationale:'Changed review'},{receipt_version:0},{expected_stamp:'0'.repeat(32)}])await assert.rejects(approve({...first,...patch}),/request changed/);
  const fresh=await makeIntent(1,1,2);await assert.rejects(approve(fresh),/capacity/);
  const stale=await makeIntent(1,0,1);await assert.rejects(approve(stale),/history changed/);
  const forged=await makeIntent();forged.allocations[0].invoice_evidence_id=randomUUID();await assert.rejects(approve(forged),/proof identities/);
  assert.equal((await db.query("select id from active_dimensioned_invoice_allocations where settlement_kind='fx_gbp_cash'")).rows.length,2);
 });
 await serialSubtest(t,'active FX blocks native reversal, import reversal, direct source/effect edits and survives withdrawn proof',async()=>{
  await auth();const allocation=(firstResult.allocation_ids as string[])[0];await assert.rejects(db.query('select reverse_invoice_allocation($1,$2,$3)',[allocation,'Synthetic wrong reversal',randomUUID()]),/complete FX/);
  const imp=(await db.query<{import_id:string}>('select import_id from bank_transactions where id=$1',[tx])).rows[0].import_id;
  await assert.rejects(db.query('select read_source_import_reversal_context($1)',[imp]),/active FX/);
  await owner();await assert.rejects(db.query("update bank_transactions set decision_version=decision_version+1 where id=$1",[tx]),/Reverse active FX/);
  await assert.rejects(db.query("update financial_records set status='excluded' where bank_transaction_id=$1",[tx]),/Reverse active FX/);
  await assert.rejects(db.query("update record_imports set status='discarded' where id=$1",[imp]),/Reverse active FX/);
  await f.service();await assert.rejects(db.query("insert into financial_records(user_id,bank_transaction_id,import_id,record_type,record_date,description,amount,source_type,status) values($1,$2,$3,'income','2026-04-06','Synthetic forbidden added effect',1,'manual','draft')",[f.owner,tx,imp]),/Reverse active FX/);
  await owner();const manual=(await db.query<{id:string}>("insert into financial_records(user_id,record_type,record_date,description,amount,source_type,status) values($1,'income','2026-04-06','Synthetic unlinked draft',1,'manual','draft') returning id",[f.owner])).rows[0].id;
  await assert.rejects(db.query('update financial_records set bank_transaction_id=$1,import_id=$2 where id=$3',[tx,imp,manual]),/Reverse active FX/);await db.query('delete from financial_records where id=$1',[manual]);

  await db.query("delete from storage.objects where bucket_id='document-evidence' and name=$1",[f.path]);
  assert.deepEqual(await approve(first),firstResult);await assert.rejects(approve(await makeIntent(1,0,2)),/current verified/);
  await auth();assert.deepEqual((await db.query<{r:unknown}>('select approve_invoice_allocations($1,$2,$3,$4,$5,$6) r',nativeArgs)).rows[0].r,nativeResult);
  assert.deepEqual((await db.query<{r:unknown}>('select reverse_invoice_allocation($1,$2,$3) r',nativeUndo)).rows[0].r,nativeUndoResult);

 });
 await serialSubtest(t,'complete descending reversal restores both capacities after source loss and exact retries remain historical',async()=>{
  const pendingStamp=await stamp();await owner();await db.exec("create function synthetic_fx_reverse_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic late reversal failure';end;$$;create trigger synthetic_fx_reverse_failure before insert on settlement_requests for each row execute function synthetic_fx_reverse_failure();");
  try{await assert.rejects(reverse(pendingStamp,randomUUID()),/late reversal failure/);}finally{await owner();await db.exec('drop trigger synthetic_fx_reverse_failure on settlement_requests;drop function synthetic_fx_reverse_failure()');}
  assert.equal((await db.query("select id from active_dimensioned_invoice_allocations where settlement_kind='fx_gbp_cash'")).rows.length,2);
  const s=await stamp(),request=randomUUID(),result=await reverse(s,request);assert.equal(result.released_invoice_minor,10001);assert.equal(result.released_cash_pence,2500);assert.equal(result.lot_version,baselineVersion+4);
  assert.deepEqual(await reverse(s,request),result);await assert.rejects(reverse(await stamp(),request),/request changed/);
  await auth();assert.equal((await db.query('select id from active_invoice_allocations where invoice_id=$1',[canonical.invoice_id])).rows.length,0);
  const b=(await db.query<{unallocated_pence:string|number}>('select unallocated_pence from receipt_allocation_balances where id=$1',[tx])).rows[0];assert.equal(Number(b.unallocated_pence),2501);
  const dimensioned=(await db.query<{outstanding_original_minor:number;allocated_cash_pence:number;settlement_state:string}>('select outstanding_original_minor,allocated_cash_pence,settlement_state from external_invoice_settlement_balances where id=$1',[canonical.invoice_id])).rows[0];assert.equal(Number(dimensioned.outstanding_original_minor),10001);assert.equal(Number(dimensioned.allocated_cash_pence),0);assert.equal(dimensioned.settlement_state,'unpaid');
  assert.deepEqual((await db.query<{r:unknown}>('select to_jsonb(f) r from financial_records f where bank_transaction_id=$1',[tx])).rows,x.before);assert.deepEqual(await approve(first),firstResult);
 });
 await serialSubtest(t,'anonymous, ordinary users and service roles cannot activate private writers or read another owner',async()=>{
  for(const role of ['anon','authenticated','service_role']){await auth();await db.exec('reset role;set role '+role);await assert.rejects(db.query('select approve_fx_invoice_allocations($1)',[JSON.stringify(first)]),/permission denied/);await assert.rejects(db.query('select reverse_fx_conversion_lot($1,$2,$3,$4)',[lot,first.expected_stamp,'Synthetic',randomUUID()]),/permission denied/);}
  await f.auth(f.other);assert.equal((await db.query('select id from active_dimensioned_invoice_allocations')).rows.length,0);
 });
});

test('zero-cash FX is a real dependency and final zero tranche works after native cash capacity is exhausted',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url);for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 const x=await fxConversionLotFixture(db),{f,tx}=x;
 const stamp=async()=>{await f.auth();return(await db.query<{s:string}>('select fx_settlement_review_stamp() s')).rows[0].s;};
 async function request(lotId:string,conversionId:string,version:number,units:number,cash:number,decimal:string){
  await f.auth();const family=(await db.query<{family_id:string}>('select family_id from fx_document_fact_revisions where id=$1',[conversionId])).rows[0].family_id;
  return validateFxSettlementIntent({schema_version:'fx-settlement-intent/1',ruleset_id:'vibecount-currencies/1',receipt_id:tx,receipt_version:1,expected_stamp:await stamp(),rationale:'Synthetic zero-cash review',request_id:randomUUID(),fee_mode:'none',receipt_valuation_id:null,receipt_valuation_evidence_revision_id:null,
   allocations:[{invoice_id:x.intent.invoice_id,invoice_revision_id:(x.saved as {revision_id:string}).revision_id,invoice_minor:units,cash_minor:cash,conversion_date:'2026-04-06',rate:rateFromDecimal('KWD','GBP',decimal),invoice_evidence_id:x.intent.source_fact_family_id,invoice_evidence_revision_id:x.intent.source_fact_revision_id,conversion_evidence_id:family,conversion_evidence_revision_id:conversionId,conversion_lot_id:lotId,conversion_lot_version:version}]});
 }
 async function approve(i:unknown){await f.auth();await db.exec('reset role');return(await db.query<{r:{allocation_ids:string[]}}>('select approve_fx_invoice_allocations($1) r',[JSON.stringify(i)])).rows[0].r;}
 async function reverse(lotId:string){const s=await stamp();await db.exec('reset role');return(await db.query<{r:{released_cash_pence:number;released_invoice_minor:number}}>('select reverse_fx_conversion_lot($1,$2,$3,$4) r',[lotId,s,'Synthetic zero-cash reversal',randomUUID()])).rows[0].r;}
 const zeroFact=await x.review(await x.conversionIntent({data:{rate:rateFromDecimal('KWD','GBP','0.01'),conversion_date:'2026-04-06',evidence_date:'2026-04-07',invoice_portion_minor:1,gbp_cash_portion_pence:0,fee_mode:'none'}})),zeroLot=randomUUID();
 const zero=await request(zeroLot,zeroFact,0,1,0,'0.01');await approve(zero);
 await f.auth();assert.equal(Number((await db.query<{p:number}>('select allocated_pence p from receipt_allocation_balances where id=$1',[tx])).rows[0].p),0);
 assert.equal((await db.query('select id from active_invoice_allocations where transaction_id=$1',[tx])).rows.length,1);
 const imp=(await db.query<{import_id:string}>('select import_id from bank_transactions where id=$1',[tx])).rows[0].import_id;
 await assert.rejects(db.query('select read_source_import_reversal_context($1)',[imp]),/active FX/);
 await db.exec('reset role');await assert.rejects(db.query("update financial_records set status='excluded' where bank_transaction_id=$1",[tx]),/Reverse active FX/);
 const zeroUndo=await reverse(zeroLot);assert.equal(zeroUndo.released_cash_pence,0);assert.equal(zeroUndo.released_invoice_minor,1);
 const halfFact=await x.review(await x.conversionIntent({data:{rate:rateFromDecimal('KWD','GBP','5'),conversion_date:'2026-04-06',evidence_date:'2026-04-07',invoice_portion_minor:2,gbp_cash_portion_pence:1,fee_mode:'none'}})),halfLot=randomUUID();
 const one=await request(halfLot,halfFact,0,1,1,'5');const first=await approve(one);
 await f.auth();const updated=(await db.query<{t:string}>('select to_jsonb(updated_at) t from invoices where id=$1',[f.native])).rows[0].t;
 const native=(await db.query<{r:{allocation_ids:string[]}}>('select approve_invoice_allocations($1,1,$2,$3,$4,1) r',[tx,JSON.stringify([{invoice_id:f.native,invoice_updated_at:updated,amount_pence:2500}]),'Synthetic native remainder',randomUUID()])).rows[0].r;
 assert.equal(Number((await db.query<{p:number}>('select unallocated_pence p from receipt_allocation_balances where id=$1',[tx])).rows[0].p),0);
 const final=await request(halfLot,halfFact,1,1,0,'5');await approve(final);
 await f.auth();assert.equal((await db.query('select id from active_invoice_allocations where transaction_id=$1',[tx])).rows.length,3);
 await assert.rejects(db.query('select reverse_invoice_allocation($1,$2,$3)',[first.allocation_ids[0],'Wrong suffix',randomUUID()]),/complete FX/);
 await db.exec('reset role');const original=(await db.query<{r:Record<string,unknown>}>('select to_jsonb(s) r from invoice_settlements s where id=$1',[first.allocation_ids[0]])).rows[0].r;
 const forged={...original,id:randomUUID(),event_kind:'reversal',reverses_id:original.id,lot_event_ordinal:3,request_id:randomUUID()};
 await assert.rejects(db.query('insert into invoice_settlements select (jsonb_populate_record(null::invoice_settlements,$1)).*',[JSON.stringify(forged)]),/complete suffix/);
 const undone=await reverse(halfLot);assert.equal(undone.released_invoice_minor,2);assert.equal(undone.released_cash_pence,1);
 await f.auth();assert.equal(Number((await db.query<{p:number}>('select allocated_pence p from receipt_allocation_balances where id=$1',[tx])).rows[0].p),2500);
 await db.query('select reverse_invoice_allocation($1,$2,$3)',[native.allocation_ids[0],'Synthetic release native remainder',randomUUID()]);
 assert.deepEqual((await db.query<{r:unknown}>('select to_jsonb(f) r from financial_records f where bank_transaction_id=$1',[tx])).rows,x.before);
});

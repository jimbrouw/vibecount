import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { syntheticRefundSplit } from './refund-split-fixture';
import { nativeBalanceFixture } from './native-balance-fixture';
import { nativeEventSource, syntheticAccountCurrency } from './native-event-fixture';
import { bankValuationFixture, openSyntheticForeignAdmission } from './bank-valuation-fixture';
import { sha256 } from '../tax/snapshot';

test('native event scope upgrade closes connected-source holes without rewriting retained financial history',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url),target='20261019140000_native_bank_event_scope.sql';for(const n of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<target).sort())await db.exec(await readFile(new URL(n,dir),'utf8'));
 const f=await nativeBalanceFixture(db);await db.exec('reset role');const account=(await db.query<{account_id:string}>('select account_id from bank_transactions where id=$1',[f.receipt])).rows[0].account_id;
 const out=await nativeEventSource(db,f.owner,[-1000]),incoming=await nativeEventSource(db,f.owner,[1000]);await f.auth();const pairArgs=[out.transactions[0],0,incoming.transactions[0],0,'transfer','Synthetic transfer review',randomUUID()];const pairResult=(await db.query<{r:{pair_id:string}}>('select approve_transfer_pair($1,$2,$3,$4,$5,$6,$7) r',pairArgs)).rows[0].r;
 await db.exec('reset role');const fp=randomBytes(32).toString('hex'),dup=await nativeEventSource(db,f.owner,[100],{fingerprint:fp}),peer=await nativeEventSource(db,f.owner,[100],{account:dup.account,fingerprint:fp});await f.auth();
 const dupStamp=(await db.query<{s:string}>('select duplicate_group_stamp($1) s',[peer.transactions[0]])).rows[0].s,dupArgs=[peer.transactions[0],null,'distinct',dupStamp,'Synthetic separate purchase',randomUUID()],dupResult=(await db.query<{r:{decision_id:string}}>('select approve_duplicate_decision($1,$2,$3,$4,$5,$6) r',dupArgs)).rows[0].r;
 const clean=await nativeEventSource(db,f.owner,[100]);await f.auth();const importStamp=(await db.query<{r:{financial_stamp:string}}>('select read_source_import_reversal_context($1) r',[clean.imported])).rows[0].r.financial_stamp,importArgs=[clean.imported,importStamp,'Synthetic retained import reversal',randomUUID()],importResult=(await db.query<{r:unknown}>('select reverse_source_import_reviewed($1,$2,$3,$4) r',importArgs)).rows[0].r;
 const originalA=await nativeEventSource(db,f.owner,[-100]),originalB=await nativeEventSource(db,f.owner,[-100]),sharedRefund=await nativeEventSource(db,f.owner,[100]);await f.auth();
 const expenseCategory=(await db.query<{id:string}>("select id from record_categories where is_default and record_type='expense' limit 1")).rows[0].id;
 for(const id of [originalA.transactions[0],originalB.transactions[0]])await db.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic complete graph')",[id,expenseCategory]);
 const split=await syntheticRefundSplit(db,sharedRefund.transactions[0],[[originalA.transactions[0],50],[originalB.transactions[0],50]]);
 const calls=[['select approve_invoice_allocations($1,$2,$3,$4,$5,$6) r',f.allocationArgs,f.allocationResult],['select approve_invoice_refund_assignment($1,$2,$3,$4,$5,$6,$7) r',f.assignmentArgs,f.assignmentResult],['select approve_transfer_pair($1,$2,$3,$4,$5,$6,$7) r',pairArgs,pairResult],['select approve_duplicate_decision($1,$2,$3,$4,$5,$6) r',dupArgs,dupResult],['select reverse_source_import_reviewed($1,$2,$3,$4) r',importArgs,importResult],['select approve_refund_split($1) r',[JSON.stringify(split.intent)],split.result]]as const;
 const tables=['financial_records','bank_transactions','classification_decisions','invoice_settlements','settlement_requests','transfer_pairs','transfer_reversals','transfer_requests','refund_links','refund_reversals','refund_requests','invoice_refund_assignments','invoice_refund_assignment_reversals','invoice_refund_requests','duplicate_decisions','duplicate_reversals','duplicate_requests','source_import_reversal_requests','source_import_events'];
 const history=async()=>{await db.exec('reset role');const rows=[];for(const table of tables)rows.push((await db.query(`select to_jsonb(t)::text r from public.${table} t order by to_jsonb(t)::text`)).rows);return sha256(JSON.stringify(rows))};
 const identity=async()=>{await db.exec('reset role');return(await db.query("select oid,proname,proacl from pg_proc where oid in ('public.require_dimensioned_settlement()'::regprocedure,'public.approve_invoice_allocations_v1(uuid,integer,jsonb,text,uuid,bigint)'::regprocedure,'public.approve_duplicate_decision(uuid,uuid,text,text,text,uuid)'::regprocedure,'public.reverse_duplicate_decision(uuid,text,text,uuid)'::regprocedure,'public.reverse_source_import(uuid,text,text)'::regprocedure,'public.reverse_source_import_reviewed(uuid,text,text,uuid)'::regprocedure,'public.protect_fx_refund_relationship()'::regprocedure,'public.protect_fx_refund_reversal()'::regprocedure) order by oid")).rows};
 const before=await history(),ids=await identity(),fxSuffix=(await db.query<{d:string}>("select pg_get_functiondef('public.require_dimensioned_settlement()'::regprocedure) d")).rows[0].d.split(' if new.settlement_kind is distinct')[1];await db.exec(await readFile(new URL(target,dir),'utf8'));
 const deny=async(sql:string,args:unknown[],pattern=/Native review requires actual GBP bank cash|Owned .* unavailable|sources disagree/)=>{const before=await history();await db.exec('savepoint reject_event');try{await assert.rejects(db.query(sql,args),pattern)}finally{await db.exec('rollback to savepoint reject_event');await db.exec('reset role')}assert.equal(await history(),before)};
 await serialSubtest(t,'ordered upgrade preserves all financial bytes, current OIDs/ACLs, FX branch and exact old requests',async()=>{
  assert.equal(await history(),before);assert.deepEqual(await identity(),ids);assert.equal((await db.query<{d:string}>("select pg_get_functiondef('public.require_dimensioned_settlement()'::regprocedure) d")).rows[0].d.split(' if new.settlement_kind is distinct')[1],fxSuffix);
  for(const[sql,args,result]of calls){await f.auth();assert.deepEqual((await db.query<{r:unknown}>(sql,[...args])).rows[0].r,result)}
 });
 await serialSubtest(t,'fresh native allocation/reversal/assignment reject GBP-looking sources on a foreign account while exact requests recover',async()=>{
  await db.exec('reset role;begin');try{
   await openSyntheticForeignAdmission(db);await syntheticAccountCurrency(db,account,'USD');
   await f.auth();for(const[sql,args,result]of calls.slice(0,2))assert.deepEqual((await db.query<{r:unknown}>(sql,[...args])).rows[0].r,result);
   const assignment=(await db.query<{id:string}>('select id from active_invoice_refund_assignments limit 1')).rows[0].id,stamp=await f.financialStamp();
   await deny('select reverse_invoice_refund_assignment($1,$2,$3,$4)',[assignment,stamp,'Synthetic fresh reversal',randomUUID()]);
   const allocation=(await db.query<{id:string}>('select id from active_invoice_allocations where invoice_id=$1',[f.ids.partial])).rows[0].id;await deny('select reverse_invoice_allocation($1,$2,$3)',[allocation,'Synthetic fresh reversal',randomUUID()]);
   const fresh=[...f.allocationArgs];fresh[4]=randomUUID();await deny('select approve_invoice_allocations($1,$2,$3,$4,$5,$6)',fresh);
   const freshAssignment=[...f.assignmentArgs];freshAssignment[4]=stamp;freshAssignment[6]=randomUUID();await deny('select approve_invoice_refund_assignment($1,$2,$3,$4,$5,$6,$7)',freshAssignment,/Native review requires actual GBP bank cash/);
  }finally{await db.exec('rollback');await db.exec('reset role')}
 });
 await serialSubtest(t,'independent event triggers cover transfers, refunds, assignments and missing owned parents',async()=>{
  await db.exec('begin');try{
   await openSyntheticForeignAdmission(db);await syntheticAccountCurrency(db,account,'USD');await syntheticAccountCurrency(db,out.account,'USD');
   for(const table of ['transfer_pairs','refund_links','invoice_refund_assignments']){
    const row=(await db.query<{r:Record<string,unknown>}>(`select to_jsonb(t) r from public.${table} t limit 1`)).rows[0].r;await deny(`insert into public.${table} select * from jsonb_populate_record(null::public.${table},$1)`,[JSON.stringify({...row,id:randomUUID(),request_id:randomUUID()})]);
   }
   for(const[table,key,parent]of [['transfer_reversals','pair_id',pairResult.pair_id],['refund_reversals','refund_id',(await db.query<{id:string}>('select id from refund_links limit 1')).rows[0].id],['invoice_refund_assignment_reversals','assignment_id',(await db.query<{id:string}>('select id from invoice_refund_assignments limit 1')).rows[0].id]]as const){
    await deny(`insert into ${table}(user_id,${key},author,rationale,request_id) values($1,$2,$1,'Synthetic direct reversal',$3)`,[f.owner,parent,randomUUID()]);
    await deny(`insert into ${table}(user_id,${key},author,rationale,request_id) values($1,$2,$1,'Synthetic missing parent',$3)`,[f.owner,randomUUID(),randomUUID()]);
   }
   const event=(await db.query<{r:Record<string,unknown>}>("select to_jsonb(t) r from invoice_settlements t where invoice_id=$1 limit 1",[f.ids.partial])).rows[0].r;
   await deny('insert into invoice_settlements select * from jsonb_populate_record(null::invoice_settlements,$1)',[JSON.stringify({...event,id:randomUUID(),request_id:randomUUID()})]);
  }finally{await db.exec('rollback');await db.exec('reset role')}
 });
 await serialSubtest(t,'duplicate no-op and reversal guard the entire raw cohort rather than trusting selected rows or snapshots',async()=>{
  await db.exec('begin');try{
   await openSyntheticForeignAdmission(db);await syntheticAccountCurrency(db,dup.account,'USD');await f.auth();assert.deepEqual((await db.query<{r:unknown}>(calls[3][0],[...dupArgs])).rows[0].r,dupResult);
   const stamp=(await db.query<{s:string}>('select duplicate_group_stamp($1) s',[dup.transactions[0]])).rows[0].s;
   await deny('select approve_duplicate_decision($1,null,\'distinct\',$2,\'Synthetic fresh identity\',$3)',[dup.transactions[0],stamp,randomUUID()]);
   const reversalStamp=(await db.query<{s:string}>('select duplicate_group_stamp($1) s',[peer.transactions[0]])).rows[0].s;
   await deny('select reverse_duplicate_decision($1,$2,$3,$4)',[dupResult.decision_id,reversalStamp,'Synthetic identity reversal',randomUUID()]);
   await deny("insert into duplicate_reversals(user_id,decision_id,rationale,subject_snapshot,reviewed_stamp,author,request_id) values($1,$2,'Synthetic direct reversal','{}',$3,$1,$4)",[f.owner,dupResult.decision_id,reversalStamp,randomUUID()]);
  }finally{await db.exec('rollback');await db.exec('reset role')}
 });
 await serialSubtest(t,'a native subject cannot clear an identity cohort containing an unselected foreign or malformed source',async()=>{
  await db.exec('begin');try{
   await openSyntheticForeignAdmission(db);const row=randomUUID(),transaction=randomUUID();
   await db.query("insert into source_rows(id,user_id,import_id,row_number,row_hash,raw_encrypted) values($1,$2,$3,100,$4,'synthetic-foreign-cohort')",[row,f.owner,dup.imported,'e'.repeat(64)]);
   await db.query("insert into bank_transactions(id,user_id,account_id,import_id,source_row_id,transaction_date,currency,description,fingerprint,signed_amount_pence,original_signed_minor,source_units_ruleset) values($1,$2,$3,$4,$5,'2026-04-06','KWD','Synthetic inconsistent account source',$6,null,10001,'vibecount-currencies/1')",[transaction,f.owner,dup.account,dup.imported,row,fp]);
   await f.auth();const stamp=(await db.query<{s:string}>('select duplicate_group_stamp($1) s',[dup.transactions[0]])).rows[0].s;
   await deny('select approve_duplicate_decision($1,null,\'distinct\',$2,\'Synthetic full cohort review\',$3)',[dup.transactions[0],stamp,randomUUID()]);
   await deny('select assert_native_duplicate_scope($1,$2,$3)',[f.owner,dup.transactions[0],randomUUID()]);
  }finally{await db.exec('rollback');await db.exec('reset role')}
 });
 await serialSubtest(t,'foreign Unknown imports and effect-linked scope cannot be discarded by either native financial reversal entry',async()=>{
  await db.exec('begin');try{
   await openSyntheticForeignAdmission(db);const foreign=await bankValuationFixture(db,'KWD','-10.001',f.owner);await f.auth();const stamp=(await db.query<{s:string}>('select reconciliation_export_stamp() s')).rows[0].s;
   await deny('select reverse_source_import_reviewed($1,$2,$3,$4)',[foreign.imported,stamp,'Synthetic foreign Unknown reversal',randomUUID()]);await deny('select reverse_source_import($1,$2,$3)',[foreign.imported,'a'.repeat(32),'Synthetic legacy reversal']);
   const effectImport=await nativeEventSource(db,f.owner,[100]);
   await db.query("insert into financial_records(user_id,record_type,record_date,description,amount,source_type,status,import_id,bank_transaction_id) values($1,'expense','2026-04-06','Synthetic draft cross-import source',1,'csv','draft',$2,$3)",[f.owner,effectImport.imported,foreign.transaction]);
   await deny('select assert_native_import_scope($1,$2)',[f.owner,effectImport.imported]);await f.auth();const effectStamp=await f.financialStamp();
   await deny('select reverse_source_import_reviewed($1,$2,$3,$4)',[effectImport.imported,effectStamp,'Synthetic linked draft reversal',randomUUID()]);await deny('select reverse_source_import($1,$2,$3)',[effectImport.imported,'a'.repeat(32),'Synthetic legacy linked draft reversal']);
   await db.query('select assert_native_import_scope($1,$2)',[f.owner,out.imported]);
   await db.query('select assert_native_import_scope($1,$2)',[f.owner,clean.imported]);
   await f.auth();assert.deepEqual((await db.query<{r:unknown}>(calls[4][0],[...importArgs])).rows[0].r,importResult);
  }finally{await db.exec('rollback');await db.exec('reset role')}
 });
 await serialSubtest(t,'native import roots reject foreign connected transfer and transitive shared-refund sources without changing history',async()=>{
  await db.exec('begin');try{
   await openSyntheticForeignAdmission(db);await syntheticAccountCurrency(db,incoming.account,'USD');await syntheticAccountCurrency(db,originalB.account,'USD');
   for(const source of [out,originalA]){
    await deny('select assert_native_import_scope($1,$2)',[f.owner,source.imported]);await f.auth();const stamp=(await db.query<{s:string}>('select reconciliation_export_stamp() s')).rows[0].s;
    await deny('select reverse_source_import_reviewed($1,$2,$3,$4)',[source.imported,stamp,'Synthetic connected graph reversal',randomUUID()]);await deny('select reverse_source_import($1,$2,$3)',[source.imported,'a'.repeat(32),'Synthetic legacy connected reversal']);
   }
   await f.auth();assert.deepEqual((await db.query<{r:unknown}>('select approve_refund_split($1) r',[JSON.stringify(split.intent)])).rows[0].r,split.result);
  }finally{await db.exec('rollback');await db.exec('reset role')}
 });
 await serialSubtest(t,'helpers remain private and unrelated foreign sources do not prevent valid native cleanup',async()=>{
  await db.exec('begin');try{
   await openSyntheticForeignAdmission(db);await bankValuationFixture(db,'KWD','-10.001',f.owner);await f.auth();
   const r=(await db.query<{r:{reversal_id:string;restored_financial_pence:number}}>('select reverse_transfer_pair($1,$2,$3) r',[pairResult.pair_id,'Synthetic native cleanup',randomUUID()])).rows[0].r;assert.equal(r.restored_financial_pence,0);assert.equal((await db.query<{pair_id:string}>('select pair_id from transfer_reversals where id=$1',[r.reversal_id])).rows[0].pair_id,pairResult.pair_id);
   for(const role of ['anon','authenticated','service_role']){await db.exec('reset role;set role '+role);await db.exec('savepoint permission');await assert.rejects(db.query('select assert_native_duplicate_scope($1,$2,null)',[f.owner,dup.transactions[0]]),/permission denied/);await db.exec('rollback to savepoint permission');await db.exec('savepoint permission2');await assert.rejects(db.query('select assert_native_import_scope($1,$2)',[f.owner,out.imported]),/permission denied/);await db.exec('rollback to savepoint permission2')}
  }finally{await db.exec('rollback');await db.exec('reset role')}
 });
});

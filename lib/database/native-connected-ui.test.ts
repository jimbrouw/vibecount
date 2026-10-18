import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { nativeBalanceFixture } from './native-balance-fixture';
import { openSyntheticForeignAdmission,bankValuationFixture } from './bank-valuation-fixture';
import { parseNativeSourceContext } from '../records/native-source-context';
import { readCurrentRefundClosure,readCurrentRefundSplit,readCurrentImportReversal,readCurrentAssignmentContext } from '../records/native-connected-store';

test('current connected UI stores consume actual SQL V3 dimensions and preserve reviewed history',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url),target='20261019160000_native_source_parser_eligibility.sql';for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<target).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 const f=await nativeBalanceFixture(db);await db.exec('reset role');
 const source=(await db.query<{import_id:string;refund:string}>('select import_id,(select refund_transaction_id from active_refunds where id=$2) refund from bank_transactions where id=$1',[f.receipt,f.assignmentArgs[2]])).rows[0];
 const identity=(await db.query("select oid,proacl from pg_proc where oid='public.bank_observation_has_native_source(uuid,uuid)'::regprocedure")).rows;
 await db.exec(await readFile(new URL(target,dir),'utf8'));
 const rpc={rpc:async(name:string,args:Record<string,unknown>)=>{await f.auth();try{const values=Object.values(args);return{data:(await db.query<{r:unknown}>('select '+name+'('+values.map((_,i)=>'$'+(i+1)).join(',')+') r',values)).rows[0].r,error:null}}catch(error){return{data:null,error}}}};
 await serialSubtest(t,'parser-eligibility upgrade preserves predicate identity/grants and exact completed requests',async()=>{
  await db.exec('reset role');assert.deepEqual((await db.query("select oid,proacl from pg_proc where oid='public.bank_observation_has_native_source(uuid,uuid)'::regprocedure")).rows,identity);await f.auth();
  assert.deepEqual((await db.query<{r:unknown}>('select approve_invoice_allocations($1,$2,$3,$4,$5,$6) r',f.allocationArgs)).rows[0].r,f.allocationResult);
  assert.deepEqual((await db.query<{r:unknown}>('select approve_invoice_refund_assignment($1,$2,$3,$4,$5,$6,$7) r',f.assignmentArgs)).rows[0].r,f.assignmentResult);
 });
 await serialSubtest(t,'all four current stores independently validate actual native SQL source and operation parity',async()=>{
  const split=await readCurrentRefundSplit(rpc,f.owner,source.refund);assert.ok(split.native_catalog);assert.equal(split.blocked,false);
  const closure=await readCurrentRefundClosure(rpc,f.owner,{kind:'original',id:f.receipt});assert.ok(closure.native_review);assert.equal(closure.native_review.blocked,true);assert.equal(closure.source_context.counts.sources,2);
  const imported=await readCurrentImportReversal(rpc,f.owner,source.import_id);assert.ok(imported.native_review);assert.equal(imported.native_review.blocked,true);
  const assignment=await readCurrentAssignmentContext(rpc,f.owner,String(f.assignmentArgs[1]),String(f.assignmentArgs[2]));assert.equal(assignment.blocked,false);assert.equal(assignment.source_context.counts.sources,2);
 });
 await serialSubtest(t,'missing parser metadata is explicit source repair rather than a native form or parser crash',async()=>{
  await db.exec('reset role;begin');try{
   await db.exec('alter table record_imports drop constraint imports_source_complete;set session_replication_role=replica');await db.query('update record_imports set parser_version=null where id=$1',[source.import_id]);await db.exec('set session_replication_role=origin');
   const closure=await readCurrentRefundClosure(rpc,f.owner,{kind:'original',id:f.receipt});assert.equal(closure.blocked,true);assert.equal(closure.native_review,null);assert.equal(closure.source_context.counts.native_blockers,2);assert.equal(closure.source_context.sources[0].representation,'invalid');
   assert.equal((await readCurrentRefundSplit(rpc,f.owner,source.refund)).native_catalog,null);
  }finally{await db.exec('rollback;reset role')}
 });
 await serialSubtest(t,'actual foreign inventory has exact original units outside native choices and no native selected totals',async()=>{
  await db.exec('reset role;begin');try{
   await openSyntheticForeignAdmission(db);const foreign=await bankValuationFixture(db,'KWD','10.001',f.owner);
   const split=await readCurrentRefundSplit(rpc,f.owner,source.refund);assert.equal(split.blocked,false);assert.equal(split.source_context.blocked,true);assert.ok(split.native_catalog);assert.ok(!split.native_catalog.transactions.some(s=>s.id===foreign.transaction));
   const row=split.source_context.sources.find(s=>s.id===foreign.transaction)!;assert.equal(row.original_signed_minor,'10001');assert.equal(row.signed_amount_pence,null);
   const selected=await readCurrentRefundSplit(rpc,f.owner,foreign.transaction);assert.equal(selected.native_catalog,null);assert.equal(selected.blocked,true);
   const p=parseNativeSourceContext(f.owner,selected.source_context);assert.deepEqual(p,selected.source_context);
  }finally{await db.exec('rollback;reset role')}
 });
});

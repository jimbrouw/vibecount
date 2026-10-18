import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { fxConversionLotFixture } from './fx-lot-fixture';
import { syntheticRefundSplit } from './refund-split-fixture';
import { importReversalDependencyReview } from '../fx/dependency-review';
import { parseFxSettlementCatalog, fxSettlementChoices } from '../fx/settlement-catalog';
import { sourceImportReversalReview, type ImportReversalContext } from '../records/import-reversal';
import { parseFxDependencies } from '../fx/dependencies';
import { readRefundReversalDependencies } from '../records/refund-closure-store';
import { readRefundSplitCatalog } from '../records/refund-split-store';
import { readAssignmentFxDependencies } from '../fx/dependency-store';
import { rateFromDecimal } from '../fx/currency';

test('FX dependency upgrade blocks original refund combinations and reveals complete connected source blockers',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../../supabase/migrations/',import.meta.url),migration='20261019030000_fx_dependency_review.sql';
 for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<migration).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 const x=await fxConversionLotFixture(db),{f}=x;
 async function cash(amount:number){await db.exec('reset role');const account=(await db.query<{account_id:string}>('select account_id from bank_transactions where id=$1',[x.tx])).rows[0].account_id,attempt=randomUUID(),path='SYNTHETIC/'+attempt+'.enc';
  await db.query("insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values($1,$2,$3,$4,$5,'synthetic',100,'uploaded')",[attempt,f.owner,account,randomBytes(32).toString('hex'),path]);await db.query("insert into storage.objects(bucket_id,name) values('source-evidence',$1)",[path]);await f.service();
  const imported=(await db.query<{r:{import_id:string}}>("select ingest_source_csv($1,$2,'synthetic.csv','mapped-csv/1','{}',$3) r",[f.owner,attempt,JSON.stringify([{row_number:2,row_hash:randomBytes(32).toString('hex'),raw_encrypted:'SYNTHETIC',date:'2026-04-06',signed_pence:amount,currency:'GBP',description:'Synthetic dependency source',reference:'',fingerprint:randomBytes(32).toString('hex')}])])).rows[0].r.import_id;
  await f.auth();return{import:imported,tx:(await db.query<{id:string}>('select id from bank_transactions where import_id=$1',[imported])).rows[0].id};
 }
 const stamp=async()=>{await f.auth();return(await db.query<{s:string}>('select fx_settlement_review_stamp() s')).rows[0].s;};
 await f.auth();
 const nativeUpdated=(await db.query<{t:string}>('select to_jsonb(updated_at) t from invoices where id=$1',[f.native])).rows[0].t;
 const nativeAllocation=(await db.query<{r:{allocation_ids:string[]}}>('select approve_invoice_allocations($1,1,$2,$3,$4,0) r',[x.tx,JSON.stringify([{invoice_id:f.native,invoice_updated_at:nativeUpdated,amount_pence:1}]),'Synthetic shared native allocation',randomUUID()])).rows[0].r.allocation_ids[0];
 const family=(await db.query<{family_id:string}>('select family_id from fx_document_fact_revisions where id=$1',[x.conversion])).rows[0].family_id;
 const intent={schema_version:'fx-settlement-intent/1',ruleset_id:'vibecount-currencies/1',receipt_id:x.tx,receipt_version:1,expected_stamp:await stamp(),rationale:'Synthetic zero-cash dependency',request_id:randomUUID(),fee_mode:'none',receipt_valuation_id:null,receipt_valuation_evidence_revision_id:null,
 allocations:[{invoice_id:x.intent.invoice_id,invoice_revision_id:(x.saved as {revision_id:string}).revision_id,invoice_minor:1,cash_minor:0,conversion_date:'2026-04-06',rate:rateFromDecimal('KWD','GBP','2.5'),invoice_evidence_id:x.intent.source_fact_family_id,invoice_evidence_revision_id:x.intent.source_fact_revision_id,conversion_evidence_id:family,conversion_evidence_revision_id:x.conversion,conversion_lot_id:x.lot,conversion_lot_version:0}]};
 await db.exec('reset role');const approved=(await db.query<{r:unknown}>('select approve_fx_invoice_allocations($1) r',[JSON.stringify(intent)])).rows[0].r;
 // Reproduce a predecessor-valid relationship that the new guard must not rewrite.
 const oldCash=await cash(-1),oldRefund=await syntheticRefundSplit(db,oldCash.tx,[[x.tx,1]]),newCash=await cash(-1);
 await db.exec('reset role');const oldLinks=(await db.query<{r:unknown}>('select to_jsonb(r) r from refund_links r order by id')).rows,oldRecords=(await db.query<{r:unknown}>('select to_jsonb(r) r from financial_records r order by id')).rows;
 const oid=(await db.query<{r:unknown}>("select oid::text r from pg_proc where oid in('bind_fx_conversion_lot(uuid,uuid,uuid,uuid,uuid)'::regprocedure,'write_reviewed_refund_split(uuid,integer,jsonb,text,text,uuid)'::regprocedure,'read_fx_settlement_catalog()'::regprocedure) order by oid")).rows;
 await db.exec(await readFile(new URL(migration,dir),'utf8'));
 // Apply subsequent read-only integrations in actual order, then prove the new
 // wrapper leaves its immediate predecessor reader identities and bytes intact.
 const latest='20261019060000_fx_refund_dependency_context.sql';
 for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n>migration&&n<latest).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 const readerOids=(await db.query("select oid::text from pg_proc where oid in('read_refund_split_catalog(uuid)'::regprocedure,'read_refund_reversal_graph(text,uuid)'::regprocedure) order by oid")).rows;
 const priorStamp=(await db.query<{s:string}>('select reconciliation_export_stamp() s')).rows[0].s;
 await db.exec(await readFile(new URL(latest,dir),'utf8'));
 const rpc={rpc:async(name:string,args:Record<string,unknown>)=>{
  try{const values=name==='read_refund_split_catalog_v2'?[args.p_refund]:name==='read_refund_reversal_graph_v2'?[args.p_kind,args.p_id]:[args.p_allocation];
   const placeholders=values.map((_,i)=>'$'+(i+1)).join(',');return{data:(await db.query<{r:unknown}>('select '+name+'('+placeholders+') r',values)).rows[0].r,error:null};
  }catch(error){return{data:null,error};}
 }};
 const raw=async(source:string)=>{await f.auth();return(await db.query<{r:unknown}>('select read_source_import_reversal_context_v2($1) r',[source])).rows[0].r;};
 await serialSubtest(t,'upgrade preserves function OIDs and historical request/record bytes while exposing original refund counts',async()=>{
  await db.exec('reset role');assert.deepEqual((await db.query<{r:unknown}>("select oid::text r from pg_proc where oid in('bind_fx_conversion_lot(uuid,uuid,uuid,uuid,uuid)'::regprocedure,'write_reviewed_refund_split(uuid,integer,jsonb,text,text,uuid)'::regprocedure,'read_fx_settlement_catalog()'::regprocedure) order by oid")).rows,oid);
  assert.deepEqual((await db.query<{r:unknown}>('select to_jsonb(r) r from refund_links r order by id')).rows,oldLinks);assert.deepEqual((await db.query<{r:unknown}>('select to_jsonb(r) r from financial_records r order by id')).rows,oldRecords);
  await f.auth();assert.deepEqual((await db.query<{r:unknown}>('select approve_refund_split($1) r',[JSON.stringify(oldRefund.intent)])).rows[0].r,oldRefund.result);
  await db.exec('reset role');assert.deepEqual((await db.query<{r:unknown}>('select approve_fx_invoice_allocations($1) r',[JSON.stringify(intent)])).rows[0].r,approved);
  await f.auth();const c=parseFxSettlementCatalog(f.owner,(await db.query<{r:unknown}>('select read_fx_settlement_catalog() r')).rows[0].r),receipt=c.receipts.find(r=>r.id===x.tx)!;
  assert.equal(receipt.active_refund_id,null);assert.equal(receipt.active_refund_count,1);assert.equal(fxSettlementChoices(c).find(c=>c.conversion_fact_revision_id===x.conversion)!.eligible,false);
 });
 await serialSubtest(t,'zero-cash FX on an original outside the target import is an explicit full-lot blocker',async()=>{
  const r=importReversalDependencyReview(f.owner,await raw(oldCash.import));assert.equal(r.schema_version,'source-import-fx-blocked-review/1');if(r.schema_version!=='source-import-fx-blocked-review/1')throw new Error();
  assert.equal(r.fx_blockers.length,1);assert.equal(r.fx_blockers[0].id,x.lot);assert.equal(r.fx_blockers[0].receipt_id,x.tx);assert.equal(r.fx_blockers[0].cash_pence,0);assert.equal(r.fx_blockers[0].original_minor,1);assert.notEqual(r.fx_blockers[0].import_id,oldCash.import);assert.equal(r.fx_blockers[0].version,1);assert.ok(!('income_delta_pence'in r));
  await assert.rejects(db.query('select read_source_import_reversal_context($1)',[oldCash.import]),/active FX/);
  await assert.rejects(db.query('select reverse_source_import_reviewed($1,$2,$3,$4)',[oldCash.import,r.financial_stamp,'Synthetic blocked source',randomUUID()]),/active FX/);
 });
 await serialSubtest(t,'current dependency readers preserve native contracts and expose selected original, catalog, graph and native-assignment zero-cash blockers',async()=>{
  await f.auth();assert.equal((await db.query<{s:string}>('select reconciliation_export_stamp() s')).rows[0].s,priorStamp);
  assert.deepEqual((await db.query("select oid::text from pg_proc where oid in('read_refund_split_catalog(uuid)'::regprocedure,'read_refund_reversal_graph(text,uuid)'::regprocedure) order by oid")).rows,readerOids);
  const selected=parseFxDependencies(f.owner,(await db.query<{r:unknown}>('select read_fx_source_dependencies($1) r',[[x.tx,newCash.tx]])).rows[0].r);
  assert.equal(selected.sources.length,2);assert.equal(selected.fx_blockers[0].cash_pence,0);assert.equal(selected.fx_blockers[0].receipt_id,x.tx);
  const split=await readRefundSplitCatalog(rpc as never,f.owner,newCash.tx);assert.equal(split.fx_dependencies!.fx_blockers[0].id,x.lot);
  const rawSplit=(await db.query<{r:{native_context:unknown}}>('select read_refund_split_catalog_v2($1) r',[newCash.tx])).rows[0].r;
  assert.deepEqual(rawSplit.native_context,(await db.query<{r:unknown}>('select read_refund_split_catalog($1) r',[newCash.tx])).rows[0].r);
  for(const scope of [{kind:'refund' as const,id:oldCash.tx},{kind:'import' as const,id:oldCash.import},{kind:'original' as const,id:x.tx}]){
   const graph=await readRefundReversalDependencies(rpc as never,f.owner,scope);assert.equal(graph.native_review,null);assert.equal(graph.dependencies.fx_blockers[0].receipt_id,x.tx);assert.ok(graph.dependencies.sources.some(s=>s.id===oldCash.tx));
  }
  const isolated=await readRefundReversalDependencies(rpc as never,f.owner,{kind:'import',id:selected.sources.find(s=>s.id===x.tx)!.import_id});assert.equal(isolated.dependencies.blocked,true);
  const assignment=await readAssignmentFxDependencies(rpc as never,f.owner,nativeAllocation);assert.equal(assignment.fx_blockers[0].id,x.lot);assert.equal(assignment.sources[0].id,x.tx);
  for(const ids of [[x.tx,x.tx],[x.tx,null],[randomUUID()],Array(102).fill(x.tx)])await assert.rejects(db.query('select read_fx_source_dependencies($1)',[ids]));
  await assert.rejects(db.query('select read_refund_assignment_fx_context($1)',[randomUUID()]),/unavailable/);
  const serialized=JSON.stringify(rawSplit);for(const secret of ['object_path','raw_encrypted','reference','key_id'])assert.ok(!serialized.includes(secret));
 });
 await serialSubtest(t,'fresh split/legacy refunds, direct relationship insertion and fresh FX binding all reject before effects',async()=>{
  await assert.rejects(syntheticRefundSplit(db,newCash.tx,[[x.tx,1]]),/linked FX/);
  const group=(await db.query<{s:string}>('select refund_group_stamp($1) s',[x.tx])).rows[0].s;
  await assert.rejects(db.query('select approve_refund($1,1,$2,0,$3,$4,$5)',[x.tx,newCash.tx,group,'Synthetic legacy refund',randomUUID()]),/linked FX/);
  await assert.rejects(db.query('select reverse_refund_group($1,$2,$3,$4)',[x.tx,group,'Synthetic blocked legacy reversal',randomUUID()]),/linked FX/);
  const financial=(await db.query<{s:string}>('select reconciliation_export_stamp() s')).rows[0].s;await assert.rejects(db.query("select reverse_refund_closure('original',$1,$2,$3,$4)",[x.tx,financial,'Synthetic blocked closure',randomUUID()]),/linked FX/);
  await assert.rejects(x.bind(),/source-linked GBP/);
  await db.exec('reset role');await assert.rejects(db.query(`insert into refund_links(id,user_id,original_transaction_id,refund_transaction_id,amount_pence,recognized_pence,record_type,business_use_bps,category_id,original_snapshot,refund_snapshot,author,rationale,request_id)
   select gen_random_uuid(),user_id,original_transaction_id,$1,amount_pence,recognized_pence,record_type,business_use_bps,category_id,original_snapshot,refund_snapshot,author,'Synthetic direct relationship',$2 from refund_links limit 1`,[newCash.tx,oldRefund.intent.request_id]),/linked FX/);
  assert.deepEqual((await db.query<{r:unknown}>('select to_jsonb(r) r from financial_records r order by id')).rows,oldRecords);assert.equal((await db.query('select id from refund_links')).rows.length,1);
 });
 await serialSubtest(t,'complete FX reversal releases blockers; native preview and retained refund requests remain exact',async()=>{
  const current=await stamp();await db.exec('reset role');await db.query('select reverse_fx_conversion_lot($1,$2,$3,$4)',[x.lot,current,'Synthetic release before refund review',randomUUID()]);
  const rawReview=await raw(oldCash.import),r=importReversalDependencyReview(f.owner,rawReview);assert.equal(r.schema_version,'source-import-reversal-review/1');assert.deepEqual(r,sourceImportReversalReview(f.owner,(await db.query<{r:ImportReversalContext}>('select read_source_import_reversal_context($1) r',[oldCash.import])).rows[0].r));
  assert.deepEqual((await db.query<{r:unknown}>('select approve_refund_split($1) r',[JSON.stringify(oldRefund.intent)])).rows[0].r,oldRefund.result);
  const clear=await readRefundReversalDependencies(rpc as never,f.owner,{kind:'refund',id:oldCash.tx});assert.equal(clear.dependencies.blocked,false);assert.ok(clear.native_review);
  const nativeGraph=(await db.query<{r:unknown}>("select read_refund_reversal_graph('refund',$1) r",[oldCash.tx])).rows[0].r;
  assert.deepEqual((await db.query<{r:{native_context:unknown}}>("select read_refund_reversal_graph_v2('refund',$1) r",[oldCash.tx])).rows[0].r.native_context,nativeGraph);
  assert.equal((await readAssignmentFxDependencies(rpc as never,f.owner,nativeAllocation)).blocked,false);
  await syntheticRefundSplit(db,newCash.tx,[[x.tx,1]]);const next={...intent,expected_stamp:await stamp(),request_id:randomUUID(),allocations:[{...intent.allocations[0],conversion_lot_version:2}]};await db.exec('reset role');await assert.rejects(db.query('select approve_fx_invoice_allocations($1)',[JSON.stringify(next)]),/source-linked GBP/);
  await f.auth();const group=(await db.query<{s:string}>('select refund_group_stamp($1) s',[x.tx])).rows[0].s,undo=[x.tx,group,'Synthetic retained legacy reversal',randomUUID()];
  const reversed=(await db.query<{r:unknown}>('select reverse_refund_group($1,$2,$3,$4) r',undo)).rows[0].r;
  const retry={...next,expected_stamp:await stamp(),request_id:randomUUID()};await db.exec('reset role');await db.query('select approve_fx_invoice_allocations($1)',[JSON.stringify(retry)]);
  await f.auth();assert.deepEqual((await db.query<{r:unknown}>('select reverse_refund_group($1,$2,$3,$4) r',undo)).rows[0].r,reversed);
  assert.deepEqual((await db.query<{r:unknown}>('select approve_refund_split($1) r',[JSON.stringify(oldRefund.intent)])).rows[0].r,oldRefund.result);

 });
 await serialSubtest(t,'other owners and anonymous/service roles cannot retrieve foreign dependency scope',async()=>{
  await f.auth(f.other);
  await assert.rejects(db.query('select read_fx_source_dependencies($1)',[[x.tx]]),/unavailable/);
  await assert.rejects(db.query('select read_refund_split_catalog_v2($1)',[newCash.tx]),/unavailable/);
  await assert.rejects(db.query("select read_refund_reversal_graph_v2('refund',$1)",[oldCash.tx]),/unavailable/);
  await assert.rejects(db.query('select read_refund_assignment_fx_context($1)',[nativeAllocation]),/unavailable/);
  for(const role of ['authenticated','anon','service_role']){
   await db.exec('reset role');await db.exec('set role '+role);
   await assert.rejects(db.query('select fx_source_dependency_context($1,$2)',[f.owner,[x.tx]]),/permission denied/);
   await assert.rejects(db.query('select approve_fx_invoice_allocations($1)',[JSON.stringify(intent)]),/permission denied/);
   if(role!=='authenticated')for(const [sql,args]of [['select read_fx_source_dependencies($1)',[[x.tx]]],['select read_refund_split_catalog_v2($1)',[newCash.tx]],["select read_refund_reversal_graph_v2('refund',$1)",[oldCash.tx]],['select read_refund_assignment_fx_context($1)',[nativeAllocation]]] as [string,unknown[]][])await assert.rejects(db.query(sql,args),/permission denied/);
  }
  await f.auth(f.other);await assert.rejects(db.query('select read_source_import_reversal_context_v2($1)',[oldCash.import]),/Owned preserved import/);
  for(const role of ['anon','service_role']){await db.exec('reset role');await db.exec(`set role ${role}`);await assert.rejects(db.query('select read_source_import_reversal_context_v2($1)',[oldCash.import]),/permission denied/);}
 });
});

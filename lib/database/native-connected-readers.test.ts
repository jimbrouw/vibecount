import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { nativeBalanceFixture } from './native-balance-fixture';
import { nativeEventSource,syntheticAccountCurrency } from './native-event-fixture';
import { syntheticRefundSplit } from './refund-split-fixture';
import { bankValuationFixture,openSyntheticForeignAdmission } from './bank-valuation-fixture';
import { sha256 } from '../tax/snapshot';
import { fxConversionLotFixture } from './fx-lot-fixture';
import { rateFromDecimal } from '../fx/currency';

type Envelope={schema_version:string;blocked:boolean;native_context:unknown;source_context:{blocked:boolean;source_stamp:string;counts:{sources:number;native_sources:number;native_blockers:number;unavailable_sources:number};sources:{id:string;native_eligible:boolean;source_available:boolean;original_signed_minor:string|null;signed_amount_pence:string|null}[]};dependencies:{blocked:boolean};operation_source_ids?:string[]};
test('connected V3 readers gate complete raw sources before native projections and preserve predecessor contracts',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url),target='20261019150000_native_connected_review_context.sql';
 for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<target).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 const f=await nativeBalanceFixture(db),a=await nativeEventSource(db,f.owner,[-1000]),b=await nativeEventSource(db,f.owner,[-1000]),c=await nativeEventSource(db,f.owner,[-1000]),refunds=await nativeEventSource(db,f.owner,[600,400,100]);
 await f.auth();const category=(await db.query<{id:string}>("select id from record_categories where is_default and record_type='expense' limit 1")).rows[0].id;
 for(const source of [a,b,c])await db.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic connected source')",[source.transactions[0],category]);
 await syntheticRefundSplit(db,refunds.transactions[0],[[a.transactions[0],300],[b.transactions[0],300]]);
 await syntheticRefundSplit(db,refunds.transactions[1],[[b.transactions[0],100],[c.transactions[0],300]]);
 await syntheticRefundSplit(db,refunds.transactions[2],[[c.transactions[0],100]]);
 const read=async(sql:string,args:unknown[]=[])=>{await f.auth();return(await db.query<{r:Envelope}>(sql+' r',args)).rows[0].r};
 const oldNames=['read_refund_split_catalog','read_refund_split_catalog_v2','read_refund_reversal_graph','read_refund_reversal_graph_v2','read_source_import_reversal_context_pre_fx','read_source_import_reversal_context_v2','approve_invoice_allocations','approve_invoice_refund_assignment','reverse_refund_closure','reverse_source_import_reviewed'];
 const identity=async()=>{await db.exec('reset role');return(await db.query('select oid,proname,proacl,pg_get_functiondef(oid) definition from pg_proc where pronamespace=\'public\'::regnamespace and proname=any($1::text[]) order by oid',[oldNames])).rows};
 const history=async()=>{await db.exec('reset role');const all=[];for(const table of ['financial_records','classification_decisions','bank_transactions','invoice_settlements','settlement_requests','refund_links','refund_requests','invoice_refund_assignments','invoice_refund_requests','source_import_reversal_requests'])all.push((await db.query(`select to_jsonb(t)::text r from ${table} t order by to_jsonb(t)::text`)).rows);return sha256(JSON.stringify(all))};
 const beforeIdentity=await identity(),beforeHistory=await history();await db.exec(await readFile(new URL(target,dir),'utf8'));
 await serialSubtest(t,'upgrade preserves every predecessor body/OID/ACL, financial bytes and completed requests',async()=>{
  assert.deepEqual(await identity(),beforeIdentity);assert.equal(await history(),beforeHistory);await f.auth();
  assert.deepEqual((await db.query<{r:unknown}>('select approve_invoice_allocations($1,$2,$3,$4,$5,$6) r',f.allocationArgs)).rows[0].r,f.allocationResult);
  assert.deepEqual((await db.query<{r:unknown}>('select approve_invoice_refund_assignment($1,$2,$3,$4,$5,$6,$7) r',f.assignmentArgs)).rows[0].r,f.assignmentResult);
 });
 await serialSubtest(t,'native split, transitive closure and import context retain exact SQL JSON and no financial effects',async()=>{
  for(const[sql,args,old]of [
   ['select read_refund_split_catalog_v3($1)',[refunds.transactions[0]],'read_refund_split_catalog($1)'],
   ["select read_refund_reversal_graph_v3('original',$1)",[a.transactions[0]],"read_refund_reversal_graph('original',$1)"],
   ['select read_source_import_reversal_context_v3($1)',[a.imported],'read_source_import_reversal_context_pre_fx($1)']
  ]as const){const p=await read(sql,[...args]);assert.equal(p.blocked,false);assert.ok(p.native_context);await db.exec('reset role');assert.equal((await db.query<{same:boolean}>(`select (${sql.slice(7)}->'native_context')::text = (${old})::text same`,[...args])).rows[0].same,true);assert.doesNotMatch(JSON.stringify(p),/object_path|key_id|raw_encrypted|Synthetic connected source/)}
  const graph=await read("select read_refund_reversal_graph_v3('original',$1)",[a.transactions[0]]);assert.equal(graph.source_context.counts.sources,6);
  const assignment=await read('select read_refund_assignment_context_v2($1,$2)',[f.assignmentArgs[1],f.assignmentArgs[2]]);assert.equal(assignment.blocked,false);assert.equal(assignment.source_context.counts.sources,2);
  assert.equal(await history(),beforeHistory);
 });
 await serialSubtest(t,'unrelated NULL-pence foreign split inventory is visible without blocking a native selection',async()=>{
  await db.exec('reset role;begin');try{
   await openSyntheticForeignAdmission(db);const foreign=await bankValuationFixture(db,'KWD','10.001',f.owner);
   const split=await read('select read_refund_split_catalog_v3($1)',[refunds.transactions[0]]);assert.equal(split.blocked,false);assert.equal(split.source_context.blocked,true);assert.equal(split.source_context.counts.native_blockers,1);
   const source=split.source_context.sources.find(s=>s.id===foreign.transaction)!;assert.equal(source.signed_amount_pence,null);assert.equal(source.original_signed_minor,'10001');assert.equal(source.native_eligible,false);
   assert.ok(!(split.native_context as {transactions:{id:string}[]}).transactions.some(s=>s.id===foreign.transaction));
   assert.equal((await db.query<{same:boolean}>("select (read_refund_split_catalog_v3($1)->'native_context')::text=read_refund_split_catalog($1)::text same",[refunds.transactions[0]])).rows[0].same,true);
   const bad=await read('select read_refund_split_catalog_v3($1)',[foreign.transaction]);assert.equal(bad.blocked,true);assert.equal(bad.native_context,null);
   await db.exec("reset role;create or replace function public.read_refund_split_catalog_native(p_refund uuid,p_nodes uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$begin raise exception 'NATIVE_SPLIT_CALLED';end;$$");
   assert.equal((await read('select read_refund_split_catalog_v3($1)',[foreign.transaction])).native_context,null);
   await assert.rejects(read('select read_refund_split_catalog_v3($1)',[refunds.transactions[0]]),/NATIVE_SPLIT_CALLED/);
  }finally{await db.exec('rollback;reset role')}
 });
 await serialSubtest(t,'unsupported selected/connected sources never invoke native bases, including both assignment endpoints',async()=>{
  await db.exec('reset role;begin');try{
   await openSyntheticForeignAdmission(db);await syntheticAccountCurrency(db,c.account,'USD');
   // If the blocked path calls the predecessor, this sentinel makes the test fail.
   await db.exec("create or replace function public.read_refund_reversal_graph(p_kind text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin raise exception 'NATIVE_BASE_CALLED';end;$$");
   const graph=await read("select read_refund_reversal_graph_v3('original',$1)",[a.transactions[0]]);assert.equal(graph.blocked,true);assert.equal(graph.native_context,null);assert.equal(graph.source_context.counts.sources,6);
   await db.exec('reset role');await syntheticAccountCurrency(db,(await db.query<{account_id:string}>('select account_id from bank_transactions where id=(select refund_transaction_id from active_refunds where id=$1)',[f.assignmentArgs[2]])).rows[0].account_id,'USD');
   const assignment=await read('select read_refund_assignment_context_v2($1,$2)',[f.assignmentArgs[1],f.assignmentArgs[2]]);assert.equal(assignment.blocked,true);
  }finally{await db.exec('rollback;reset role')}
 });
 await serialSubtest(t,'import eligibility includes draft effect roots and mixed recursive edges before native context',async()=>{
  await db.exec('reset role;begin');try{
   await openSyntheticForeignAdmission(db);const foreign=await bankValuationFixture(db,'JPY','1',f.owner);
   await db.query("insert into financial_records(user_id,record_type,record_date,description,amount,source_type,status,import_id,bank_transaction_id) values($1,'expense','2026-04-06','Synthetic draft cross-import source',1,'csv','draft',$2,$3)",[f.owner,a.imported,foreign.transaction]);
   await db.exec("create or replace function public.read_source_import_reversal_context_pre_fx(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin raise exception 'NATIVE_BASE_CALLED';end;$$");
   const p=await read('select read_source_import_reversal_context_v3($1)',[a.imported]);assert.equal(p.blocked,true);assert.equal(p.native_context,null);assert.equal(p.source_context.counts.sources,7);assert.ok(p.source_context.sources.some(s=>s.id===foreign.transaction));assert.equal(p.operation_source_ids!.length,6);
   await db.exec('reset role');await db.query('delete from financial_records where bank_transaction_id=$1',[foreign.transaction]);
   const out=await nativeEventSource(db,f.owner,[-100]),incoming=await nativeEventSource(db,f.owner,[100]);await f.auth();const pair=(await db.query<{r:{pair_id:string}}>("select approve_transfer_pair($1,0,$2,0,'transfer','Synthetic mixed corruption fixture',$3) r",[out.transactions[0],incoming.transactions[0],randomUUID()])).rows[0].r;
   // Impossible under current writers: explicitly corrupted disposable edge tests traversal only.
   await db.exec('reset role;set session_replication_role=replica');await db.query('update transfer_pairs set outgoing_transaction_id=$1,incoming_transaction_id=$2 where id=$3',[c.transactions[0],foreign.transaction,pair.pair_id]);await db.exec('set session_replication_role=origin');
   const mixed=await read('select read_source_import_reversal_context_v3($1)',[a.imported]);assert.equal(mixed.blocked,true);assert.equal(mixed.native_context,null);assert.ok(mixed.source_context.sources.some(s=>s.id===foreign.transaction));
  }finally{await db.exec('rollback;reset role')}
 });
 await serialSubtest(t,'missing closure and cross-owner graph endpoints are retained for fail-closed validation',async()=>{
  for(const mode of ['account','endpoint','owner']){
   await db.exec('reset role;begin');try{
    await db.exec('set session_replication_role=replica');
    if(mode==='account')await db.query('delete from financial_accounts where id=$1',[c.account]);
    if(mode==='endpoint')await db.query('delete from bank_transactions where id=$1',[c.transactions[0]]);
    if(mode==='owner')await db.query('update bank_transactions set user_id=$1 where id=$2',[f.other,c.transactions[0]]);
    await db.exec('set session_replication_role=origin');
    if(mode==='account'){const p=await read("select read_refund_reversal_graph_v3('original',$1)",[a.transactions[0]]);assert.equal(p.blocked,true);assert.equal(p.native_context,null);assert.equal(p.source_context.counts.sources,6)}
    else await assert.rejects(read("select read_refund_reversal_graph_v3('original',$1)",[a.transactions[0]]),/Complete owned source endpoints/);
   }finally{await db.exec('rollback;reset role')}
  }
 });
 await serialSubtest(t,'zero-cash FX remains an independent blocker while unrelated native split review stays available',async()=>{
  await db.exec('reset role;begin');try{
   const x=await fxConversionLotFixture(db);await x.f.auth();
   const family=(await db.query<{family_id:string}>('select family_id from fx_document_fact_revisions where id=$1',[x.conversion])).rows[0].family_id;
   const stamp=(await db.query<{s:string}>('select fx_settlement_review_stamp() s')).rows[0].s;
   const intent={schema_version:'fx-settlement-intent/1',ruleset_id:'vibecount-currencies/1',receipt_id:x.tx,receipt_version:1,expected_stamp:stamp,rationale:'Synthetic zero-cash graph dependency',request_id:randomUUID(),fee_mode:'none',receipt_valuation_id:null,receipt_valuation_evidence_revision_id:null,
    allocations:[{invoice_id:x.intent.invoice_id,invoice_revision_id:(x.saved as {revision_id:string}).revision_id,invoice_minor:1,cash_minor:0,conversion_date:'2026-04-06',rate:rateFromDecimal('KWD','GBP','2.5'),invoice_evidence_id:x.intent.source_fact_family_id,invoice_evidence_revision_id:x.intent.source_fact_revision_id,conversion_evidence_id:family,conversion_evidence_revision_id:x.conversion,conversion_lot_id:x.lot,conversion_lot_version:0}]};
   await db.exec('reset role');await db.query('select approve_fx_invoice_allocations($1)',[JSON.stringify(intent)]);await x.f.auth();
   for(const sql of ["select read_refund_reversal_graph_v3('original',$1) r",'select read_refund_split_catalog_v3($1) r']){const p=(await db.query<{r:Envelope}>(sql,[x.tx])).rows[0].r;assert.equal(p.source_context.blocked,false);assert.equal(p.dependencies.blocked,true);assert.equal(p.blocked,true);assert.equal(p.native_context,null)}
   const cash=await nativeEventSource(db,x.f.owner,[-1]);await x.f.auth();const split=(await db.query<{r:Envelope}>('select read_refund_split_catalog_v3($1) r',[cash.transactions[0]])).rows[0].r;assert.equal(split.blocked,false);assert.equal(split.dependencies.blocked,true);assert.ok(split.native_context);
  }finally{await db.exec('rollback;reset role')}
 });
 await serialSubtest(t,'stable readers run in a read-only transaction without acquiring writer locks or mutations',async()=>{
  await f.auth();await db.exec('begin read only');try{
   await db.query('select read_refund_split_catalog_v3($1)',[refunds.transactions[0]]);
   await db.query("select read_refund_reversal_graph_v3('original',$1)",[a.transactions[0]]);
   await db.query('select read_source_import_reversal_context_v3($1)',[a.imported]);
   await db.query('select read_refund_assignment_context_v2($1,$2)',[f.assignmentArgs[1],f.assignmentArgs[2]]);
  }finally{await db.exec('rollback;reset role')}
 });
 await serialSubtest(t,'source metadata changes stamp while Storage loss preserves native cleanup eligibility',async()=>{
  const first=await read("select read_refund_reversal_graph_v3('original',$1)",[a.transactions[0]]);await db.exec('reset role;begin');try{
   await db.query("delete from storage.objects where bucket_id='source-evidence' and name=$1",[a.path]);const lost=await read("select read_refund_reversal_graph_v3('original',$1)",[a.transactions[0]]);assert.equal(lost.blocked,false);assert.ok(lost.native_context);assert.equal(lost.source_context.counts.unavailable_sources,1);assert.notEqual(lost.source_context.source_stamp,first.source_context.source_stamp);
   await db.exec('reset role');await db.query("update financial_accounts set account_type='credit_card' where id=$1",[a.account]);const changed=await read("select read_refund_reversal_graph_v3('original',$1)",[a.transactions[0]]);assert.notEqual(changed.source_context.source_stamp,lost.source_context.source_stamp);assert.equal(changed.blocked,false);
  }finally{await db.exec('rollback;reset role')}
 });
 await serialSubtest(t,'catalog and source/final payload limits reject whole results rather than truncate',async()=>{
  await db.exec('reset role;begin');try{
   await nativeEventSource(db,f.owner,Array(1100).fill(-100));await f.auth();
   await assert.rejects(db.query('select read_refund_split_catalog_v3($1)',[refunds.transactions[0]]),/Complete split review exceeds the safe payload limit/);
  }finally{await db.exec('rollback;reset role')}
  await db.exec('begin');try{
   await db.exec('set session_replication_role=replica');await db.query('update record_imports set parser_version=$1 where id=$2',['x'.repeat(2000000),a.imported]);await db.exec('set session_replication_role=origin');await f.auth();
   await assert.rejects(db.query("select read_refund_reversal_graph_v3('original',$1)",[a.transactions[0]]),/Complete source scope exceeds the safe payload limit/);
  }finally{await db.exec('rollback;reset role')}
  await db.exec('begin');try{
   await db.query("with added as (insert into source_rows(user_id,import_id,row_number,row_hash,raw_encrypted) select $1,$2,n,encode(sha256(convert_to(n::text,'UTF8')),'hex'),'SYNTHETIC_BOUNDED_METADATA' from generate_series(100,10100) n returning id) insert into bank_transactions(user_id,account_id,import_id,source_row_id,transaction_date,signed_amount_pence,currency,description,fingerprint) select $1,$3,$2,id,'2026-04-06',-100,'GBP','Synthetic catalog bound',encode(sha256(convert_to(id::text,'UTF8')),'hex') from added",[f.owner,a.imported,a.account]);await f.auth();
   await assert.rejects(db.query('select read_refund_split_catalog_v3($1)',[refunds.transactions[0]]),/Complete split source inventory exceeds the safe review limit/);
  }finally{await db.exec('rollback;reset role')}
 });
 await serialSubtest(t,'private helpers, duplicate/missing/foreign IDs, bounds and owner entry points fail closed',async()=>{
  await f.auth();await assert.rejects(db.query('select native_bank_source_context($1,$2)',[f.owner,[a.transactions[0]]]),/permission denied/);
  await db.exec('reset role');for(const nodes of [[a.transactions[0],a.transactions[0]],[null],[randomUUID()],Array.from({length:20001},()=>randomUUID())])await assert.rejects(db.query('select native_bank_source_context($1,$2)',[f.owner,nodes]),/Complete.*(scope|endpoints)/);
  await f.auth(f.other);for(const sql of ['select read_refund_split_catalog_v3($1)',"select read_refund_reversal_graph_v3('original',$1)"])await assert.rejects(db.query(sql,[a.transactions[0]]),/Owned/);
  await f.auth();await assert.rejects(db.query('select read_refund_assignment_context_v2($1,$2)',[f.assignmentArgs[1],randomUUID()]),/Owned matching/);
  for(const role of ['authenticated','anon','service_role']){await db.exec('reset role;set role '+role);await assert.rejects(db.query('select native_bank_source_context($1,$2)',[f.owner,[a.transactions[0]]]),/permission denied/);}
  for(const role of ['anon','service_role']){await db.exec('reset role;set role '+role);for(const sql of ['select read_refund_split_catalog_v3($1)',"select read_refund_reversal_graph_v3('original',$1)",'select read_source_import_reversal_context_v3($1)'])await assert.rejects(db.query(sql,[a.transactions[0]]),/permission denied/)}
  assert.equal(await history(),beforeHistory);
 });
});

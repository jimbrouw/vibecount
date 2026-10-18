// Actual ordered SQL, synthetic disposable sources only. No hosted operations.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir,readFile,readdir,writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
import { nativeEventSource,syntheticAccountCurrency } from '../lib/database/native-event-fixture';
import { syntheticRefundSplit } from '../lib/database/refund-split-fixture';
import { bankValuationFixture,openSyntheticForeignAdmission } from '../lib/database/bank-valuation-fixture';
import { sha256 } from '../lib/tax/snapshot';
type Envelope={blocked:boolean;native_context:unknown;source_context:{counts:{sources:number;native_blockers:number};sources:{id:string;original_signed_minor:string|null;signed_amount_pence:string|null}[]}};
async function main(){
 const db=new PGlite({extensions:{pgcrypto}}),output='/tmp/vibecount-native-connected-readers-demo';
 try{
  await db.exec(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../supabase/migrations/',import.meta.url),target='20261019150000_native_connected_review_context.sql',names=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort();
  for(const name of names.filter(n=>n<target))await db.exec(await readFile(new URL(name,dir),'utf8'));
  await db.exec('begin');const owner=randomUUID();await db.query('insert into auth.users values($1)',[owner]);
  const a=await nativeEventSource(db,owner,[-100]),b=await nativeEventSource(db,owner,[-100]),cash=await nativeEventSource(db,owner,[100]);
  const auth=async()=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated')};await auth();
  const category=(await db.query<{id:string}>("select id from record_categories where is_default and record_type='expense' limit 1")).rows[0].id;
  for(const source of [a,b])await db.query("select review_bank_transaction($1,0,'Business',$2,10000,'Synthetic reviewed graph')",[source.transactions[0],category]);
  const split=await syntheticRefundSplit(db,cash.transactions[0],[[a.transactions[0],50],[b.transactions[0],50]]);
  const history=async()=>{await db.exec('reset role');const rows=[];for(const table of ['financial_records','classification_decisions','refund_links','refund_requests','invoice_settlements'])rows.push((await db.query(`select to_jsonb(t)::text r from ${table} t order by to_jsonb(t)::text`)).rows);return sha256(JSON.stringify(rows))};
  const before=await history();await db.exec(await readFile(new URL(target,dir),'utf8'));assert.equal(await history(),before);
  const read=async(sql:string,id:string)=>{await auth();return(await db.query<{r:Envelope}>(sql+' r',[id])).rows[0].r};
  const native=await read("select read_refund_reversal_graph_v3('original',$1)",a.transactions[0]);assert.equal(native.blocked,false);assert.equal(native.source_context.counts.sources,3);
  assert.equal((await db.query<{same:boolean}>("select (read_refund_reversal_graph_v3('original',$1)->'native_context')::text=read_refund_reversal_graph('original',$1)::text same",[a.transactions[0]])).rows[0].same,true);
  await db.exec('reset role');await openSyntheticForeignAdmission(db);const foreign=await bankValuationFixture(db,'KWD','10.001',owner),afterForeign=await history();
  const unrelated=await read('select read_refund_split_catalog_v3($1)',cash.transactions[0]);assert.equal(unrelated.blocked,false);assert.ok(unrelated.native_context);assert.equal(unrelated.source_context.counts.native_blockers,1);
  const original=unrelated.source_context.sources.find(s=>s.id===foreign.transaction)!;assert.equal(original.original_signed_minor,'10001');assert.equal(original.signed_amount_pence,null);
  const selected=await read('select read_refund_split_catalog_v3($1)',foreign.transaction);assert.equal(selected.blocked,true);assert.equal(selected.native_context,null);assert.equal(await history(),afterForeign);
  await syntheticAccountCurrency(db,b.account,'USD');const connected=await read("select read_refund_reversal_graph_v3('original',$1)",a.transactions[0]);assert.equal(connected.blocked,true);assert.equal(connected.native_context,null);assert.equal(connected.source_context.counts.sources,3);
  const imported=await read('select read_source_import_reversal_context_v3($1)',a.imported);assert.equal(imported.blocked,true);assert.equal(imported.native_context,null);assert.equal(await history(),afterForeign);
  // Exact completed intent still recovers through the unchanged financial writer.
  await auth();assert.deepEqual((await db.query<{r:unknown}>('select approve_refund_split($1) r',[JSON.stringify(split.intent)])).rows[0].r,split.result);
  foreign.key.fill(0);await db.exec('rollback;reset role');
  assert.equal((await db.query('select id from financial_records')).rows.length,0);assert.equal((await db.query('select id from bank_transactions')).rows.length,0);
  assert.equal((await db.query<{n:number}>("select count(*)::int n from pg_constraint where conname in('financial_accounts_currency_check','bank_transactions_currency_check') and pg_get_constraintdef(oid) like '%GBP%'")).rows[0].n,2);
  assert.equal((await db.query<{n:boolean}>("select attnotnull n from pg_attribute where attrelid='bank_transactions'::regclass and attname='signed_amount_pence'")).rows[0].n,true);
  assert.equal((await db.query<{v:string|null}>("select to_regprocedure('public.read_refund_split_catalog_v3(uuid)')::text v")).rows[0].v,null);
  const report={synthetic_only:true,ordered_migrations:names.length,native_context_matches_predecessor_bytes:true,unsupported_original_units_preserved:true,unrelated_unsupported_candidate_does_not_block_native_selection:true,blocked_native_contexts_withheld:true,readers_do_not_change_financial_history:true,completed_request_recovers_after_account_corruption:true,fixtures_and_target_ddl_rolled_back:true,foreign_admission_restored:true,scope:'Read-only SQL prerequisites. Current pages still use V2 pending V3 parser/UI integration; no foreign ingestion or financial approval enabled.'};
  const files=[{name:'contexts.json',body:JSON.stringify({native,unrelated,selected,connected,imported},null,2)},{name:'report.json',body:JSON.stringify(report,null,2)}];await mkdir(output,{recursive:true});
  for(const file of files)await writeFile(output+'/'+file.name,file.body);
  await writeFile(output+'/manifest.json',JSON.stringify({synthetic_only:true,files:files.map(f=>({name:f.name,size_bytes:Buffer.byteLength(f.body),sha256:sha256(f.body)}))},null,2));
  console.log(JSON.stringify({output,contexts:5,no_reader_financial_effects:true,retained_request_recovered:true,rolled_back:true}));
 }finally{await db.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});

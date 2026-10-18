// Disposable synthetic SQL and safe rendered read-back. No hosted operations.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
import { nativeEventSource } from '../lib/database/native-event-fixture';
import { bankValuationFixture, openSyntheticForeignAdmission } from '../lib/database/bank-valuation-fixture';
import { parseBankSourceCoverage } from '../lib/records/bank-source-coverage';
import { bankChoiceSource, nativeBankChoice, type BankChoiceRow } from '../lib/records/native-choice';
import { sourceHash, decryptSource, sourceContext } from '../lib/records/source-crypto';

async function main(){
 const db=new PGlite({extensions:{pgcrypto}}),output='/tmp/vibecount-native-choice-readers-demo',temporary=await mkdtemp(join(process.cwd(),'.native-choice-demo-'));
 try{
  await db.exec(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../supabase/migrations/',import.meta.url),migrations=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort();
  for(const name of migrations)await db.exec(await readFile(new URL(name,dir),'utf8'));
  const closed=async()=>{assert.equal((await db.query<{n:number}>("select count(*)::int n from pg_constraint where conname in('financial_accounts_currency_check','bank_transactions_currency_check') and pg_get_constraintdef(oid) like '%GBP%'")).rows[0].n,2);assert.equal((await db.query<{n:boolean}>("select attnotnull n from pg_attribute where attrelid='bank_transactions'::regclass and attname='signed_amount_pence'")).rows[0].n,true)};
  await closed();await db.exec('begin');const owner=randomUUID();await db.query('insert into auth.users values($1)',[owner]);
  const native=await nativeEventSource(db,owner,[-100,100]);await openSyntheticForeignAdmission(db);const foreign=await bankValuationFixture(db,'KWD','10.001',owner);
  assert.deepEqual(decryptSource(foreign.cipher,foreign.key,sourceContext(owner,foreign.account,foreign.hash)),foreign.sourceBytes);
  const effects=async()=>(await db.query<{records:number;decisions:number;settlements:number}>("select (select count(*)::int from financial_records) records,(select count(*)::int from classification_decisions) decisions,(select count(*)::int from invoice_settlements) settlements")).rows[0];
  const before=await effects();await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');
  const coverage=parseBankSourceCoverage((await db.query<{r:unknown}>('select read_bank_source_coverage() r')).rows[0].r,owner);
  const choices=(await db.query<BankChoiceRow>('select *,transaction_date::text transaction_date from transfer_transaction_choices where user_id=$1 order by id',[owner])).rows;
  assert.equal(choices.length,3);assert.equal(coverage.observations.length,3);
  for(const row of choices)assert.equal(nativeBankChoice(coverage,row),row.currency==='GBP');
  const foreignRow=choices.find(r=>r.id===foreign.transaction)!;assert.equal(foreignRow.signed_amount_pence,null);assert.equal(bankChoiceSource(coverage,foreignRow).original_signed_minor,'10001');
  const receipts=(await db.query<{id:string}>('select id from receipt_allocation_balances where user_id=$1',[owner])).rows;
  assert.equal(receipts.length,1);assert.ok(!receipts.some(r=>r.id===foreign.transaction));
  const bundle=await build({absWorkingDir:process.cwd(),bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',external:['react','react-dom/server'],stdin:{resolveDir:process.cwd(),contents:"import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {BankChoiceWithheld} from './app/dashboard/BankChoiceReadback.tsx';export const render=sources=>renderToStaticMarkup(createElement(BankChoiceWithheld,{sources,prefix:'demo'}));"}});
  const modulePath=join(temporary,'readback.mjs');await writeFile(modulePath,bundle.outputFiles[0].text);const renderer=await import(pathToFileURL(modulePath).href),html='<!doctype html><html lang="en"><meta charset="utf-8"><title>Synthetic native choice read-back</title><h1>Synthetic source review</h1>'+renderer.render(coverage.observations)+'</html>';
  assert.match(html,/KWD 10.001 \(ten Kuwaiti dinars and one fil\)/);assert.doesNotMatch(html,/<form|<input|<button|object_path|key_id|raw_encrypted/);assert.match(html,new RegExp('transaction='+foreign.transaction));
  await db.exec('reset role');assert.deepEqual(await effects(),before);assert.deepEqual(before,{records:0,decisions:0,settlements:0});foreign.key.fill(0);
  await db.exec('rollback');await closed();assert.equal((await db.query('select id from bank_transactions')).rows.length,0);
  const report={synthetic_only:true,migration_count:migrations.length,native_selected_sources:native.transactions.length,complete_observations:coverage.observations.length,native_receipt_view_rows:receipts.length,foreign_original:{currency:'KWD',minor:'10001',native_cash:null},native_projection_does_not_imply_completeness:true,foreign_native_controls_withheld:true,source_links_preserved:true,foreign_source_roundtrip:true,financial_effect_counts:before,all_fixtures_rolled_back:true,foreign_admission_restored:true,scope:'Direct native choice containment; not connected graph readiness, foreign ingestion/posting, tax treatment or hosted acceptance.'};
  await mkdir(output,{recursive:true});const files=[{name:'report.json',body:JSON.stringify(report,null,2)},{name:'readback.html',body:html}];
  for(const file of files)await writeFile(join(output,file.name),file.body);
  await writeFile(join(output,'manifest.json'),JSON.stringify({synthetic_only:true,files:files.map(f=>({name:f.name,size_bytes:Buffer.byteLength(f.body),sha256:sourceHash(Buffer.from(f.body))}))},null,2));
  console.log(JSON.stringify({output,observations:3,native_receipt_rows:1,no_financial_effects:true,rolled_back:true}));
 }finally{await db.close();await rm(temporary,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error);process.exitCode=1});

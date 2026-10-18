// Disposable synthetic SQL only. No hosted financial operations or source-byte certification.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
import { nativeBalanceFixture } from '../lib/database/native-balance-fixture';
import { syntheticAccountCurrency } from '../lib/database/native-event-fixture';
import { openSyntheticForeignAdmission } from '../lib/database/bank-valuation-fixture';
import { sha256 } from '../lib/tax/snapshot';

async function main(){
 const db=new PGlite({extensions:{pgcrypto}}),output='/tmp/vibecount-native-event-scope-demo';
 try{
  await db.exec(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../supabase/migrations/',import.meta.url),target='20261019140000_native_bank_event_scope.sql',names=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort();
  for(const n of names.filter(n=>n<target))await db.exec(await readFile(new URL(n,dir),'utf8'));
  await db.exec('begin');const f=await nativeBalanceFixture(db);await db.exec('reset role');
  const account=(await db.query<{account_id:string}>('select account_id from bank_transactions where id=$1',[f.receipt])).rows[0].account_id;
  const tables=['invoice_settlements','invoice_refund_assignments','invoice_refund_assignment_reversals','settlement_requests','invoice_refund_requests','financial_records','classification_decisions'];
  const history=async()=>{await db.exec('reset role');const rows=[];for(const table of tables)rows.push((await db.query(`select to_jsonb(t)::text r from ${table} t order by to_jsonb(t)::text`)).rows);return sha256(JSON.stringify(rows))};
  const before=await history();await db.exec(await readFile(new URL(target,dir),'utf8'));assert.equal(await history(),before);
  const allocations='select approve_invoice_allocations($1,$2,$3,$4,$5,$6) r',assignments='select approve_invoice_refund_assignment($1,$2,$3,$4,$5,$6,$7) r';
  await f.auth();assert.deepEqual((await db.query<{r:unknown}>(allocations,f.allocationArgs)).rows[0].r,f.allocationResult);assert.deepEqual((await db.query<{r:unknown}>(assignments,f.assignmentArgs)).rows[0].r,f.assignmentResult);
  const totals=async()=>{await db.exec('reset role');return(await db.query<{income:string;expense:string}>("select coalesce(sum(amount*100*effect_sign) filter(where record_type='income'),0)::text income,coalesce(sum(amount*100*effect_sign) filter(where record_type='expense'),0)::text expense from financial_records where status='approved'")).rows[0]};
  const originalTotals=await totals(),rejections:Record<string,unknown>[]=[];
  await db.exec('savepoint unsupported');await openSyntheticForeignAdmission(db);await syntheticAccountCurrency(db,account,'USD');
  const allocation=(await db.query<{id:string}>('select id from active_invoice_allocations where invoice_id=$1',[f.ids.partial])).rows[0].id;
  for(const[label,sql,args]of [['fresh_allocation',allocations,[...f.allocationArgs.slice(0,4),randomUUID(),f.allocationArgs[5]]],['fresh_reversal','select reverse_invoice_allocation($1,$2,$3)',[allocation,'Synthetic unsupported reversal',randomUUID()]]]as const){
   const frozen=await history();await db.exec('savepoint denial');await f.auth();let rejected=false;try{await db.query(sql,[...args])}catch(error){assert.match(String(error),/Native review requires actual GBP bank cash/);rejected=true}assert.equal(rejected,true);await db.exec('rollback to savepoint denial');assert.equal(await history(),frozen);rejections.push({action:label,rejected:true,financial_history_unchanged:true});
  }
  await f.auth();assert.deepEqual((await db.query<{r:unknown}>(allocations,f.allocationArgs)).rows[0].r,f.allocationResult);assert.deepEqual((await db.query<{r:unknown}>(assignments,f.assignmentArgs)).rows[0].r,f.assignmentResult);
  await db.exec('rollback to savepoint unsupported');await f.auth();const request=randomUUID(),args=[allocation,'Synthetic valid native cleanup',request],result=(await db.query<{r:unknown}>('select reverse_invoice_allocation($1,$2,$3) r',args)).rows[0].r;assert.deepEqual(await totals(),originalTotals);
  await f.auth();assert.deepEqual((await db.query<{r:unknown}>('select reverse_invoice_allocation($1,$2,$3) r',args)).rows[0].r,result);
  await db.exec('rollback');await db.exec('reset role');
  assert.equal((await db.query<{n:number}>('select count(*)::int n from financial_records')).rows[0].n,0);assert.equal((await db.query<{n:number}>('select count(*)::int n from invoice_settlements')).rows[0].n,0);
  assert.equal((await db.query<{v:string|null}>("select to_regprocedure('public.guard_native_bank_event()')::text v")).rows[0].v,null);
  assert.equal((await db.query<{n:number}>("select count(*)::int n from pg_constraint where conrelid='public.financial_accounts'::regclass and conname='financial_accounts_currency_check'")).rows[0].n,1);
  assert.equal((await db.query<{v:string}>("select is_nullable v from information_schema.columns where table_schema='public' and table_name='bank_transactions' and column_name='signed_amount_pence'")).rows[0].v,'NO');
  const report={synthetic_only:true,ordered_migrations:78,retained_history_preserved_on_upgrade:true,retained_requests_recover_after_account_corruption:true,rejections,native_cleanup_recovered_exactly:true,recognised_totals_unchanged:originalTotals,all_fixtures_and_target_upgrade_rolled_back:true,foreign_admission_restored:true,scope:'Financial event containment only; UI/graph envelopes and dimensioned exports remain separate work.'};
  await mkdir(output,{recursive:true});const body=JSON.stringify(report,null,2);await writeFile(output+'/report.json',body);await writeFile(output+'/manifest.json',JSON.stringify({synthetic_only:true,files:[{name:'report.json',size_bytes:Buffer.byteLength(body),sha256:sha256(body)}]},null,2));console.log(JSON.stringify({output,rejected_actions:rejections.length,exact_recovery:true,recognised_totals_unchanged:true,rolled_back:true}));
 }finally{await db.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});

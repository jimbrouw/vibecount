// Synthetic disposable SQL demonstration. No hosted services or real financial approvals.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
import { financeCurrencyFixture } from '../lib/database/finance-currency-fixture';
import { bankValuationFixture, openSyntheticForeignAdmission } from '../lib/database/bank-valuation-fixture';
import { prepareCurrentFinancePlan, prepareBankCoveredFinancePlan } from '../lib/finance/snapshot';
import { verifyPlanRevision, type PlanRevision } from '../lib/finance/server';
import { sha256 } from '../lib/tax/snapshot';
import { rateFromDecimal } from '../lib/fx/currency';

async function main(){
const output='/tmp/vibecount-finance-bank-coverage-demo',db=new PGlite({extensions:{pgcrypto}});
try{
 await db.exec(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../supabase/migrations/',import.meta.url),names=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort(),target='20261019130000_finance_bank_source_coverage.sql',predecessor='20261018210000_finance_invoice_currency_coverage.sql';
 for(const n of names.filter(n=>n<predecessor))await db.exec(await readFile(new URL(n,dir),'utf8'));
 const f=await financeCurrencyFixture(db),sql='select capture_finance_plan($1,$2,$3,$4,$5,$6,$7,$8) r';await db.exec('reset role');for(const n of names.filter(n=>n>=predecessor&&n<target))await db.exec(await readFile(new URL(n,dir),'utf8'));
 const oldContext=await f.context(),v2=prepareCurrentFinancePlan(f.owner,f.plan,f.today,f.catalog,oldContext.invoice_coverage),oldArgs=[f.owner,oldContext.ordinal,oldContext.stamp,v2.inputJson,v2.resultJson,v2.rulesJson,'Synthetic V2 predecessor',randomUUID()];await f.service();const oldId=(await db.query<{r:string}>(sql,oldArgs)).rows[0].r;
 await db.exec('reset role;begin');await db.exec(await readFile(new URL(target,dir),'utf8'));
 const states:Record<string,unknown>[]=[],snapshots:ReturnType<typeof verifyPlanRevision>[]=[],requests:{id:string;args:unknown[]}[]=[];
 async function save(label:string){const ctx=await f.context(),p=prepareBankCoveredFinancePlan(f.owner,f.plan,f.today,f.catalog,ctx.invoice_coverage,ctx.bank_source_coverage);assert.deepEqual(p.result.scenario,f.legacy.result);const args=[f.owner,ctx.ordinal,ctx.stamp,p.inputJson,p.resultJson,p.rulesJson,'Synthetic '+label,randomUUID()];await f.service();const id=(await db.query<{r:string}>(sql,args)).rows[0].r;await f.auth();const row=(await db.query<PlanRevision>('select * from finance_plan_revisions where id=$1',[id])).rows[0];snapshots.push(verifyPlanRevision(row,f.owner));requests.push({id,args});states.push({state:label,input_sha256:p.inputHash,status:p.result.status,free_cash:p.result.current_free_cash_pence,drawings:p.result.additional_drawings_ceiling_pence,manual_cash:p.result.scenario.actual_cash_pence,pension_inaccessible:p.result.scenario.pension_assets_pence,foreign_accounts:ctx.bank_source_coverage.counts.foreign_accounts,observations:ctx.bank_source_coverage.counts.observations});return p}
 const native=await save('native_manual_scenario');assert.equal(native.result.status,'estimate');await db.exec('reset role');await openSyntheticForeignAdmission(db);
 const empty=randomUUID();await db.query("insert into financial_accounts(id,user_id,label,provider,account_type,currency,masked_identifier) values($1,$2,'Synthetic empty USD','generic','bank','USD','1234')",[empty,f.owner]);assert.equal((await save('empty_foreign_account')).result.status,'incomplete');
 await db.exec('reset role');const foreign=await bankValuationFixture(db,'KWD','-10.001',f.owner);await save('unvalued');
 for(const[ordinal,state]of [[0,'provisional'],[1,'reviewed'],[2,'reviewed']]as const){await db.exec('reset role');const patch=ordinal===2?{data:{method:'documented_rate/1',rate:rateFromDecimal('KWD','GBP','0.00001'),valuation_date:'2026-04-06',evidence_date:'2026-04-07'}}:{};await foreign.record(await foreign.intent({expected_ordinal:ordinal,state,human_read_original:state==='reviewed',...patch}));await save(ordinal===2?'reviewed_zero':state)}
 await db.exec('reset role');await db.query('delete from storage.objects where name=$1',[foreign.path]);await save('stale_source');await db.exec('reset role');await foreign.record(await foreign.intent({expected_ordinal:3,state:'withdrawn',document_id:null,transaction_version:null,data:null,human_read_original:false}));await save('withdrawn');
 for(const s of states.slice(1)){assert.equal(s.status,'incomplete');assert.equal(s.free_cash,null);assert.equal(s.drawings,null)}
 await f.service();for(const{args,id}of[{args:f.args,id:f.id},{args:oldArgs,id:oldId},...requests])assert.equal((await db.query<{r:string}>(sql,args)).rows[0].r,id);
 await db.exec('rollback');await db.exec('reset role');assert.equal((await db.query<{n:number}>('select count(*)::int n from financial_records')).rows[0].n,0);assert.equal((await db.query<{n:number}>("select count(*)::int n from finance_plan_revisions where input->>'schema_version'='finance-plan-input/3'")).rows[0].n,0);
 assert.equal((await db.query<{v:string|null}>("select to_regprocedure('public.finance_bank_sources_blocked(jsonb)')::text v")).rows[0].v,null);
 assert.equal((await db.query<{n:number}>("select count(*)::int n from pg_constraint where conrelid='public.financial_accounts'::regclass and conname='financial_accounts_currency_check'")).rows[0].n,1);
 assert.equal((await db.query<{v:string}>("select is_nullable v from information_schema.columns where table_schema='public' and table_name='bank_transactions' and column_name='signed_amount_pence'")).rows[0].v,'NO');
 await mkdir(output,{recursive:true});const report={synthetic_only:true,ordered_migrations:77,states,exact_legacy_and_current_recovery:true,recognised_effects_unchanged:true,new_snapshots_and_target_upgrade_rolled_back:true,foreign_admission_guards_restored:true,scope:'Manual GBP scenario; source metadata is not readable evidence, bank balance verification or tax certification.'};
 const files=[['report.json',JSON.stringify(report,null,2)],['snapshots.json',JSON.stringify(snapshots,null,2)]];
 const manifest=[];for(const[name,body]of files){await writeFile(output+'/'+name,body);manifest.push({name,sha256:sha256(body),size_bytes:Buffer.byteLength(body)})}await writeFile(output+'/manifest.json',JSON.stringify({synthetic_only:true,files:manifest},null,2));
 console.log(JSON.stringify({output,states:states.length,verified_effects_unchanged:true,exact_recovery:true,rolled_back:true}));
}finally{await db.close()}

}
main().catch(error=>{console.error(error);process.exitCode=1});

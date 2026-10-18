// Disposable synthetic source-to-capture demonstration. Never connects to hosted Supabase.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {TEST_SCHEMA_BOOTSTRAP} from '../lib/database/test-schema';
import {taxCurrencyFixture} from '../lib/database/tax-currency-fixture';
import {bankValuationFixture,openSyntheticForeignAdmission} from '../lib/database/bank-valuation-fixture';
import {canonicalJson,prepareCalculation} from '../lib/tax/snapshot';
import {buildFilingPack,verifyFilingPack,type SavedFilingPack} from '../lib/tax/filing-pack';

async function main(){
const output=resolve(process.argv[2]??'/tmp/vibecount-foreign-accounting-demo');await mkdir(output,{recursive:true});
const db=new PGlite({extensions:{pgcrypto}});
try{
 await db.exec(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../supabase/migrations/',import.meta.url),names=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort();
 for(const name of names)await db.exec(await readFile(new URL(name,dir),'utf8'));
 const f=await taxCurrencyFixture(db);await db.exec('reset role');await openSyntheticForeignAdmission(db);
 const source=await bankValuationFixture(db,'KWD','-10.001',f.owner),valuation=await source.record(await source.intent()) as {id:string};
 await f.auth();const review=(await db.query<{r:{stamp:string;categories:{id:string;record_type:string}[]}}>('select read_foreign_classification_review($1) r',[source.transaction])).rows[0].r;
 await db.query('select confirm_foreign_classification($1)',[JSON.stringify({schema_version:'foreign-classification-intent/1',transaction_id:source.transaction,transaction_version:0,valuation_revision_id:valuation.id,classification:'Mixed',category_id:review.categories.find(c=>c.record_type==='expense')!.id,business_use_bps:3000,rounding_policy:'gbp_business_share_half_up/1',treatment_reviewed:true,expected_stamp:review.stamp,rationale:'Synthetic reviewed 30 percent business share',request_id:randomUUID(),human_confirmed:true})]);
 const prepared=prepareCalculation(await f.input());assert.equal(prepared.input.schema_version,'tax-calculation-input/4');assert.equal(prepared.result.totals.ledger_expenses,750);
 assert.ok(!prepared.result.issues.some(i=>['bank_source_coverage','currency_branch'].includes(i.code)));
 await f.service();const calculation=(await db.query<{r:string}>('select capture_tax_calculation($1,2025,$2,$3,$4,$5,$6) r',[f.owner,prepared.inputJson,prepared.resultJson,prepared.rulesJson,'Synthetic accounting demo',randomUUID()])).rows[0].r;
 const input=await f.packInput(calculation),bundle=buildFilingPack(input,[],randomUUID(),false);assert.equal(bundle.schema_version,'draft-filing-pack/7');assert.equal(bundle.review_status,'draft_incomplete');
 await f.service();const pack=(await db.query<{r:string}>('select capture_filing_pack($1,$2,$3,$4,$5,$6) r',[f.owner,calculation,canonicalJson(input),canonicalJson(bundle),'Synthetic draft demo',bundle.request_id])).rows[0].r;
 await f.auth();verifyFilingPack((await db.query<SavedFilingPack>('select * from filing_packs where id=$1',[pack])).rows[0]);
 for(const a of bundle.artifacts)await writeFile(resolve(output,a.name),a.body);
 await build({absWorkingDir:process.cwd(),bundle:true,platform:'node',format:'cjs',jsx:'automatic',outfile:resolve(output,'render.cjs'),stdin:{resolveDir:process.cwd(),sourcefile:'accounting-demo.tsx',loader:'tsx',contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Coverage from './app/dashboard/tax-prep/BankAccountingCoverage';export const render=(input)=>renderToStaticMarkup(<Coverage input={input} coverage={input.bank_source_coverage}/>);`}});
 const html=createRequire(import.meta.url)(resolve(output,'render.cjs')).render(prepared.input) as string;
 assert.match(html,/GBP 7\.50/);assert.match(html,/seven pounds and fifty pence/);assert.match(html,/0 need source or accounting review/);
 await writeFile(resolve(output,'readback.html'),'<!doctype html><html lang="en"><meta charset="utf-8"><title>Synthetic foreign accounting review</title><body><h1>Synthetic local demonstration</h1><p>Disposable fixtures. No hosted account, real approval or filing. The pack remains incomplete because required tax facts and reviews are missing.</p>'+html+'</body></html>');
 await writeFile(resolve(output,'report.json'),JSON.stringify({synthetic_only:true,migration_count:names.length,input_version:prepared.input.schema_version,filing_version:input.schema_version,bundle_version:bundle.schema_version,original:{currency:'KWD',signed_minor:'-10001'},recognized_expense_pence:750,review_status:bundle.review_status,remaining_issues:bundle.blocking_issues,artifacts:bundle.artifacts.map(({name,sha256,size_bytes})=>({name,sha256,size_bytes})),hosted_changes:0,provider_calls:0},null,2));
 source.key.fill(0);console.log('Verified synthetic accounting capture, seven artifacts and server-rendered readback: '+output);
}finally{await db.close()}

}
main().catch(error=>{console.error(error);process.exitCode=1});

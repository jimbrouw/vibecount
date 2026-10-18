// Disposable real SQL, synthetic encrypted evidence, no public financial writer.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFxSourceManifestFixture } from '../lib/database/fx-source-export-fixture';
import { canonicalJson, prepareCalculation } from '../lib/tax/snapshot';
import { buildFilingPack, verifyFilingPack, type FilingPackInput, type SavedFilingPack } from '../lib/tax/filing-pack';
import type { CalculationInput } from '../lib/tax/calculation';
import { readFxExportFixture } from '../lib/database/fx-export-fixture';
import { dimensionedReconciliationExport } from '../lib/records/reconciliation-dimensioned-export';
import { parseFxLotPortions } from '../lib/fx/settlement-history';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from '../lib/database/test-schema';
import { fxConversionLotFixture } from '../lib/database/fx-lot-fixture';
import { authoritativeFxSettlementReview, fxSettlementChoices, parseFxSettlementCatalog } from '../lib/fx/settlement-catalog';
import { rateFromDecimal } from '../lib/fx/currency';
async function main(){
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(TEST_SCHEMA_BOOTSTRAP);const dir=new URL('../supabase/migrations/',import.meta.url),migration='20261019020000_fx_settlement_catalog.sql';
  for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<migration).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
  const x=await fxConversionLotFixture(db),{f}=x;await db.exec('reset role');await db.exec(await readFile(new URL(migration,dir),'utf8'));await db.exec(await readFile(new URL('20261019030000_fx_dependency_review.sql',dir),'utf8'));await db.exec(await readFile(new URL('20261019040000_fx_lot_review_sources.sql',dir),'utf8'));await db.exec(await readFile(new URL('20261019050000_fx_source_filing_provenance.sql',dir),'utf8'));
  await f.auth();const native=(await db.query<{t:string}>('select to_jsonb(updated_at) t from invoices where id=$1',[f.native])).rows[0].t;await db.query('select approve_invoice_allocations($1,$2,$3,$4,$5,$6)',[x.tx,1,JSON.stringify([{invoice_id:f.native,invoice_updated_at:native,amount_pence:1}]),'Synthetic native cash penny',randomUUID(),0]);
  const read=async()=>{await f.auth();return parseFxSettlementCatalog(f.owner,(await db.query<{r:unknown}>('select read_fx_settlement_catalog() r')).rows[0].r);};
  const initial=await read(),reviews=[];
  for(const [original,cash]of [[5000,1250],[5000,1250],[1,0]]){
   const catalog=await read(),choice=fxSettlementChoices(catalog).find(c=>c.conversion_fact_revision_id===x.conversion)!;
   const preview=authoritativeFxSettlementReview(f.owner,{schema_version:'fx-settlement-intent/1',ruleset_id:'vibecount-currencies/1',receipt_id:x.tx,receipt_version:1,expected_stamp:catalog.financial_stamp,rationale:'Synthetic authoritative catalog review',request_id:randomUUID(),fee_mode:'none',receipt_valuation_id:null,receipt_valuation_evidence_revision_id:null,
    allocations:[{invoice_id:x.intent.invoice_id,invoice_revision_id:(x.saved as {revision_id:string}).revision_id,invoice_minor:original,cash_minor:cash,conversion_date:'2026-04-06',rate:rateFromDecimal('KWD','GBP','2.5'),invoice_evidence_id:x.intent.source_fact_family_id,invoice_evidence_revision_id:x.intent.source_fact_revision_id,conversion_evidence_id:choice.conversion_family_id,conversion_evidence_revision_id:x.conversion,conversion_lot_id:choice.lot_id??x.lot,conversion_lot_version:choice.lot_version}]},catalog);
   reviews.push(preview.result);await db.exec('reset role');await db.query('select approve_fx_invoice_allocations($1)',[JSON.stringify(preview.intent)]);
  }
  const allocated=await read();assert.equal(allocated.lots[0].active_count,3);assert.equal(allocated.lots[0].version,3);
  const portionReview=parseFxLotPortions(f.owner,(await db.query<{r:unknown}>('select read_fx_lot_portions($1) r',[x.lot])).rows[0].r);assert.equal(portionReview.portions.length,3);assert.equal(portionReview.portions[2].amount_pence,0);
  const allocatedExport=dimensionedReconciliationExport(await readFxExportFixture(db,f.owner));
  const sourceManifest=await readFxSourceManifestFixture(db,f.owner,x.tx);await f.auth();
  const prepared=prepareCalculation((await db.query<{r:CalculationInput}>('select read_tax_calculation_input(2025) r')).rows[0].r);
  await f.service();const calculation=(await db.query<{r:string}>('select capture_tax_calculation($1,2025,$2,$3,$4,$5,$6) r',[f.owner,prepared.inputJson,prepared.resultJson,prepared.rulesJson,'Synthetic FX context calculation',randomUUID()])).rows[0].r;
  await f.auth();const packInput=(await db.query<{r:FilingPackInput}>('select read_tax_filing_pack_input($1) r',[calculation])).rows[0].r;
  const bundle=buildFilingPack(packInput,[],randomUUID(),false);assert.equal(bundle.schema_version,'draft-filing-pack/4');assert.equal(bundle.completeness_attested,false);
  await f.service();const packArgs=[f.owner,calculation,canonicalJson(packInput),canonicalJson(bundle),'Synthetic FX context pack',bundle.request_id],pack=(await db.query<{r:string}>('select capture_filing_pack($1,$2,$3,$4,$5,$6) r',packArgs)).rows[0].r;

  await db.exec('reset role');await db.query("delete from storage.objects where bucket_id='document-evidence' and name=$1",[f.path]);
  const unavailable=await read();assert.equal(fxSettlementChoices(unavailable).find(c=>c.conversion_fact_revision_id===x.conversion)!.eligible,false);assert.equal(unavailable.lots[0].prior_invoice_minor,10001);assert.deepEqual(await readFxSourceManifestFixture(db,f.owner,x.tx),sourceManifest);await f.auth();assert.equal(dimensionedReconciliationExport(await readFxExportFixture(db,f.owner)).csv,allocatedExport.csv);
  await db.exec('reset role');await db.query('select reverse_fx_conversion_lot($1,$2,$3,$4)',[x.lot,unavailable.financial_stamp,'Synthetic complete reviewed reversal',randomUUID()]);
  const reversed=await read();assert.equal(reversed.lots[0].version,6);assert.equal(reversed.lots[0].active_count,0);
  await db.exec('reset role');assert.deepEqual((await db.query<{r:unknown}>('select to_jsonb(r) r from financial_records r where bank_transaction_id=$1',[x.tx])).rows,x.before);
  const reversedExport=dimensionedReconciliationExport(await readFxExportFixture(db,f.owner));
  const output='/tmp/vibecount-fx-source-filing-demo';await mkdir(output,{recursive:true});
  await f.service();assert.equal((await db.query<{r:string}>('select capture_filing_pack($1,$2,$3,$4,$5,$6) r',packArgs)).rows[0].r,pack);await f.auth();verifyFilingPack((await db.query<SavedFilingPack>('select * from filing_packs where id=$1',[pack])).rows[0]);
  await writeFile(output+'/source-manifest-v3.json',JSON.stringify(sourceManifest,null,2)+'\n');await writeFile(output+'/filing-pack-v4.json',canonicalJson(bundle)+'\n');for(const artifact of bundle.artifacts)await writeFile(output+'/'+artifact.name,artifact.body);
  await writeFile(output+'/allocated-reconciliation.csv',allocatedExport.csv);await writeFile(output+'/reversed-reconciliation.csv',reversedExport.csv);
  await writeFile(output+'/manifest.json',JSON.stringify({synthetic_only:true,schema:allocatedExport.schema_version,allocated:{rows:allocatedExport.count,sha256:createHash('sha256').update(allocatedExport.csv).digest('hex')},reversed:{rows:reversedExport.count,sha256:createHash('sha256').update(reversedExport.csv).digest('hex')},source_loss_preserves_export_bytes:true,source_manifest_version:sourceManifest.schema_version,filing_bundle_version:bundle.schema_version,completeness_attested:false,filing_artifacts:bundle.artifacts.map(a=>({name:a.name,sha256:a.sha256,size_bytes:a.size_bytes})),financial_writer_grants:'private',hosted_acceptance:false},null,2)+'\n');
  await writeFile(output+'/catalog.json',JSON.stringify({synthetic_only:true,private_writers_only:true,initial,choices:fxSettlementChoices(initial),reviews,allocated,portionReview,unavailable,reversed,recognized_income_unchanged:true},null,2)+'\n');
  await writeFile(output+'/README.md','# Synthetic retained FX source/filing provenance demo\n\nActual ordered SQL and encrypted synthetic invoice evidence allocate KWD 10.001 to GBP 25.00 across three retained portions, including a final positive-original/zero-cash portion. A native GBP 0.01 allocation shares the GBP 25.01 receipt. V4 exports show original units, actual cash, complete event ancestry, separate native/FX receipt cash, canonical/fact/document hashes and non-additive balances. Matching creates zero new income.\n\nThe complete active-portion RPC validates every portion against aggregate review. Source-object loss blocks fresh allocations but leaves historical export bytes unchanged. Complete private reversal retains six FX events and releases both FX capacities while preserving the native penny and recognised receipt bytes. Manifest hashes cover the generated CSV bytes.\n\nOnly safe synthetic metadata is emitted. Financial writer grants remain private. The source manifest V3 and seven-artifact filing bundle V4 retain complete history as context. The 2025/26 pack includes the 2026/27 receipt as cross-year context with zero additional year income. Unsupported external/FX coverage keeps the pack incomplete. This is not hosted Auth/PostgREST/Storage acceptance, actual human evidence review, foreign-account valuation, fees/refunds, tax certification or full handover completion. No real financial approval, bank connection, provider call, send, payment, hosted migration, deployment or filing occurs.\n');
  console.log('Verified retained FX source manifest V3 and filing bundle V4: '+output);
 }finally{await db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

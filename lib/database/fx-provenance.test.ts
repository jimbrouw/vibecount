import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { serialSubtest } from './serial-subtest';
import { taxCurrencyFixture } from './tax-currency-fixture';
import { fxConversionLotFixture } from './fx-lot-fixture';
import { rateFromDecimal } from '../fx/currency';
import { canonicalJson, prepareCalculation } from '../tax/snapshot';
import { buildFilingPack, buildFilingReview, verifyFilingPack, type FilingPackInput, type SavedFilingPack } from '../tax/filing-pack';
import type { CalculationInput } from '../tax/calculation';
import { parseFxProvenance } from '../fx/provenance';
import { readFxSourceManifestFixture } from './fx-source-export-fixture';

test('source/filing FX provenance upgrades preserve captured bytes and exact retries while new inputs bind full history', async t => {
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url),migration='20261019050000_fx_source_filing_provenance.sql';
 for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<migration).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 const native=await taxCurrencyFixture(db);await db.exec('reset role');
 const x=await fxConversionLotFixture(db),{f}=x;
 const stamp=async()=>{await f.auth();return(await db.query<{s:string}>('select fx_settlement_review_stamp() s')).rows[0].s;};
 const family=(await db.query<{family_id:string}>('select family_id from fx_document_fact_revisions where id=$1',[x.conversion])).rows[0].family_id;
 for(const [version,original,cash]of [[0,5000,1250],[1,5000,1250],[2,1,0]]){
  const intent={schema_version:'fx-settlement-intent/1',ruleset_id:'vibecount-currencies/1',receipt_id:x.tx,receipt_version:1,expected_stamp:await stamp(),rationale:'Synthetic source provenance allocation',request_id:randomUUID(),fee_mode:'none',receipt_valuation_id:null,receipt_valuation_evidence_revision_id:null,
   allocations:[{invoice_id:x.intent.invoice_id,invoice_revision_id:(x.saved as {revision_id:string}).revision_id,invoice_minor:original,cash_minor:cash,conversion_date:'2026-04-06',rate:rateFromDecimal('KWD','GBP','2.5'),invoice_evidence_id:x.intent.source_fact_family_id,invoice_evidence_revision_id:x.intent.source_fact_revision_id,conversion_evidence_id:family,conversion_evidence_revision_id:x.conversion,conversion_lot_id:x.lot,conversion_lot_version:version}]};
  await db.exec('reset role');await db.query('select approve_fx_invoice_allocations($1)',[JSON.stringify(intent)]);
 }
 await f.auth();const prepared=prepareCalculation((await db.query<{r:CalculationInput}>('select read_tax_calculation_input(2025) r')).rows[0].r);
 await f.service();const calculation=(await db.query<{r:string}>('select capture_tax_calculation($1,2025,$2,$3,$4,$5,$6) r',[f.owner,prepared.inputJson,prepared.resultJson,prepared.rulesJson,'Synthetic incomplete FX calculation',randomUUID()])).rows[0].r;
 const input=async()=>{await f.auth();return(await db.query<{r:FilingPackInput}>('select read_tax_filing_pack_input($1) r',[calculation])).rows[0].r;};
 const previous=await input(),request=randomUUID(),oldBundle=buildFilingPack(previous,[],request,false),oldArgs=[f.owner,calculation,canonicalJson(previous),canonicalJson(oldBundle),'Synthetic predecessor FX pack',request];
 await f.service();const oldId=(await db.query<{r:string}>('select capture_filing_pack($1,$2,$3,$4,$5,$6) r',oldArgs)).rows[0].r;
 const step=buildFilingReview(previous,[]).steps[0],stepArgs=[f.owner,calculation,canonicalJson(previous),step.id,step.digest,JSON.stringify(step.data),'Synthetic predecessor review',randomUUID()];
 const stepId=(await db.query<{r:string}>('select review_filing_pack_step($1,$2,$3,$4,$5,$6,$7,$8) r',stepArgs)).rows[0].r;
 await f.auth();const oldRow=(await db.query<SavedFilingPack>('select * from filing_packs where id=$1',[oldId])).rows[0];
 const identities=async()=>(await db.query<{name:string;id:number}>("select oid::int id,proname name from pg_proc where oid in ('public.tax_filing_pack_input_for_owner(uuid,uuid)'::regprocedure,'public.capture_filing_pack(uuid,uuid,text,text,text,uuid)'::regprocedure,'public.freeze_tax_pack_inputs()'::regprocedure) order by proname")).rows;
 await db.exec('reset role');const oids=await identities();await db.exec(await readFile(new URL(migration,dir),'utf8'));
 let savedArgs:unknown[]=[],savedId='';
 await serialSubtest(t,'OID-preserving upgrade leaves native arithmetic, old captures and step retries unchanged',async()=>{
  assert.deepEqual(await identities(),oids);
  await native.service();assert.equal((await db.query<{r:string}>('select capture_filing_pack($1,$2,$3,$4,$5,$6) r',native.packArgs)).rows[0].r,native.pack);
  assert.deepEqual((await native.packInput()).calculation.result,native.oldPack.input.calculation.result);
  await f.service();assert.equal((await db.query<{r:string}>('select capture_filing_pack($1,$2,$3,$4,$5,$6) r',oldArgs)).rows[0].r,oldId);
  assert.equal((await db.query<{r:string}>('select review_filing_pack_step($1,$2,$3,$4,$5,$6,$7,$8) r',stepArgs)).rows[0].r,stepId);
  await f.auth();assert.deepEqual((await db.query<SavedFilingPack>('select * from filing_packs where id=$1',[oldId])).rows[0],oldRow);assert.equal(verifyFilingPack(oldRow).schema_version,'draft-filing-pack/3');
 });
 await serialSubtest(t,'actual input3 includes complete zero-cash history through cross-year receipt context exactly once',async()=>{
  const current=await input();assert.equal(current.schema_version,'filing-pack-input/3');if(current.schema_version!=='filing-pack-input/3')throw new Error('V3 required');
  const fx=parseFxProvenance(f.owner,current.fx_provenance,current.observations);
  assert.equal(fx.lots.length,1);assert.equal(fx.events.length,3);assert.equal(fx.events.find(e=>e.lot_event_ordinal===3)!.amount_pence,0);
  assert.equal(current.observations.find(o=>o.id===x.tx)!.in_tax_year,false);assert.equal(current.calculation.result.totals.ledger_income,0);
  assert.equal(current.reconciliation.filter(e=>fx.events.some(f=>f.id===e.id)).length,0);
  const sourceManifest=await readFxSourceManifestFixture(db,f.owner,x.tx);assert.equal(sourceManifest.snapshot.fx_provenance.events.length,3);assert.equal(sourceManifest.snapshot.recognized_income_pence,'2501');
  assert.equal(current.calculation_is_current,true);assert.throws(()=>buildFilingPack(current,[],randomUUID(),true),/completeness/);
  const bundle=buildFilingPack(current,[],randomUUID(),false);assert.equal(bundle.schema_version,'draft-filing-pack/4');
  for(const name of ['calculation-trace.json','evidence-manifest.json'])assert.equal(JSON.parse(bundle.artifacts.find(a=>a.name===name)!.body).fx_provenance.events.length,3);
  savedArgs=[f.owner,calculation,canonicalJson(current),canonicalJson(bundle),'Synthetic FX provenance pack',bundle.request_id];
  await f.service();savedId=(await db.query<{r:string}>('select capture_filing_pack($1,$2,$3,$4,$5,$6) r',savedArgs)).rows[0].r;
  assert.equal((await db.query<{r:string}>('select capture_filing_pack($1,$2,$3,$4,$5,$6) r',savedArgs)).rows[0].r,savedId);
  const forged={...bundle,review_status:'draft_reviewed',completeness_attested:true};
  await assert.rejects(db.query('select capture_filing_pack($1,$2,$3,$4,$5,$6)',[f.owner,calculation,canonicalJson(current),canonicalJson(forged),'Synthetic optimistic rejection',randomUUID()]),/Unsupported invoice currency/);
  await assert.rejects(db.query('select capture_filing_pack($1,$2,$3,$4,$5,$6)',[f.owner,calculation,canonicalJson(current),'x'.repeat(4000001),'Synthetic oversized rejection',randomUUID()]),/safe payload limit/);
  await f.auth();assert.equal(verifyFilingPack((await db.query<SavedFilingPack>('select * from filing_packs where id=$1',[savedId])).rows[0]).schema_version,'draft-filing-pack/4');
 });
 await serialSubtest(t,'withdrawal and object loss preserve retained source context and old/new exact request recovery',async()=>{
  const before=await input();if(before.schema_version!=='filing-pack-input/3')throw new Error('V3 required');
  const sourceBefore=await readFxSourceManifestFixture(db,f.owner,x.tx);await f.auth();
  const c=(await db.query<{r:{facts:{id:string;family_id:string}[]}}>('select read_fx_evidence_catalog() r')).rows[0].r;
  await x.review(await x.conversionIntent({family_id:c.facts.find(v=>v.id===x.conversion)!.family_id,expected_ordinal:1,state:'withdrawn',human_read_original:false,document_id:null,invoice_evidence_revision_id:null,transaction_id:null,transaction_version:null,data:null}));
  await db.exec('reset role');await db.query("delete from storage.objects where bucket_id='document-evidence' and name=$1",[f.path]);
  const after=await input();if(after.schema_version!=='filing-pack-input/3')throw new Error('V3 required');
  assert.deepEqual(after.fx_provenance,before.fx_provenance);
  assert.deepEqual(await readFxSourceManifestFixture(db,f.owner,x.tx),sourceBefore);await f.auth();
  assert.deepEqual(parseFxProvenance(f.owner,after.fx_provenance,after.observations),parseFxProvenance(f.owner,before.fx_provenance,before.observations));
  await f.service();for(const [args,id]of [[oldArgs,oldId],[savedArgs,savedId]] as const)assert.equal((await db.query<{r:string}>('select capture_filing_pack($1,$2,$3,$4,$5,$6) r',args)).rows[0].r,id);
  assert.equal((await db.query<{r:string}>('select review_filing_pack_step($1,$2,$3,$4,$5,$6,$7,$8) r',stepArgs)).rows[0].r,stepId);
  const changed=[...savedArgs];changed[4]='Changed retry reason';await assert.rejects(db.query('select capture_filing_pack($1,$2,$3,$4,$5,$6)',changed),/different inputs/);
 });
 await serialSubtest(t,'complete reversal retains six provenance events and scoped views/helpers remain owner-safe',async()=>{
  const s=await stamp();await db.exec('reset role');await db.query('select reverse_fx_conversion_lot($1,$2,$3,$4)',[x.lot,s,'Synthetic provenance reversal',randomUUID()]);
  const current=await input();if(current.schema_version!=='filing-pack-input/3')throw new Error('V3 required');
  const fx=parseFxProvenance(f.owner,current.fx_provenance,current.observations);assert.equal(fx.events.length,6);assert.equal(fx.lots[0].event_count,6);assert.equal(fx.lots[0].active_count,0);
  await native.auth();assert.equal((await db.query('select * from fx_provenance_lot_sources')).rows.length,0);
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('reset role;set role '+role);
   await assert.rejects(db.query('select fx_provenance_for_owner($1,$2)',[f.owner,[x.tx]]),/permission denied/);
   await assert.rejects(db.query('select tax_filing_pack_input_v2_for_owner($1,$2)',[f.owner,calculation]),/permission denied/);
   if(role!=='authenticated')await assert.rejects(db.query('select * from fx_provenance_lot_sources'),/permission denied/);
  }
 });
});

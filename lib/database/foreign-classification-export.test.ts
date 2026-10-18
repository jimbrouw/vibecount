import { packFixture } from '../tax/filing-pack-fixture';
import { buildFilingPack, verifyFilingPack, type FilingPackInput, type SavedFilingPack } from '../tax/filing-pack';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile,readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema';
import { bankValuationFixture,openSyntheticForeignAdmission } from './bank-valuation-fixture';
import { bankExportContext,type BankExportRow,type BankExportFamily } from '../records/bank-export-context';
import type { ForeignDecisionExportRow } from '../records/foreign-classification-export';
import { bankEvidenceLedger,bankEvidenceManifest,bankForeignDecisionLedger } from '../records/bank-dimensioned-export';
import { readSourceCsv } from '../records/source-csv';
import { FX_PROVENANCE_SCHEMA,FX_PROVENANCE_SCOPE } from '../fx/provenance';
import { parseBankAccountingCoverage } from '../records/bank-accounting-coverage';
import { calculateTax,type CalculationInput } from '../tax/calculation';
import { bankAccountingTaxScope } from '../tax/bank-accounting-scope';
import { canonicalJson, prepareCalculation, sha256 } from '../tax/snapshot';
import { rateFromDecimal } from '../fx/currency';

test('classified foreign exports reproduce every effect from exact retained valuation/share and retain correction/reversal ancestry',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());await db.exec(TEST_SCHEMA_BOOTSTRAP);
 const dir=new URL('../../supabase/migrations/',import.meta.url);for(const n of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(n,dir),'utf8'));
 await openSyntheticForeignAdmission(db);const f=await bankValuationFixture(db),valuation=await f.record(await f.intent()) as {id:string};
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.owner]);
 const accounting=async()=>{const raw=(await db.query<{r:unknown}>('select read_bank_accounting_coverage() r')).rows[0].r;return parseBankAccountingCoverage(raw,f.owner)};
 assert.equal((await accounting()).accounting[0].status,'unresolved');
 const taxPreview=async()=>{const prior=(await db.query<{r:CalculationInput}>('select tax_calculation_input_for_owner($1,2025) r',[f.owner])).rows[0].r;const input={...prior,schema_version:'tax-calculation-input/4',bank_source_coverage:(await db.query<{r:unknown}>('select read_bank_accounting_coverage() r')).rows[0].r} as CalculationInput;canonicalJson(input);if(input.schema_version!=='tax-calculation-input/4')throw new Error('Accounting input required');assert.equal((await db.query<{r:boolean}>('select tax_bank_sources_blocked($1) r',[JSON.stringify(input)])).rows[0].r,bankAccountingTaxScope(input,input.bank_source_coverage).blocks);return{input,result:calculateTax(input),prior:calculateTax(prior.schema_version==='tax-calculation-input/4'?{...prior,schema_version:'tax-calculation-input/3',bank_source_coverage:parseBankAccountingCoverage(prior.bank_source_coverage,prior.owner_id).source_coverage}:prior)}};
 const classify=async(classification:string,bps:number,valuationId:string|null)=>{
  const c=(await db.query<{r:{stamp:string;valuation:{transaction:{decision_version:number}};categories:{id:string;record_type:string}[]}}>('select read_foreign_classification_review($1) r',[f.transaction])).rows[0].r;
  return db.query('select confirm_foreign_classification($1)',[JSON.stringify({schema_version:'foreign-classification-intent/1',transaction_id:f.transaction,transaction_version:c.valuation.transaction.decision_version,valuation_revision_id:valuationId,classification,category_id:bps?c.categories.find(r=>r.record_type==='expense')!.id:null,business_use_bps:bps,rounding_policy:'gbp_business_share_half_up/1',treatment_reviewed:!!bps,expected_stamp:c.stamp,rationale:'Synthetic treatment review',request_id:randomUUID(),human_confirmed:true})]);
 };
 const read=async()=>{
  const coverage=(await db.query<{r:unknown}>('select read_bank_source_coverage() r')).rows[0].r;
  const rows=(await db.query<{r:BankExportRow}>(`select to_jsonb(t)||jsonb_build_object('source_rows',jsonb_build_object('row_number',s.row_number,'row_hash',s.row_hash),'record_imports',jsonb_build_object('id',i.id,'user_id',i.user_id,'source_file_id',i.source_file_id,'file_hash',i.file_hash,'parser_version',i.parser_version),'record',(select coalesce(jsonb_agg(to_jsonb(f)),'[]'::jsonb) from financial_records f where f.bank_transaction_id=t.id),'refund_portions','[]'::jsonb) r from bank_transactions t join source_rows s on s.id=t.source_row_id join record_imports i on i.id=t.import_id where t.user_id=$1`,[f.owner])).rows.map(r=>r.r);
  const families=(await db.query<BankExportFamily>('select id,user_id,transaction_id from bank_valuation_families where user_id=$1',[f.owner])).rows;
  const revisions=(await db.query<{r:unknown}>("select to_jsonb(v)-'fingerprint' r from bank_valuation_revisions v where user_id=$1",[f.owner])).rows.map(r=>r.r);
  const decisions=(await db.query<{r:ForeignDecisionExportRow}>(`select to_jsonb(d)||jsonb_build_object('request',jsonb_build_object('user_id',q.user_id,'request_id',q.request_id,'transaction_id',q.transaction_id,'version',q.version,'intent',q.intent,'result',q.result,'created_at',q.created_at)) r from classification_decisions d join foreign_classification_requests q on q.user_id=d.user_id and q.request_id=d.foreign_request_id where d.user_id=$1`,[f.owner])).rows.map(r=>r.r);
  const build=(history=decisions,records=rows)=>bankExportContext(f.owner,coverage,records,families,revisions,f.imported,history);
  return{context:build(),build,decisions,rows};
 };
 await classify('Business',10000,valuation.id);assert.equal((await accounting()).accounting[0].status,'approved');let exported=await read();assert.equal(exported.context.snapshot.observations[0].recognized_expense_pence,2500);
 await classify('Mixed',3000,valuation.id);assert.equal((await accounting()).accounting[0].recognized_expense_pence,750);const currentTax=await taxPreview();assert.equal(currentTax.result.totals.ledger_expenses,750);assert.ok(!currentTax.result.issues.some(i=>['currency_branch','bank_source_coverage'].includes(i.code)));assert.ok(currentTax.prior.issues.some(i=>i.code==='bank_source_coverage'));
 const prepared=prepareCalculation(currentTax.input),shell=packFixture();
 assert.equal(currentTax.input.schema_version,'tax-calculation-input/4');if(currentTax.input.schema_version!=='tax-calculation-input/4')throw new Error('Expected accounting input');
 const filing:FilingPackInput={...shell,schema_version:'filing-pack-input/5',owner_id:f.owner,
  calculation:{...shell.calculation,author:f.owner,input:currentTax.input,result:prepared.result,input_canonical_json:prepared.inputJson,input_sha256:prepared.inputHash,result_canonical_json:prepared.resultJson,result_sha256:prepared.resultHash},
  rules:{id:prepared.rules.id,canonical_json:prepared.rulesJson,sha256:prepared.rulesHash},invoice_coverage:currentTax.input.invoice_coverage,
  observations:currentTax.input.observations.map(o=>({...o,masked_identifier:o.account.masked_identifier,in_tax_year:true})),bank_source_coverage:currentTax.input.bank_source_coverage,
  fx_provenance:{schema_version:FX_PROVENANCE_SCHEMA,scope:FX_PROVENANCE_SCOPE,owner_id:f.owner,counts:{lots:0,events:0},lots:[],events:[]}};
 const mismatched=structuredClone(filing);mismatched.observations[0].recognized_pence=751;assert.throws(()=>buildFilingPack(mismatched,[],randomUUID(),false),/accounting projection/);
 const bundle=buildFilingPack(filing,[],randomUUID(),false);assert.equal(bundle.schema_version,'draft-filing-pack/6');
 const saved:SavedFilingPack={id:randomUUID(),tax_year_start:2025,input:filing,input_canonical_json:canonicalJson(filing),input_sha256:bundle.input_sha256,bundle,bundle_canonical_json:canonicalJson(bundle),bundle_sha256:sha256(canonicalJson(bundle)),reason:'Synthetic foreign filing',author:f.owner,created_at:'2026-10-18',request_id:bundle.request_id};
 verifyFilingPack(saved);
 const [fh,...fr]=readSourceCsv(bundle.artifacts.find(a=>a.name==='normalized-ledger.csv')!.body);
 const foreignRow=fr.find(r=>r[fh.indexOf('id')]===f.transaction)!;assert.equal(foreignRow[fh.indexOf('original_signed_minor')],'-10001');assert.equal(foreignRow[fh.indexOf('year_expense_pence')],'750');assert.deepEqual(JSON.parse(foreignRow[fh.indexOf('foreign_classification_history')]).map((d:{recognized_pence:number})=>d.recognized_pence),[2500,750]);
 assert.match(bundle.artifacts.find(a=>a.name==='expense-decisions.csv')!.body,/foreign_classification_proof/);
 for(const name of ['normalized-ledger.csv','expense-decisions.csv','calculation-trace.json','evidence-manifest.json']){
  const tamperedPack=structuredClone(saved),artifact=tamperedPack.bundle.artifacts.find(a=>a.name===name)!;
  if(name.endsWith('.json')){const body=JSON.parse(artifact.body);body.bank_source_coverage.classification_decisions=[];artifact.body=canonicalJson(body);}else artifact.body=artifact.body.replace('750','751');
  assert.notEqual(artifact.body,bundle.artifacts.find(a=>a.name===name)!.body);artifact.sha256=sha256(artifact.body);artifact.size_bytes=Buffer.byteLength(artifact.body);tamperedPack.bundle_canonical_json=canonicalJson(tamperedPack.bundle);tamperedPack.bundle_sha256=sha256(tamperedPack.bundle_canonical_json);
  assert.throws(()=>verifyFilingPack(tamperedPack),/integrity/);
 }
 const altered=structuredClone(currentTax.input);altered.records[0].amount_pence++;assert.throws(()=>calculateTax(altered),/canonical accounting proof/);const detached=structuredClone(currentTax.input);detached.records[0].bank_transaction_id=null;detached.records[0].amount_pence++;assert.throws(()=>calculateTax(detached),/canonical accounting source linkage/);const missing=structuredClone(currentTax.input);missing.records=[];assert.throws(()=>calculateTax(missing),/Complete foreign ledger/);exported=await read();const o=exported.context.snapshot.observations[0];assert.equal(o.recognized_expense_pence,750);assert.deepEqual(o.classification_history.map(d=>d.recognized_pence),[2500,750]);
 assert.throws(()=>exported.build(exported.decisions.slice(1)),/Complete foreign decision history/);
 const tampered=structuredClone(exported.decisions);tampered[1].recognized_pence=751;assert.throws(()=>exported.build(tampered),/amount differs/);
 const wrong=structuredClone(exported.decisions);wrong[1].bank_valuation_revision_id=randomUUID();assert.throws(()=>exported.build(wrong),/ancestry differs/);
 const wrongRecord=structuredClone(exported.rows);wrongRecord[0].recognized_record_id=randomUUID();assert.throws(()=>exported.build(exported.decisions,wrongRecord),/projection differs/);
 const ledger=bankEvidenceLedger(exported.context),[header,row]=readSourceCsv(ledger.csv);assert.equal(ledger.schema_version,'vibecount.evidence-ledger/4');assert.equal(JSON.parse(row[header.indexOf('foreign_classification_history_json')]).length,2);assert.equal(row[header.indexOf('actual_signed_gbp_pence')],'');
 await classify('Unknown',0,null);assert.equal((await accounting()).accounting[0].eligible,false);const zero=await f.record(await f.intent({transaction_version:3,expected_ordinal:1,data:{method:'documented_rate/1',rate:rateFromDecimal('KWD','GBP','0.00001'),valuation_date:'2026-04-06',evidence_date:'2026-04-07'}})) as {id:string};await classify('Business',10000,zero.id);assert.equal((await accounting()).accounting[0].status,'reviewed_zero');assert.equal((await taxPreview()).result.totals.ledger_expenses,0);
 exported=await read();assert.equal(exported.context.snapshot.observations[0].recognized_expense_pence,0);assert.equal(exported.context.snapshot.observations[0].classification_history.length,4);
 await db.query('delete from storage.objects where name=$1',[f.documentPath]);exported=await read();assert.equal(exported.context.snapshot.observations[0].valuation_status,'stale');assert.equal((await accounting()).accounting[0].status,'stale');const staleTax=await taxPreview();assert.ok(staleTax.result.issues.some(i=>i.code==='bank_source_coverage'));assert.equal(staleTax.result.totals.trade_profit,null);
 const reversal=(await db.query<{r:{stamp:string}}>('select read_foreign_import_reversal($1) r',[f.imported])).rows[0].r;await db.query('select reverse_foreign_import_reviewed($1,$2,$3,$4)',[f.imported,reversal.stamp,'Reviewed reversal',randomUUID()]);
 exported=await read();const final=exported.context.snapshot.observations[0];assert.equal(final.import_status,'discarded');assert.equal((await accounting()).accounting[0].status,'discarded');const reversedTax=await taxPreview();assert.equal(bankAccountingTaxScope(reversedTax.input,reversedTax.input.schema_version==='tax-calculation-input/4'?reversedTax.input.bank_source_coverage:null).blocks,false);assert.equal(final.classification_history.length,5);assert.equal(final.financial_records.length,1);assert.equal(final.financial_records[0].status,'excluded');const decisionLedger=bankForeignDecisionLedger(exported.context);assert.equal(decisionLedger.count,5);const [dh,...dr]=readSourceCsv(decisionLedger.csv);assert.equal(dr[1][dh.indexOf('recognized_gbp_pence')],'750');assert.equal(dr[4][dh.indexOf('classification')],'Unknown');
 const manifest=bankEvidenceManifest(f.owner,exported.context,{schema_version:FX_PROVENANCE_SCHEMA,scope:FX_PROVENANCE_SCOPE,owner_id:f.owner,counts:{lots:0,events:0},lots:[],events:[]});assert.equal(manifest.schema_version,'vibecount.evidence-manifest/5');assert.doesNotMatch(JSON.stringify(manifest),/object_path|raw_encrypted|key_id/);
 const proof=await accounting();assert.deepEqual(proof.source_coverage,(await db.query<{r:unknown}>('select read_bank_source_coverage() r')).rows[0].r);
 for(const role of ['anon','service_role']){await db.exec('set role '+role);await assert.rejects(accounting(),/permission denied/);await db.exec('reset role');}
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.other]);await db.exec('set role authenticated');const other=parseBankAccountingCoverage((await db.query<{r:unknown}>('select read_bank_accounting_coverage() r')).rows[0].r,f.other);assert.equal(other.accounting.length,0);assert.equal(other.source_coverage.observations.length,0);
 await db.exec('reset role');const personal=await bankValuationFixture(db,'EUR','-1.25');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[personal.owner]);await db.exec('set role authenticated');
 const personalReview=(await db.query<{r:{stamp:string}}>('select read_foreign_classification_review($1) r',[personal.transaction])).rows[0].r;
 await db.query('select confirm_foreign_classification($1)',[JSON.stringify({schema_version:'foreign-classification-intent/1',transaction_id:personal.transaction,transaction_version:0,valuation_revision_id:null,classification:'Personal',category_id:null,business_use_bps:0,rounding_policy:'gbp_business_share_half_up/1',treatment_reviewed:false,expected_stamp:personalReview.stamp,rationale:'Personal expense confirmed',request_id:randomUUID(),human_confirmed:true})]);
 const personalRaw=(await db.query<{r:unknown}>('select read_bank_accounting_coverage() r')).rows[0].r,personalProof=parseBankAccountingCoverage(personalRaw,personal.owner);assert.equal(personalProof.accounting[0].status,'personal');assert.equal(personalProof.accounting[0].record,null);assert.equal(personalProof.proof.observations[0].valuation_history.length,0);
 await db.exec('reset role');const personalInput=(await db.query<{r:CalculationInput}>('select tax_calculation_input_for_owner($1,2025) r',[personal.owner])).rows[0].r;assert.equal((await db.query<{r:boolean}>('select tax_bank_sources_blocked($1) r',[JSON.stringify(personalInput)])).rows[0].r,false);assert.ok(!calculateTax(personalInput).issues.some(i=>i.code==='bank_source_coverage'));
 assert.doesNotMatch(JSON.stringify(personalRaw),/object_path|key_id|raw_encrypted|Synthetic foreign observation/);
 const omitted=structuredClone(personalRaw) as {classification_decisions:unknown[]};omitted.classification_decisions=[];assert.throws(()=>parseBankAccountingCoverage(omitted,personal.owner),/Complete foreign decision history/);

});

import {verifyHostedReceiptConfirmation} from '../lib/database/hosted-receipt-confirmation-fixture';
import {recordEffectPence,type AccountingAmount} from '../lib/records/accounting-effect';
import {buildSelfAssessmentChecklist,type SelfAssessmentRecord} from '../lib/records/self-assessment';
import {readSourceCsv} from '../lib/records/source-csv';
// Synthetic, local schema rehearsal. Never connects to the hosted database.
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {TEST_SCHEMA_BOOTSTRAP} from '../lib/database/test-schema';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {prepareCalculation,verifySavedCalculation,canonicalJson,type SavedCalculation} from '../lib/tax/snapshot';
import type {CalculationInput} from '../lib/tax/calculation';
import {buildFilingReview,buildFilingPack,type FilingPackInput} from '../lib/tax/filing-pack';
import {parseCurrentFinancialReview} from '../lib/records/financial-review';

export async function rehearseHostedUpgrade(outputPath='/tmp/vibecount-hosted-upgrade'){
 const db=new PGlite({extensions:{pgcrypto}}),applied:string[]=[];
 const report:{synthetic_only:true;baseline:string;applied:string[];failed_migration?:string;error?:string;passed:boolean;receipt_rows_preserved?:number}={synthetic_only:true,baseline:'24 common local predecessors plus four captured hosted receipt migrations',applied,passed:false};
 try{
  await db.exec(TEST_SCHEMA_BOOTSTRAP);
  const local=new URL('../supabase/migrations/',import.meta.url),remote=new URL('../fixtures/hosted-baseline/',import.meta.url);
  const names=(await readdir(local)).filter(n=>n.endsWith('.sql')).sort();
  const before=names.filter(n=>n<'202607'),after=names.filter(n=>n>='202607');
  const sequence=[...before.map(n=>new URL(n,local)),...(await readdir(remote)).filter(n=>n.endsWith('.sql')).sort().map(n=>new URL(n,remote)),...after.map(n=>new URL(n,local))];
  let receipts:Record<string,unknown>[]=[];
  let receiptFact:{family_id:string;revision_id:string}|undefined;
  let oldReceiptSource:unknown;
  const reviewReceipt=async(owner:string,record:string,family:string|null=null)=>{
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');
   const request={action:'fact',family_id:family,expected_ordinal:family?1:0,kind:'vehicle',label:'Synthetic receipt source',state:'verified',
    data:{vehicle_type:'car',method:'actual_costs',business_use_bps:10000,business_miles_hundredths:null,period_start:'2025-04-06',period_end:'2026-04-05'},
    document_ids:[],transaction_ids:[],record_ids:[record]};
   const saved=(await db.query<{r:{family_id:string;revision_id:string}}>("select review_tax_inputs(2025,$1::jsonb,tax_review_stamp(2025),'Synthetic explicit receipt review',$2) r",[JSON.stringify(request),randomUUID()])).rows[0].r;
   await db.exec('reset role');return saved;
  };
  for(const file of sequence){
   const name=file.pathname.split('/').at(-1)!;
   if(name==='20261020210000_receipt_refund_integrity.sql'){
    await db.exec('begin');
    try{
     const original=receipts.find(r=>r.payment_status==='paid'&&r.expense_kind==='expense')!;
     await db.query('update financial_records set amount=1,gross_pence=100 where id=$1',[original.id]);
     await assert.rejects(db.exec(await readFile(file,'utf8')),/Existing receipt refunds require explicit review/);
    }finally{await db.exec('rollback')}
   }
   try{await db.exec(await readFile(file,'utf8'));applied.push(name)}
   catch(error){report.failed_migration=name;report.error=error instanceof Error?error.message:String(error);throw error}
   if(name==='20261020160000_receipt_cash_reporting_compatibility.sql'){
    const previous=(await db.query<{r:{quarters:{expense_pence:string}[]}}>("select financial_review_catalog($1,2025,'2026-04-05') r",[receipts[0].user_id])).rows[0].r;
    assert.equal(previous.quarters[1].expense_pence,'3500','Reproduce the direct-reader defect before the operational fix');
   }
   if(name==='20261020170000_receipt_operational_review.sql'){
    const unpaid=receipts.find(r=>r.payment_status==='unpaid')!;
    receiptFact=await reviewReceipt(unpaid.user_id as string,unpaid.id as string);
    oldReceiptSource=(await db.query<{snapshot:unknown}>('select snapshot from tax_fact_sources where revision_id=$1',[receiptFact.revision_id])).rows[0].snapshot;
   }
   if(name==='20261014115320_receipt_review_lock.sql'){
    const owner=randomUUID(),paid=randomUUID();await db.query('insert into auth.users(id) values($1)',[owner]);
    const category=(await db.query<{id:string}>("select id from record_categories where record_type='expense' and is_default order by id limit 1")).rows[0].id;
    for(const [id,payment,kind,amount,gross,original] of [[paid,'paid','expense',10,1000,null],[randomUUID(),'unpaid','expense',20,2000,null],[randomUUID(),'paid','refund',5,500,paid]]){
     await db.query("insert into financial_records(id,user_id,record_type,record_date,description,amount,category_id,source_type,status,document_date,payment_date,merchant,currency,gross_pence,business_use_percent,payment_status,expense_kind,refund_of) values($1,$2,'expense','2025-08-01','Synthetic hosted baseline',$3,$4,'receipt_document','approved','2025-08-01',case when $5='paid' then date '2025-08-01' else null end,'Synthetic merchant','GBP',$6,100,$5,$7,$8)",[id,owner,amount,category,payment,gross,kind,original]);
    }
    receipts=(await db.query<Record<string,unknown>>('select * from financial_records order by id')).rows;
   }
  }
  const afterRows=(await db.query<Record<string,unknown>>('select * from financial_records order by id')).rows;
  assert.equal(afterRows.length,receipts.length);
  for(let i=0;i<receipts.length;i++)for(const key of Object.keys(receipts[i]))assert.deepEqual(afterRows[i][key],receipts[i][key],`Retained receipt ${key}`);
  report.receipt_rows_preserved=receipts.length;
  const summary=(await db.query<{expense_total:string;expense_count:number}>("select sum(expense_total)::text expense_total,sum(expense_count)::int expense_count from financial_record_quarter_summaries")).rows[0];
  assert.equal(Number(summary.expense_total),5,'Paid cost 10 less refund 5; unpaid cost 20 is excluded');
  assert.equal(summary.expense_count,2,'Only paid cost and paid refund count');
  assert.equal(Number((await db.query<{n:string}>('select sum(reporting_amount)::text n from financial_record_reporting')).rows[0].n),5);
  const effect=async(extra:Record<string,unknown>)=>(await db.query<{n:string|null}>('select financial_record_cash_effect($1::jsonb)::text n',[JSON.stringify({status:'approved',amount:10,effect_sign:1,...extra})])).rows[0].n;
  assert.equal(Number(await effect({effect_sign:-1})),-10,'Native refund remains negative without receipt metadata');
  assert.equal(Number(await effect({effect_sign:-1,expense_kind:'refund'})),-10,'Both provenance flags must not double-negate');
  assert.equal(await effect({payment_status:'unpaid'}),null);
  assert.equal(await effect({currency:'EUR'}),null);
  assert.equal(await effect({status:'draft'}),null);
  const owner=receipts[0].user_id as string;
  const readReview=async()=>parseCurrentFinancialReview(owner,2025,'2026-04-05',
   (await db.query<{r:unknown}>("select read_financial_review(2025,'2026-04-05') r")).rows[0].r);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');
  const review=await readReview();
  assert.equal(review.quarters[1].expense_pence,500,'Operational cash agrees with quarter reporting');
  assert.equal(review.approved_count,3,'Approval provenance still includes unpaid evidence');
  assert.equal(review.recent_records.length,3,'Unpaid evidence remains visible');
  assert.match(review.recent_records.find(r=>r.cash_treatment==='unpaid')!.label,/unpaid; excluded from cash totals/);
  assert.deepEqual(review.recent_records.map(r=>r.amount_pence).sort((a,b)=>a-b),[-500,0,1000]);
  await assert.rejects(db.query("select financial_review_cash_catalog($1,2025,'2026-04-05')",[owner]),/permission denied/);
  await db.exec('reset role');
  const legacy=(await db.query<{r:{quarters:{expense_pence:string}[]}}>("select financial_review_catalog_v1($1,2025,'2026-04-05') r",[owner])).rows[0].r;
  assert.equal(legacy.quarters[1].expense_pence,'3500','Retained V1 semantics are unchanged');
  await db.exec('set role service_role');
  await db.query("select capture_quarter_readiness($1,2025,2,'2026-04-05')",[owner]);
  assert.equal(Number((await db.query<{net_profit_pence:number}>("select net_profit_pence from quarterly_readiness_checks where user_id=$1 and tax_quarter=2",[owner])).rows[0].net_profit_pence),-500);
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');
  const liveRecords=(await db.query<AccountingAmount&SelfAssessmentRecord>("select f.amount,f.effect_sign,f.record_type,cash_effect_pence(f),cash_treatment(f),null::jsonb record_categories from financial_records f order by id")).rows;
  assert.equal(liveRecords.reduce((sum,r)=>sum+recordEffectPence(r),0),500,'Live record/project consumers agree with SQL cash effects');
  assert.equal(buildSelfAssessmentChecklist(liveRecords).expenseTotal,500);
  assert.equal(buildSelfAssessmentChecklist(liveRecords).cashExcludedCount,1);
  await db.exec('reset role');
  const taxInput=(await db.query<{r:CalculationInput}>('select tax_calculation_input_for_owner($1,2025) r',[owner])).rows[0].r;
  assert.equal(taxInput.schema_version,'tax-calculation-input/5');
  const prepared=prepareCalculation(taxInput);
  assert.equal(prepared.result.totals.ledger_expenses,500,'Tax cash candidates match paid cost less refund');
  assert.equal(taxInput.records.reduce((sum,r)=>sum+r.amount_pence,0),3500,'Original approved magnitudes are preserved');
  assert.equal(prepared.result.status,'incomplete','Correct cash arithmetic does not invent source or tax eligibility');
  assert.equal((await db.query<{b:boolean}>('select tax_bank_sources_blocked($1::jsonb) b',[prepared.inputJson])).rows[0].b,false,'V5 retains valid empty bank coverage');
  await db.exec('set role service_role');
  await assert.rejects(db.query("select capture_tax_calculation($1,2025,$2,$3,$4,'Synthetic incorrect candidate',$5)",[owner,prepared.inputJson,canonicalJson({...prepared.result,totals:{...prepared.result.totals,ledger_expenses:3500}}),prepared.rulesJson,randomUUID()]),/Receipt cash candidate/);
  const calculation=(await db.query<{id:string}>("select capture_tax_calculation($1,2025,$2,$3,$4,'Synthetic receipt calculation review',$5) id",[owner,prepared.inputJson,prepared.resultJson,prepared.rulesJson,randomUUID()])).rows[0].id;
  await db.exec('reset role');
  const saved=(await db.query<SavedCalculation>('select * from tax_calculations where id=$1',[calculation])).rows[0];
  const savedRules=(await db.query<{id:string;sha256:string;canonical_json:string}>('select id,sha256,canonical_json from tax_rulesets where id=$1',[saved.ruleset_id])).rows[0];
  assert.equal(verifySavedCalculation(saved,savedRules).result.totals.ledger_expenses,500);
  const filing=(await db.query<{r:FilingPackInput}>('select tax_filing_pack_input_for_owner($1,$2) r',[owner,calculation])).rows[0].r;
  assert.equal(filing.calculation_is_current,true);
  buildFilingReview(filing,[]);
  const bundle=buildFilingPack(filing,[],randomUUID(),false);
  const [header,...ledger]=readSourceCsv(bundle.artifacts.find(a=>a.name==='normalized-ledger.csv')!.body);
  assert.equal(ledger.reduce((sum,row)=>sum+Number(row[header.indexOf('year_expense_pence')]),0),500,'Draft ledger exports match calculation cash candidates');
  assert.equal(bundle.artifacts.length,7);

  const unpaid=receipts.find(r=>r.payment_status==='unpaid')!;
  const sourceStatus=async()=>(await db.query<{source_unresolved:boolean;current_recognized_pence:number}>('select source_unresolved,current_recognized_pence from tax_fact_source_status where record_id=$1',[unpaid.id])).rows[0];
  assert.equal((await sourceStatus()).source_unresolved,true,'Old receipt facts need explicit re-review');
  assert.equal(Number((await sourceStatus()).current_recognized_pence),0,'Unpaid source has no recognized cash');
  const currentInput=async()=>(await db.query<{r:{sources:{source_unresolved:boolean;current_recognized_pence:number;snapshot:Record<string,unknown>}[]}}>('select tax_calculation_input_for_owner($1,2025) r',[owner])).rows[0].r;
  assert.equal((await currentInput()).sources[0].source_unresolved,true);
  await reviewReceipt(owner,unpaid.id as string,receiptFact!.family_id);
  assert.equal((await sourceStatus()).source_unresolved,false,'Explicit review records current receipt dimensions');
  assert.equal((await currentInput()).sources[0].source_unresolved,false);
  assert.ok((await currentInput()).sources[0].snapshot.receipt_dimensions);
  assert.deepEqual((await db.query<{snapshot:unknown}>('select snapshot from tax_fact_sources where revision_id=$1',[receiptFact!.revision_id])).rows[0].snapshot,oldReceiptSource,'Old provenance is immutable');
  await db.exec('begin');
  await db.query("update financial_records set payment_status='paid',payment_date=document_date where id=$1",[unpaid.id]);
  assert.equal((await sourceStatus()).source_unresolved,true,'Payment-only change invalidates prior review');
  assert.equal(Number((await sourceStatus()).current_recognized_pence),2000);
  assert.equal((await currentInput()).sources[0].source_unresolved,true);
  await db.exec('rollback');
  const other=randomUUID();await db.query('insert into auth.users(id) values($1)',[other]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);await db.exec('set role authenticated');
  assert.equal((await db.query('select * from financial_record_quarter_summaries')).rows.length,0);
  assert.equal((await db.query('select * from financial_record_reporting')).rows.length,0);
  assert.equal((await db.query('select * from tax_fact_source_status')).rows.length,0);
  assert.equal((await db.query('select cash_effect_pence(f),cash_treatment(f) from financial_records f')).rows.length,0);
  await db.exec('reset role');
  await verifyHostedReceiptConfirmation(db);
  report.passed=true;
  return report;
 }catch(error){
  report.error=error instanceof Error?error.message:String(error);throw error;
 }finally{
  await db.close();const output=resolve(outputPath);await mkdir(output,{recursive:true});
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.passed,applied:applied.length,failed_migration:report.failed_migration,error:report.error,report:resolve(output,'report.json')}));
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 rehearseHostedUpgrade(process.argv[2]).catch(()=>{process.exitCode=1});

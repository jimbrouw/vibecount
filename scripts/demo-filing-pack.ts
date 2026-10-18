/** Synthetic local demo only: no database, account connection, send or tax filing. */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {packFixture,acknowledge} from '../lib/tax/filing-pack-fixture';
import {buildFilingPack,defaultStepData,filingSteps,verifyFilingPack,type StepReview} from '../lib/tax/filing-pack';
import {canonicalJson,sha256,prepareCalculation} from '../lib/tax/snapshot';
import type {TaxFact} from '../lib/tax/facts';
async function main(){
const directory=resolve(process.argv[2]??'/tmp/vibecount-filing-pack-demo');
await mkdir(directory,{recursive:true});
const input=packFixture(),tax=input.calculation.input;
// This is an engineering example with explicit synthetic scope assumptions,
// not a reconstruction or approval of the taxpayer's actual historic records.
tax.scope!.data.employment_scope='distinct_employments_cumulative_totals_checked';
tax.scope!.data.termination_scope='separate_taxable_pay_and_withholding_checked';
for(const [kind,data] of [
  ['employment',{taxable_pay_pence:1403352,income_tax_withheld_pence:154260,class1_band_earnings_pence:0,statement_basis:'p45_current_employment',period_start:'2025-04-06',period_end:'2026-04-05'}],
  ['termination',{gross_pence:1025525,taxable_pence:0,income_tax_withheld_pence:0,payment_date:'2025-08-01',treatment:'evidence_reviewed'}],
] as [TaxFact['kind'],TaxFact['data']][]){
  const id='synthetic-'+kind,pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),page=pdf.addPage();pdf.setCreationDate(new Date('2026-10-17T00:00:00Z'));pdf.setModificationDate(new Date('2026-10-17T00:00:00Z'));page.drawText('SYNTHETIC DEMO - not employer evidence',{font,size:16,x:40,y:760});page.drawText(kind+' typed inputs: '+JSON.stringify(data),{font,size:7,x:40,y:720,maxWidth:500});const bytes=await pdf.save();
  // File SHA is the original byte hash, not the base64 representation.
  const {createHash}=await import('node:crypto'),fileHash=createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(directory,id+'.pdf'),bytes);
  tax.facts.push({id,family_id:id+'-family',ordinal:1,kind,label:'Synthetic '+kind,tax_year_start:2025,state:'verified',data,rationale:'Synthetic example only; not actual evidence verification',created_at:'2026-10-17'});
  tax.sources.push({id:id+'-source',revision_id:id,document_id:id+'-document',transaction_id:null,record_id:null,snapshot:{id:id+'-document',file_sha256:fileHash},current_recognized_pence:0,source_unresolved:false});
  tax.sections.find(s=>s.kind===kind)!.verdict='complete';
  input.documents.push({id:id+'-document',file_hash:fileHash,media_type:'application/pdf',size_bytes:bytes.length,created_at:'2026-10-17'});
}
const prepared=prepareCalculation(tax);Object.assign(input.calculation,{result:prepared.result,input_canonical_json:prepared.inputJson,result_canonical_json:prepared.resultJson,input_sha256:prepared.inputHash,result_sha256:prepared.resultHash});
const history:StepReview[]=[];
for(const step of filingSteps){const data=step==='profile'?{trade_form:'short',short_eligibility:'full_year_simple'}:step==='sources'?{all_sources_reviewed:true}:step==='income'?{all_receipts_are_turnover:true,no_invoice_expected_ids:[]}:step==='other'?{termination_exempt_pence:{'synthetic-termination':1025525}}:defaultStepData(step);acknowledge(input,step,history,data);}
const request='33333333-3333-4333-8333-333333333333',bundle=buildFilingPack(input,history,request,true),row={id:'synthetic-pack',tax_year_start:2025,input,input_canonical_json:canonicalJson(input),input_sha256:bundle.input_sha256,bundle,bundle_canonical_json:canonicalJson(bundle),bundle_sha256:sha256(canonicalJson(bundle)),reason:'Synthetic engineering demo only',author:'synthetic-reviewer',created_at:'2026-10-17',request_id:request};
verifyFilingPack(row);
for(const artifact of bundle.artifacts)await writeFile(join(directory,artifact.name),artifact.body);
await writeFile(join(directory,'saved-pack.json'),JSON.stringify(row,null,2));
await writeFile(join(directory,'README.txt'),'Synthetic engineering example. Not employer documents, source-ledger acceptance proof, a tax recommendation or a completed return. Explicit zero Class 1 band earnings and no other facts are synthetic assumptions. Source-ledger cross-year closure and real SQL review are tested separately in lib/database/filing-pack.test.ts. All seven outputs share the saved input hash.\n');
console.log('Verified seven draft outputs: '+directory);

}
main().catch(error=>{console.error(error);process.exitCode=1;});

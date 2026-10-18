import { FINANCIAL_REVIEW_V1_VERSION,FINANCIAL_REVIEW_VERSION,FINANCIAL_REVIEW_COVERAGE } from './financial-review';
import {bankSourceCoverageFixture} from './bank-source-coverage-fixture';
import {parseBankSourceCoverage} from './bank-source-coverage';
import { getCurrentTaxYearStart } from './tax-periods';
export function financialReviewFixture(year=getCurrentTaxYearStart(),asOf=new Date().toISOString().slice(0,10)){
 const owner='11111111-1111-4111-8111-111111111111';
 const catalog={schema_version:FINANCIAL_REVIEW_V1_VERSION,owner_id:owner,tax_year_start:year,as_of:asOf,stamp:'a'.repeat(64),approved_count:27,review_count:1,uncategorised_count:28,source_count:4,unresolved_source_count:1,external_invoice_count:1,native_overdue_count:1,
 quarters:[1,2,3,4].map(quarter=>({quarter,income_pence:quarter===1?'25000':'0',expense_pence:'0',net_pence:quarter===1?'25000':'0',approved_count:quarter===1?27:0,uncategorised_count:quarter===1?27:0,review_count:quarter===1?1:0,unresolved_source_count:quarter===1?1:0})),
 recent_records:Array.from({length:20},(_,n)=>({id:'record-'+n,record_type:'income',record_date:`${year}-04-06`,amount_pence:n===19?'-1000':'1000',categorised:false,description:'PRIVATE_BANK_TEXT'})),
 overdue_invoices:[{id:'invoice',due_date:`${year-1}-04-05`,original_minor:'12000',outstanding_pence:'4000',delivery_status:'paid',manual_paid_marker:true,client:'PRIVATE_CLIENT',number:'PRIVATE_REFERENCE'}],
 invoice_groups:[{currency:'GBP',original_total_minor:'12000',invoice_count:1},{currency:'USD',original_total_minor:'100000',invoice_count:1}],coverage:'operational_ledger_and_invoice_review_only; source_and_tax_completeness_not_certified',raw_text:'PRIVATE_SOURCE'};
 return{owner,year,asOf,catalog};
}
export function currentFinancialReviewFixture(year=getCurrentTaxYearStart(),asOf=new Date().toISOString().slice(0,10)){
 const f=financialReviewFixture(year,asOf),bank=parseBankSourceCoverage(bankSourceCoverageFixture(f.owner,4,year),f.owner);
 bank.observations=bank.observations.map((r,i)=>({...r,classification:i===0?'Unknown':'Personal'}));
 return{...f,catalog:{...f.catalog,schema_version:FINANCIAL_REVIEW_VERSION,coverage:FINANCIAL_REVIEW_COVERAGE,unsupported_source_count:0,source_unavailable_count:0,bank_source_coverage:bank,quarters:f.catalog.quarters.map((q,i)=>({...q,source_count:i===0?4:0,unsupported_source_count:0,source_unavailable_count:0}))}};
}

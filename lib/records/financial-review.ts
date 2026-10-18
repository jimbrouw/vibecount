import {parseFinancialReview as parseV1,financialReviewPrompt as promptV1,FINANCIAL_REVIEW_VERSION as V1_VERSION} from './financial-review-v1';
import {parseBankSourceCoverage,type BankSourceCoverage} from './bank-source-coverage';
import {FX_CURRENCIES} from '../fx/currency';
export {parseFinancialReview} from './financial-review-v1';
export const FINANCIAL_REVIEW_V1_VERSION=V1_VERSION;
export const FINANCIAL_REVIEW_VERSION='vibecount.financial-review/2';
export const FINANCIAL_REVIEW_COVERAGE='operational_ledger_invoice_and_bank_source_review_only; source_bytes_and_tax_completeness_not_certified';
const legacyCoverage='operational_ledger_and_invoice_review_only; source_and_tax_completeness_not_certified';
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Complete current review unavailable.');return value as Record<string,unknown>}
function count(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error('Complete source count unavailable.');return value}
function quarter(date:string,year:number){return date<`${year}-07-06`?1:date<`${year}-10-06`?2:date<`${year+1}-01-06`?3:4}
function sourceCounts(rows:BankSourceCoverage['observations']){
 const unsupported=rows.filter(r=>r.representation!=='native_gbp'),unavailable=rows.filter(r=>!r.source_complete||!r.source_available);
 const unresolvedFloor=rows.filter(r=>r.representation!=='native_gbp'||!r.source_complete||!r.source_available||r.dedupe_status==='needs_review'||r.dedupe_status!=='duplicate'&&r.classification==='Unknown').length;
 return{source_count:rows.length,unsupported_source_count:unsupported.length,source_unavailable_count:unavailable.length,unresolvedFloor};
}
/** V1 remains explicit replay. Current data must carry independently reconciled complete bank coverage. */
export function parseCurrentFinancialReview(owner:string,year:number,asOf:string,value:unknown){
 const r=object(value);if(r.schema_version!==FINANCIAL_REVIEW_VERSION||r.coverage!==FINANCIAL_REVIEW_COVERAGE)throw new Error('Current bank source review version unavailable.');
 const bank=parseBankSourceCoverage(r.bank_source_coverage,owner);
 // Retain the V1 output alias on parsed client DTOs without accepting a conflicting raw alias.
 const overdue=Array.isArray(r.overdue_invoices)?r.overdue_invoices.map(value=>{
  const v=object(value);if(Object.hasOwn(v,'original_minor')&&Object.hasOwn(v,'original_pence')&&Number(v.original_minor)!==v.original_pence)throw new Error('Invoice original aliases disagree.');
  return{...v,original_minor:Object.hasOwn(v,'original_minor')?v.original_minor:v.original_pence};
 }):r.overdue_invoices;
 const base=parseV1(owner,year,asOf,{...r,overdue_invoices:overdue,schema_version:V1_VERSION,coverage:legacyCoverage});
 const active=bank.observations.filter(s=>s.tax_year_start===year&&s.import_status!=='discarded'),expected=sourceCounts(active);
 for(const key of ['source_count','unsupported_source_count','source_unavailable_count'] as const)if(count(r[key])!==expected[key])throw new Error('Year source coverage is incomplete.');
 if(base.unresolved_source_count<expected.unresolvedFloor)throw new Error('Unsupported sources cannot disappear from unresolved coverage.');
 // Current cash projection retains every approved row, including unpaid evidence.
 // Older DTOs without receipt dimensions retain their original native behavior.
 const recentRecords=base.recent_records.map((record,i)=>{
  const raw=object((r.recent_records as unknown[])[i]);
  const treatment=raw.cash_treatment??'recognized';
  if(!['recognized','unpaid','unsupported_currency'].includes(treatment as string)
   ||treatment!=='recognized'&&record.amount_pence!==0)throw new Error('Receipt cash treatment is inconsistent.');
  const explanation=treatment==='unpaid'?'unpaid; excluded from cash totals':treatment==='unsupported_currency'?'unsupported currency; excluded from GBP cash totals':null;
  return{...record,...(raw.cash_treatment===undefined?{}:{cash_treatment:treatment as 'recognized'|'unpaid'|'unsupported_currency'}),label:explanation?`Record ${i+1} (${explanation})`:record.label};
 });
 const rawQuarters=r.quarters as Record<string,unknown>[];
 const quarters=base.quarters.map((q,i)=>{
  const expected=sourceCounts(active.filter(s=>quarter(s.cash_date,year)===q.quarter)),raw=rawQuarters[i];
  for(const key of ['source_count','unsupported_source_count','source_unavailable_count'] as const)if(count(raw[key])!==expected[key])throw new Error('Quarter source coverage is incomplete.');
  if(q.unresolved_source_count<expected.unresolvedFloor||q.unresolved_source_count>expected.source_count)throw new Error('Quarter unresolved source coverage is incomplete.');
  return{...q,source_count:expected.source_count,unsupported_source_count:expected.unsupported_source_count,source_unavailable_count:expected.source_unavailable_count};
 });
 return{...base,schema_version:FINANCIAL_REVIEW_VERSION,coverage:FINANCIAL_REVIEW_COVERAGE,quarters,recent_records:recentRecords,bank_source_coverage:bank,unsupported_source_count:expected.unsupported_source_count,source_unavailable_count:expected.source_unavailable_count};
}
export type FinancialReview=ReturnType<typeof parseCurrentFinancialReview>;
export async function readFinancialReview(db:{rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>},owner:string,year:number,asOf:string){const r=await db.rpc('read_financial_review',{p_year:year,p_as_of:asOf});if(r.error)throw new Error('Complete current review unavailable.');return parseCurrentFinancialReview(owner,year,asOf,r.data)}
/** Same allowlisted aggregate preview for human consent and provider sharing. No source identifiers or invalid user text. */
export function financialReviewBankSummary(review:FinancialReview){
 const bank=review.bank_source_coverage,groups=new Map<string,number>();
 for(const row of bank.observations){const currency=Object.hasOwn(FX_CURRENCIES,row.currency)?row.currency:'invalid';groups.set(currency,(groups.get(currency)??0)+1)}
 return{scope:'owner_wide_accounts_and_preserved_observations; active_year_counters_follow_cash_date; counts_overlap',owned_accounts:bank.counts.accounts,preserved_observations:bank.counts.observations,foreign_accounts:bank.counts.foreign_accounts,invalid_accounts:bank.counts.invalid_accounts,
 active_year_observations:review.source_count,unsupported_year_observations:review.unsupported_source_count,unavailable_year_source_metadata:review.source_unavailable_count,
 original_currency_observation_groups:[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([currency,observation_count])=>({currency,observation_count})),
 reviewed_zero_valuations:bank.counts.reviewed_zero_observations,limits:'Original units and valuations are not recognised GBP income or account balances. Metadata existence does not prove readable retained bytes; tax/source completeness remains unverified.'};
}
export function financialReviewPrompt(review:FinancialReview|ReturnType<typeof parseV1>){
 if(review.schema_version===V1_VERSION)return promptV1(review);
 const current=review as FinancialReview;
 const legacy=promptV1({...current,schema_version:V1_VERSION,coverage:legacyCoverage});
 return JSON.stringify({...JSON.parse(legacy),schema_version:FINANCIAL_REVIEW_VERSION,scope:FINANCIAL_REVIEW_COVERAGE,bank_source_summary:financialReviewBankSummary(current),quarters:current.quarters});
}

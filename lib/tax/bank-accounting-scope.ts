import { requirePence } from '../money';
import type { CalculationInput } from './calculation';
import { parseBankAccountingCoverage } from '../records/bank-accounting-coverage';
import { validateTaxBankObservation } from './bank-source-coverage';
/** V4 only: eligible foreign accounting effects remain distinct from original/native bank cash. */
export function bankAccountingTaxScope(input:Pick<CalculationInput,'owner_id'|'tax_year_start'|'records'|'sources'|'observations'>,value:unknown,extraConnected:readonly string[]=[]){
 const coverage=parseBankAccountingCoverage(value,input.owner_id),bank=coverage.source_coverage,byId=new Map(bank.observations.map(r=>[r.id,r])),accounting=new Map(coverage.accounting.map(r=>[r.transaction_id,r])),connected=new Set<string>();
 for(const r of input.records)if(r.status!=='excluded')for(const id of [r.bank_transaction_id,r.original_bank_transaction_id])if(id!==null)connected.add(id);
 for(const r of input.sources)for(const id of [r.transaction_id,r.snapshot.bank_transaction_id,r.snapshot.original_bank_transaction_id])if(id!==null&&id!==undefined){if(typeof id!=='string')throw new Error('Connected bank source unavailable.');connected.add(id)}
 for(const r of input.observations)if(r.import_status!=='discarded')connected.add(r.id);
 for(const id of extraConnected)connected.add(id);
 if([...connected].some(id=>!byId.has(id)))throw new Error('Complete connected accounting coverage unavailable.');
 const observed=new Set(input.observations.map(r=>r.id));
 if(observed.size!==input.observations.length||new Set(extraConnected).size!==extraConnected.length||new Set(input.records.map(r=>r.id)).size!==input.records.length)throw new Error('Unique accounting sources required.');
 for(const row of input.observations){
  const source=byId.get(row.id);if(!source)throw new Error('Complete tax observation unavailable.');validateTaxBankObservation(row,source);
  const a=accounting.get(row.id);if(a&&(row.business_use_bps!==(a.decision?.intent.business_use_bps??0)||row.recognized_pence!==a.recognized_income_pence+a.recognized_expense_pence))throw new Error('Foreign observation accounting projection differs.');
 }
 if(bank.observations.some(r=>r.tax_year_start===input.tax_year_start&&r.import_status!=='discarded'&&!observed.has(r.id)))throw new Error('Complete tax observation coverage unavailable.');
 const canonicalRecords=new Map(coverage.accounting.filter(a=>a.record!==null).map(a=>[a.record!.id,a]));
 for(const record of input.records){
  const authoritative=canonicalRecords.get(record.id);
  if(authoritative&&record.bank_transaction_id!==authoritative.transaction_id)throw new Error('Foreign canonical accounting source linkage differs.');
  if(record.bank_transaction_id===null)continue;
  const source=byId.get(record.bank_transaction_id);if(!source)throw new Error('Complete ledger source coverage unavailable.');
  if(source.currency==='GBP')continue;
  const proof=accounting.get(source.id)?.record;
  if(!proof||record.id!==proof.id||record.record_type!==proof.record_type||record.record_date!==proof.record_date||record.status!==proof.status||record.effect_sign!==1||record.original_bank_transaction_id!==null||
   (record.category?.id??null)!==proof.category_id||record.amount_pence!==requirePence(proof.amount_gbp)){
   if(!proof)throw new Error('Foreign ledger effect has no canonical accounting proof.');
   throw new Error('Foreign ledger effect differs from canonical accounting proof.');
  }
 }
 for(const a of coverage.accounting){const source=byId.get(a.transaction_id)!;if(source.tax_year_start===input.tax_year_start&&a.record&&!input.records.some(r=>r.id===a.record!.id))throw new Error('Complete foreign ledger effects unavailable.');}
 const rows=bank.observations.filter(r=>(r.tax_year_start===input.tax_year_start||connected.has(r.id))&&(r.import_status!=='discarded'||connected.has(r.id)));
 const eligible=(id:string)=>{const r=byId.get(id);return !!r&&r.source_complete&&r.source_available&&r.import_status!=='discarded'&&(r.representation==='native_gbp'||accounting.get(id)?.eligible===true)};
 const blocked_ids=rows.filter(r=>!eligible(r.id)).map(r=>r.id);
 return{schema_version:'bank-tax-source-scope/2',bank_source_coverage:bank,accounting_coverage:coverage,source_count:rows.length,source_ids:rows.map(r=>r.id),blocked_ids,blocks:blocked_ids.length>0,eligible};
}

import {bankOriginalMinor,parseBankSourceCoverage,type BankSourceCoverage} from '../records/bank-source-coverage';
import type {CalculationInput} from './calculation';
export const BANK_TAX_LIMITATION='Bank source review is incomplete for this cash tax year or its connected evidence. Original units and retained GBP valuations are not recognised trading income, tax acceptance or account cash.';
export const BANK_WITHHELD_TOTALS=['trade_profit','taxable_trade_profit','income_tax','class4','assessed_liability','net_balance','poa_each','january_combined'] as const;
/** Join retained source identity before trusting a legacy-shaped observation in a current snapshot. */
export function validateTaxBankObservation(value:Record<string,unknown>,bank:BankSourceCoverage['observations'][number]){
 for(const[key,expected]of Object.entries({id:bank.id,account_id:bank.account_id,import_id:bank.import_id,source_row_id:bank.source_row_id,transaction_date:bank.cash_date,currency:bank.currency,file_hash:bank.file_sha256,row_hash:bank.row_sha256,classification:bank.classification,dedupe_status:bank.dedupe_status,decision_version:bank.decision_version,import_status:bank.import_status}))if(value[key]!==expected)throw new Error('Bank observation identity and complete coverage disagree.');
 if(bank.signed_amount_pence===null?value.signed_amount_pence!==null:bankOriginalMinor(value.signed_amount_pence)!==bankOriginalMinor(bank.signed_amount_pence))throw new Error('Bank observation cash and complete coverage disagree.');
 for(const[key,expected]of Object.entries({original_signed_minor:bank.original_signed_minor,source_units_ruleset:bank.ruleset_id}))if(Object.hasOwn(value,key)&&value[key]!==expected)throw new Error('Bank original units and complete coverage disagree.');
}
/** All owned coverage is retained; only cash-year and explicit connected sources determine these blockers. */
export function bankTaxScope(input:Pick<CalculationInput,'owner_id'|'tax_year_start'|'records'|'sources'|'observations'>,value:unknown,extraConnected:readonly string[]=[]){
 const bank=parseBankSourceCoverage(value,input.owner_id),connected=new Set<string>();
 for(const r of input.records)for(const id of [r.bank_transaction_id,r.original_bank_transaction_id])if(id!==null)connected.add(id);
 for(const r of input.sources)for(const id of [r.transaction_id,r.snapshot.bank_transaction_id,r.snapshot.original_bank_transaction_id])if(id!==null&&id!==undefined){if(typeof id!=='string')throw new Error('Connected bank source unavailable.');connected.add(id)}
 for(const r of input.observations)if(r.import_status!=='discarded')connected.add(r.id);
 for(const id of extraConnected){if(typeof id!=='string')throw new Error('Connected filing bank source unavailable.');connected.add(id)}
 const byId=new Map(bank.observations.map(r=>[r.id,r]));for(const id of connected)if(!byId.has(id))throw new Error('Complete connected bank source coverage unavailable.');
 if(new Set(input.observations.map(r=>r.id)).size!==input.observations.length||new Set(extraConnected).size!==extraConnected.length)throw new Error('Unique bank source observations required.');
 for(const row of input.observations){const source=byId.get(row.id);if(!source)throw new Error('Complete bank observation coverage unavailable.');validateTaxBankObservation(row,source);}
 const observed=new Set(input.observations.map(r=>r.id));
 if(bank.observations.some(r=>r.tax_year_start===input.tax_year_start&&r.import_status!=='discarded'&&r.representation==='native_gbp'&&!observed.has(r.id)))throw new Error('Complete native tax observation coverage unavailable.');
 const rows=bank.observations.filter(r=>(r.tax_year_start===input.tax_year_start||connected.has(r.id))&&(r.import_status!=='discarded'||connected.has(r.id))),
 unsupported=rows.filter(r=>r.representation!=='native_gbp'),unavailable=rows.filter(r=>!r.source_complete||!r.source_available||r.import_status==='discarded'),
 blocked=rows.filter(r=>r.representation!=='native_gbp'||!r.source_complete||!r.source_available||r.import_status==='discarded');
 return{schema_version:'bank-tax-source-scope/1',scope:'cash_tax_year_and_explicit_connected_observations; source_metadata_is_not_readable_byte_proof',bank_source_coverage:bank,source_count:rows.length,unsupported_count:unsupported.length,source_unavailable_count:unavailable.length,blocked_ids:blocked.map(r=>r.id),blocks:blocked.length>0};
}
export function assertBankWithholding(result:{status:string;totals:Record<string,number|null>},scope:{blocks:boolean}){
 if(scope.blocks&&(result.status!=='incomplete'||BANK_WITHHELD_TOTALS.some(k=>result.totals[k]!==null)))throw new Error('Saved bank source coverage cannot support tax figures.');
}
export type TaxBankCoverage=BankSourceCoverage;

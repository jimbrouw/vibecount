import { currencyMinor, FX_CURRENCY_RULESET, FX_CURRENCIES } from '../fx/currency';
import { fxEvidenceId } from '../fx/document-facts';
import { sourceCsvDate } from './source-csv';
export const BANK_SOURCE_COVERAGE_VERSION='vibecount.bank-source-coverage/1';
export const BANK_SOURCE_COVERAGE_SCOPE='all_owned_accounts_and_observations; original_units_are_not_gbp_valuation_or_tax_acceptance';
function object(v:unknown,keys:string){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys.split(',').sort().join(','))throw new Error('Complete exact bank coverage unavailable.');return v as Record<string,unknown>}
function text(v:unknown,max=100):string{if(typeof v!=='string'||!v||v.length>max)throw new Error('Bank source metadata unavailable.');return v}
function count(v:unknown):number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw new Error('Complete bank coverage count unavailable.');return v}
function bool(v:unknown):boolean{if(typeof v!=='boolean')throw new Error('Explicit bank source state unavailable.');return v}
function units(v:unknown):string|null{if(v===null)return null;if(typeof v!=='string'||v.length>13||! /^-?(0|[1-9]\d*)$/.test(v)||v==='-0')throw new Error('Exact bank source units unavailable.');currencyMinor(Number(v));return v}
/** Source observations are nonzero exact minor units; never coerce arbitrary browser values. */
export function bankOriginalMinor(value: unknown): number {
 if(value===null||value===undefined)throw new Error('Original bank amount unavailable.');
 const n=typeof value==='number'?currencyMinor(value):Number(units(value));
 if(!n)throw new Error('Original bank amount is missing or zero.');
 return currencyMinor(n);
}
function hash(v:unknown):string|null{if(v===null)return null;if(typeof v!=='string'||v.length!==64||!/^[a-f0-9]{64}$/.test(v))throw new Error('Retained bank source hash unavailable.');return v}
export type NativeBankFields={currency?:unknown;signed_amount_pence?:unknown;original_signed_minor?:unknown;source_units_ruleset?:unknown};
/** Current UI boundary: absence of representation metadata is unavailable, never implicit GBP. */
export function nativeBankPence(value:NativeBankFields):number{
 if(value.currency!=='GBP'||value.original_signed_minor!==null||value.source_units_ruleset!==null||value.signed_amount_pence===null)throw new Error('Native review requires a complete actual GBP source.');
 const n=typeof value.signed_amount_pence==='number'?currencyMinor(value.signed_amount_pence):Number(units(value.signed_amount_pence));
 if(!n)throw new Error('Native source cash is missing or zero.');return currencyMinor(n);
}
export function isNativeBankObservation(value:NativeBankFields):boolean{try{nativeBankPence(value);return true}catch{return false}}
export function parseBankSourceCoverage(value:unknown,owner:string){
 const p=object(value,'schema_version,scope,owner_id,stamp,counts,accounts,observations');
 if(p.schema_version!==BANK_SOURCE_COVERAGE_VERSION||p.scope!==BANK_SOURCE_COVERAGE_SCOPE||fxEvidenceId(p.owner_id)!==fxEvidenceId(owner)||hash(p.stamp)===null||!Array.isArray(p.accounts)||p.accounts.length>2000||!Array.isArray(p.observations)||p.observations.length>20000)throw new Error('Complete owned bank coverage unavailable.');
 const accounts=p.accounts.map(v=>{const a=object(v,'id,currency,representation'),currency=text(a.currency,10),representation=currency==='GBP'?'native_gbp':Object.hasOwn(FX_CURRENCIES,currency)?'foreign':'invalid';if(a.representation!==representation)throw new Error('Contradictory account currency coverage.');return{id:fxEvidenceId(a.id),currency,representation}});
 const accountMap=new Map(accounts.map(a=>[a.id,a]));if(accountMap.size!==accounts.length)throw new Error('Duplicate account coverage.');
 const observations=p.observations.map(v=>{
  const r=object(v,'id,account_id,import_id,source_row_id,cash_date,tax_year_start,currency,signed_amount_pence,original_signed_minor,ruleset_id,import_status,classification,dedupe_status,decision_version,source_complete,source_available,file_sha256,row_sha256,parser_version,representation,valuation_status,valuation,approved_record_count');
  const id=fxEvidenceId(r.id),account_id=fxEvidenceId(r.account_id),currency=text(r.currency,10),cash_date=sourceCsvDate(text(r.cash_date,10),'iso');
  const year=Number(cash_date.slice(0,4))-(cash_date.slice(5)<'04-06'?1:0);if(r.tax_year_start!==year)throw new Error('Bank source year differs from immutable cash date.');
  const signed_amount_pence=units(r.signed_amount_pence),original_signed_minor=units(r.original_signed_minor),ruleset_id=r.ruleset_id===null?null:text(r.ruleset_id),
   source_complete=bool(r.source_complete),source_available=bool(r.source_available),account=accountMap.get(account_id),file_sha256=hash(r.file_sha256),row_sha256=hash(r.row_sha256),parser_version=r.parser_version===null?null:text(r.parser_version);
  let representation='invalid';
  if(source_complete&&account?.currency===currency&&file_sha256!==null&&row_sha256!==null&&parser_version!==null){
   if(isNativeBankObservation({currency,signed_amount_pence,original_signed_minor,source_units_ruleset:ruleset_id}))representation='native_gbp';
   else if(currency!=='GBP'&&Object.hasOwn(FX_CURRENCIES,currency)&&signed_amount_pence===null&&original_signed_minor!==null&&Number(original_signed_minor)!==0&&ruleset_id===FX_CURRENCY_RULESET&&parser_version==='mapped-csv/2')representation='foreign';
  }
  if(r.representation!==representation)throw new Error('Contradictory bank observation representation.');
  let valuation=null;
  if(r.valuation!==null){const v=object(r.valuation,'id,family_id,ordinal,state,signed_gbp_pence,source_current'),state=text(v.state);if(!['provisional','reviewed','withdrawn'].includes(state)||count(v.ordinal)<1||count(v.ordinal)>2147483647||units(v.signed_gbp_pence)===null)throw new Error('Valuation coverage unavailable.');const current=bool(v.source_current);if(current&&(state!=='reviewed'||!source_available||!source_complete))throw new Error('Contradictory current valuation.');valuation={id:fxEvidenceId(v.id),family_id:fxEvidenceId(v.family_id),ordinal:v.ordinal as number,state,signed_gbp_pence:v.signed_gbp_pence as string,source_current:current};}
  const valuation_status=representation==='invalid'?'invalid':representation==='native_gbp'?'not_applicable':valuation===null?'unvalued':valuation.state==='provisional'?'provisional':valuation.state==='withdrawn'?'withdrawn':!valuation.source_current?'stale':valuation.signed_gbp_pence==='0'?'reviewed_zero':'reviewed';
  if(r.valuation_status!==valuation_status||representation==='native_gbp'&&valuation!==null)throw new Error('Contradictory valuation coverage state.');
  const import_status=r.import_status===null?null:text(r.import_status),classification=text(r.classification),dedupe_status=text(r.dedupe_status);
  if(import_status!==null&&!['review','committed','discarded'].includes(import_status)||!['Business','Personal','Mixed','Transfer','Refund','Unknown'].includes(classification)||!['clear','needs_review','duplicate'].includes(dedupe_status)||count(r.decision_version)>2147483647)throw new Error('Bank source review state unavailable.');
  return{id,account_id,import_id:fxEvidenceId(r.import_id),source_row_id:fxEvidenceId(r.source_row_id),cash_date,tax_year_start:year,currency,signed_amount_pence,original_signed_minor,ruleset_id,import_status,classification,dedupe_status,decision_version:r.decision_version as number,source_complete,source_available,file_sha256,row_sha256,parser_version,representation,valuation_status,valuation,approved_record_count:count(r.approved_record_count)};
 });
 if(new Set(observations.map(r=>r.id)).size!==observations.length)throw new Error('Duplicate bank observation coverage.');
 const expected={accounts:accounts.length,native_accounts:accounts.filter(a=>a.representation==='native_gbp').length,foreign_accounts:accounts.filter(a=>a.representation==='foreign').length,invalid_accounts:accounts.filter(a=>a.representation==='invalid').length,
 observations:observations.length,native_observations:observations.filter(r=>r.representation==='native_gbp').length,foreign_observations:observations.filter(r=>r.representation==='foreign').length,invalid_observations:observations.filter(r=>r.representation==='invalid').length,
 active_blocked_observations:observations.filter(r=>r.import_status!=='discarded'&&r.representation!=='native_gbp').length,reviewed_zero_observations:observations.filter(r=>r.valuation_status==='reviewed_zero').length};
 const c=object(p.counts,Object.keys(expected).join(','));for(const[k,v]of Object.entries(expected))if(count(c[k])!==v)throw new Error('Complete bank coverage counts do not reconcile.');
 return{schema_version:BANK_SOURCE_COVERAGE_VERSION,scope:BANK_SOURCE_COVERAGE_SCOPE,owner_id:fxEvidenceId(owner),stamp:p.stamp as string,counts:expected,accounts,observations};
}
export type BankSourceCoverage=ReturnType<typeof parseBankSourceCoverage>;
export const bankSourceCoverageBlocks=(c:BankSourceCoverage)=>c.counts.active_blocked_observations>0||c.counts.foreign_accounts>0||c.counts.invalid_accounts>0;
export async function readBankSourceCoverage(db:{rpc:(name:string)=>PromiseLike<{data:unknown;error:unknown}>},owner:string){const r=await db.rpc('read_bank_source_coverage');if(r.error)throw new Error('Complete bank coverage unavailable.');return parseBankSourceCoverage(r.data,owner)}

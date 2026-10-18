import { dependencyObject as object, parseFxDependencies, requireDependencySources } from '../fx/dependencies';
import { fxEvidenceId } from '../fx/document-facts';
import { currencyMinor, FX_CURRENCIES, FX_CURRENCY_RULESET } from '../fx/currency';
import { isNativeBankObservation } from './bank-source-coverage';
function bool(v:unknown){if(typeof v!=='boolean')throw new Error('Explicit source state unavailable.');return v}
function count(v:unknown,max=20000){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>max)throw new Error('Complete source counts unavailable.');return v}
function text(v:unknown,max=100){if(typeof v!=='string'||!v||v.length>max)throw new Error('Source metadata unavailable.');return v}
function units(v:unknown):string|null{if(v===null)return null;if(typeof v!=='string'||v.length>13||!/^(-?[1-9]\d*|0)$/.test(v))throw new Error('Exact source units unavailable.');currencyMinor(Number(v));return v}
function hash(v:unknown):string|null{if(v===null)return null;if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))throw new Error('Source hash unavailable.');return v}
export function sourceReviewStamp(v:unknown){if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))throw new Error('Review the current source digest.');return v}
/** Reconstruct safe dimensions, independently check eligibility/counts; never forward arbitrary RPC fields. */
export function parseNativeSourceContext(ownerValue:string,value:unknown){
 const owner=fxEvidenceId(ownerValue),p=object(value),c=object(p.counts);
 if(p.schema_version!=='native-bank-source-context/1'||p.owner_id!==owner||typeof p.financial_stamp!=='string'||!/^[a-f0-9]{32}$/.test(p.financial_stamp)||!Array.isArray(p.sources)||p.sources.length>20000||new TextEncoder().encode(JSON.stringify(value)).length>2000000)throw new Error('Complete owned source context unavailable.');
 const sources=p.sources.map(value=>{
  const r=object(value),cash_date=text(r.cash_date,10),day=Date.parse(cash_date+'T00:00:00Z');
  if(r.user_id!==owner||!/^\d{4}-\d{2}-\d{2}$/.test(cash_date)||!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==cash_date||cash_date<'1900-01-01'||cash_date>'9998-12-31')throw new Error('Owned dated source unavailable.');
  const currency=text(r.currency,3),account_currency=r.account_currency===null?null:text(r.account_currency,3),account_type=r.account_type===null?null:text(r.account_type,30),signed_amount_pence=units(r.signed_amount_pence),original_signed_minor=units(r.original_signed_minor),ruleset_id=r.ruleset_id===null?null:text(r.ruleset_id),source_complete=bool(r.source_complete),source_available=bool(r.source_available),file_sha256=hash(r.file_sha256),row_sha256=hash(r.row_sha256),parser_version=r.parser_version===null?null:text(r.parser_version);
  const classification=text(r.classification),dedupe_status=text(r.dedupe_status),import_status=r.import_status===null?null:text(r.import_status);
  if(!/^[A-Z]{3}$/.test(currency)||account_currency!==null&&!/^[A-Z]{3}$/.test(account_currency)||!['Business','Personal','Mixed','Transfer','Refund','Unknown'].includes(classification)||!['clear','needs_review','duplicate'].includes(dedupe_status)||import_status!==null&&!['review','committed','discarded'].includes(import_status))throw new Error('Source review state unavailable.');
  const native_eligible=source_complete&&account_currency==='GBP'&&['bank','credit_card'].includes(account_type??'')&&file_sha256!==null&&row_sha256!==null&&parser_version!==null&&isNativeBankObservation({currency,signed_amount_pence,original_signed_minor,source_units_ruleset:ruleset_id});
  if(bool(r.native_eligible)!==native_eligible)throw new Error('Source eligibility contradicts original dimensions.');
  const representation=native_eligible?'native_gbp':source_complete&&account_currency===currency&&currency!=='GBP'&&Object.hasOwn(FX_CURRENCIES,currency)&&signed_amount_pence===null&&original_signed_minor!==null&&Number(original_signed_minor)!==0&&ruleset_id===FX_CURRENCY_RULESET&&parser_version==='mapped-csv/2'?'foreign':'invalid';
  return{id:fxEvidenceId(r.id),user_id:owner,account_id:fxEvidenceId(r.account_id),import_id:fxEvidenceId(r.import_id),source_row_id:fxEvidenceId(r.source_row_id),cash_date,currency,account_currency,account_type,signed_amount_pence,original_signed_minor,ruleset_id,classification,decision_version:count(r.decision_version,2147483647),dedupe_status,import_status,source_complete,source_available,native_eligible,file_sha256,row_sha256,parser_version,representation};
 });
 if(new Set(sources.map(s=>s.id)).size!==sources.length||new Set(sources.map(s=>s.source_row_id)).size!==sources.length)throw new Error('Complete unique source scope required.');
 const counts={sources:sources.length,native_sources:sources.filter(s=>s.native_eligible).length,native_blockers:sources.filter(s=>!s.native_eligible).length,unavailable_sources:sources.filter(s=>!s.source_available).length};
 for(const[k,v]of Object.entries(counts))if(count(c[k])!==v)throw new Error('Source counts do not reconcile.');
 if(bool(p.blocked)!==(counts.native_blockers>0))throw new Error('Source blocker state contradicts counts.');
 return{schema_version:'native-bank-source-context/1' as const,owner_id:owner,financial_stamp:p.financial_stamp,source_stamp:sourceReviewStamp(p.source_stamp),blocked:p.blocked as boolean,counts,sources};
}
export type NativeSourceContext=ReturnType<typeof parseNativeSourceContext>;
/** Native operation membership can be smaller than complete import eligibility scope, never larger. */
export function requireNativeProjection(context:NativeSourceContext,rows:unknown,expectedIds:string[],stamp:unknown){
 if(stamp!==context.financial_stamp||!Array.isArray(rows)||rows.length!==expectedIds.length||new Set(expectedIds).size!==expectedIds.length)throw new Error('Complete native operation scope unavailable.');
 const byId=new Map(context.sources.map(s=>[s.id,s])),expected=new Set(expectedIds),seen=new Set<string>();
 const keys={user_id:'user_id',account_id:'account_id',import_id:'import_id',source_row_id:'source_row_id',transaction_date:'cash_date',currency:'currency',account_type:'account_type',decision_version:'decision_version',classification:'classification',dedupe_status:'dedupe_status',import_status:'import_status'}as const;
 for(const value of rows){const r=object(value),id=fxEvidenceId(r.id),s=byId.get(id);if(!s||!s.native_eligible||!expected.has(id)||seen.has(id))throw new Error('Native operation contains missing or unsupported sources.');seen.add(id);
  for(const[k,sk]of Object.entries(keys)as [keyof typeof keys,typeof keys[keyof typeof keys]][])if(Object.hasOwn(r,k)&&r[k]!==s[sk])throw new Error('Native source identity or version changed.');
  if(!Object.hasOwn(r,'signed_amount_pence')||(typeof r.signed_amount_pence==='string'?Number(units(r.signed_amount_pence)):currencyMinor(r.signed_amount_pence))!==Number(s.signed_amount_pence))throw new Error('Native source cash changed.');
 }
}
export function parseSourceEnvelope(owner:string,value:unknown){
 const p=object(value);if(new TextEncoder().encode(JSON.stringify(value)).length>2000000)throw new Error('Complete review exceeds its payload limit.');
 const source_context=parseNativeSourceContext(owner,p.source_context),dependencies=parseFxDependencies(owner,p.dependencies);
 requireDependencySources(dependencies,source_context.sources.map(s=>({id:s.id,import_id:s.import_id,source_row_id:s.source_row_id,transaction_date:s.cash_date})),source_context.financial_stamp);
 if(typeof p.blocked!=='boolean')throw new Error('Explicit current blocker state unavailable.');
 return{p,source_context,dependencies};
}
/** A current form digest is separate from retained financial intent/recovery contracts. */
export function requireSourceConfirmation(form:FormData,context:NativeSourceContext){if(form.getAll('sourceStamp').length!==1||sourceReviewStamp(form.get('sourceStamp'))!==context.source_stamp)throw new Error('Reviewed sources changed.');}

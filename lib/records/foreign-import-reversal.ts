import { currencyCode,currencyMinor,exactObject } from '../fx/currency';
import { fxEvidenceId } from '../fx/document-facts';
import { sumPence } from '../money';
export function foreignImportReversalReview(owner:string,value:unknown){
 const p=exactObject(value,['schema_version','owner_id','import_id','import_status','currency','blocked','sources','stamp']);
 const currency=currencyCode(p.currency);
 if(p.schema_version!=='foreign-import-reversal/1'||fxEvidenceId(p.owner_id)!==fxEvidenceId(owner)||currency==='GBP'||typeof p.blocked!=='boolean'||
  typeof p.import_status!=='string'||!['review','committed','discarded'].includes(p.import_status)||typeof p.stamp!=='string'||! /^[a-f0-9]{32}$/.test(p.stamp)||
  !Array.isArray(p.sources)||p.sources.length>20000)throw new Error('Complete owned foreign reversal unavailable.');
 const sources=p.sources.map(value=>{
  const r=exactObject(value,['id','source_row_id','date','currency','original_signed_minor','decision_version','classification','record_id','record_type','approved_pence','valuation_revision_id','classification_request_id']);
  const original=currencyMinor(r.original_signed_minor),approved=currencyMinor(r.approved_pence);
  if(r.currency!==currency||!original||approved<0||typeof r.decision_version!=='number'||!Number.isInteger(r.decision_version)||r.decision_version<0||r.decision_version>2147483646||
   typeof r.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||new Date(r.date+'T00:00:00Z').toISOString().slice(0,10)!==r.date||
   typeof r.classification!=='string'||!['Business','Mixed','Personal','Unknown','Transfer','Refund'].includes(r.classification)||r.record_type!==(original>0?'income':'expense'))throw new Error('Exact foreign source state unavailable.');
  const record_id=r.record_id===null?null:fxEvidenceId(r.record_id),valuation_revision_id=r.valuation_revision_id===null?null:fxEvidenceId(r.valuation_revision_id),classification_request_id=r.classification_request_id===null?null:fxEvidenceId(r.classification_request_id);
  if(approved>0&&(!record_id||!valuation_revision_id||!classification_request_id||!['Business','Mixed'].includes(r.classification)))throw new Error('Approved effect ancestry unavailable.');
  return{id:fxEvidenceId(r.id),source_row_id:fxEvidenceId(r.source_row_id),date:r.date,currency,original_signed_minor:original,decision_version:r.decision_version,classification:r.classification,record_id,record_type:r.record_type as 'income'|'expense',approved_pence:approved,valuation_revision_id,classification_request_id};
 });
 if(new Set(sources.map(s=>s.id)).size!==sources.length||new Set(sources.map(s=>s.source_row_id)).size!==sources.length)throw new Error('Duplicate reversal source.');
 const income_delta_pence=-sumPence(sources.filter(s=>s.record_type==='income').map(s=>s.approved_pence))||0,expense_delta_pence=-sumPence(sources.filter(s=>s.record_type==='expense').map(s=>s.approved_pence))||0;
 return{schema_version:'foreign-import-reversal/1' as const,owner_id:owner,import_id:fxEvidenceId(p.import_id),import_status:p.import_status,currency,stamp:p.stamp,blocked:p.blocked||p.import_status==='discarded',sources,income_delta_pence,expense_delta_pence,profit_delta_pence:sumPence([income_delta_pence,-expense_delta_pence])};
}
export type ForeignImportReversal=ReturnType<typeof foreignImportReversalReview>;
export async function readForeignImportReversal(db:{rpc:(name:string,args:{p_import:string})=>PromiseLike<{data:unknown;error:unknown}>},owner:string,id:string){
 const r=await db.rpc('read_foreign_import_reversal',{p_import:fxEvidenceId(id)});if(r.error)throw new Error('Complete foreign reversal unavailable.');return r.data===null?null:foreignImportReversalReview(owner,r.data);
}

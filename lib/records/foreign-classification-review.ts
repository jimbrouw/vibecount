import { exactObject,currencyMinor } from '../fx/currency';
import { fxEvidenceId } from '../fx/document-facts';
import { parseBankValuationReview } from './bank-valuation-review';
import { foreignClassificationIntent,foreignClassificationAmount,FOREIGN_SHARE_POLICY } from './foreign-classification';

export function parseForeignClassificationReview(owner:string,value:unknown){
 const p=exactObject(value,['schema_version','stamp','valuation','can_classify','current','categories']);
 const valuation=parseBankValuationReview(owner,p.valuation),c=exactObject(p.current,['classification','business_use_bps','category_id','record_id','recognized_pence']);
 if(p.schema_version!=='foreign-classification-review/1'||typeof p.stamp!=='string'||! /^[a-f0-9]{32}$/.test(p.stamp)||typeof p.can_classify!=='boolean'||
  typeof c.classification!=='string'||!['Business','Mixed','Personal','Unknown','Transfer','Refund'].includes(c.classification)||
  typeof c.business_use_bps!=='number'||!Number.isInteger(c.business_use_bps)||c.business_use_bps<0||c.business_use_bps>10000||
  !Array.isArray(p.categories)||p.categories.length>1000)throw new Error('Complete foreign classification review unavailable.');
 const recognized_pence=currencyMinor(c.recognized_pence),record_id=c.record_id===null?null:fxEvidenceId(c.record_id),category_id=c.category_id===null?null:fxEvidenceId(c.category_id);
 if(recognized_pence<0||(recognized_pence>0&&(!record_id||!['Business','Mixed'].includes(c.classification))))throw new Error('Current accounting effect is inconsistent.');
 const categories=p.categories.map(value=>{const r=exactObject(value,['id','name','record_type']);if(typeof r.name!=='string'||!r.name.trim()||r.name.length>1000||(typeof r.record_type!=='string'||!['income','expense'].includes(r.record_type)))throw new Error('Owned category metadata unavailable.');return{id:fxEvidenceId(r.id),name:r.name,record_type:r.record_type as 'income'|'expense'};});
 if(new Set(categories.map(r=>r.id)).size!==categories.length)throw new Error('Duplicate category metadata.');
 return{schema_version:'foreign-classification-review/1' as const,stamp:p.stamp,valuation,can_classify:p.can_classify,
  current:{classification:c.classification,business_use_bps:c.business_use_bps,category_id,record_id,recognized_pence},categories};
}
export type ForeignClassificationReview=ReturnType<typeof parseForeignClassificationReview>;
export function foreignClassificationReadback(owner:string,value:unknown,context:ForeignClassificationReview){
 const c=parseForeignClassificationReview(owner,context),intent=foreignClassificationIntent(value),t=c.valuation.transaction;
 if(!c.can_classify||intent.expected_stamp!==c.stamp||intent.transaction_id!==t.id||intent.transaction_version!==t.decision_version)
  throw new Error('Reload current classification and release dependent relationships first.');
 const included=['Business','Mixed'].includes(intent.classification),head=c.valuation.head;
 if(included&&(!head||!c.valuation.head_current||head.id!==intent.valuation_revision_id||head.state!=='reviewed'))throw new Error('Review a current exact GBP valuation first.');
 const effect=foreignClassificationAmount(t.original_signed_minor,intent,included?head!.signed_gbp_pence:null);
 const category=c.categories.find(r=>r.id===intent.category_id);
 if(included&&(!category||category.record_type!==effect.record_type))throw new Error('Choose an owned category matching this accounting effect.');
 return{intent,...effect,previous_pence:c.current.recognized_pence,change_pence:effect.recognized_pence-c.current.recognized_pence,
  category:included?category!:null,valuation:included?head:null};
}
export async function readForeignClassificationReview(db:{rpc:(name:string,args:{p_transaction:string})=>PromiseLike<{data:unknown;error:unknown}>},owner:string,id:string){
 const r=await db.rpc('read_foreign_classification_review',{p_transaction:fxEvidenceId(id)});
 if(r.error||r.data===null)throw new Error('Owned classification review unavailable.');return parseForeignClassificationReview(owner,r.data);
}
export function foreignClassificationResult(value:unknown,intent:ReturnType<typeof foreignClassificationIntent>){
 const r=exactObject(value,['version','recognized_pence','record_id','record_type','classification','valuation_revision_id','rounding_policy']);
 if(r.version!==intent.transaction_version+1||r.classification!==intent.classification||r.valuation_revision_id!==intent.valuation_revision_id||
  r.rounding_policy!==FOREIGN_SHARE_POLICY||(typeof r.record_type!=='string'||!['income','expense'].includes(r.record_type))||currencyMinor(r.recognized_pence)<0)
  throw new Error('Confirmed classification result differs.');
 if(r.record_id!==null)fxEvidenceId(r.record_id);else if(r.recognized_pence!==0)throw new Error('Accounting record missing.');
 return r;
}

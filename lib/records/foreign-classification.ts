import { exactObject, currencyMinor } from '../fx/currency';
import { fxEvidenceId } from '../fx/document-facts';
import { apportionPence } from '../money';
import { redactBankDetailsForPrompt } from '../ai/redaction';
export const FOREIGN_SHARE_POLICY='gbp_business_share_half_up/1';
export function foreignClassificationIntent(value:unknown){
 const p=exactObject(value,['schema_version','transaction_id','transaction_version','valuation_revision_id','classification','category_id','business_use_bps','rounding_policy','treatment_reviewed','expected_stamp','rationale','request_id','human_confirmed']);
 if(p.schema_version!=='foreign-classification-intent/1'||p.rounding_policy!==FOREIGN_SHARE_POLICY||p.human_confirmed!==true||typeof p.treatment_reviewed!=='boolean'||
  typeof p.classification!=='string'||!['Business','Mixed','Personal','Unknown'].includes(p.classification)||
  typeof p.transaction_version!=='number'||!Number.isInteger(p.transaction_version)||p.transaction_version<0||p.transaction_version>2147483646||
  typeof p.business_use_bps!=='number'||!Number.isInteger(p.business_use_bps)||p.business_use_bps<0||p.business_use_bps>10000||
  typeof p.expected_stamp!=='string'||! /^[a-f0-9]{32}$/.test(p.expected_stamp)||typeof p.rationale!=='string'||!p.rationale.trim()||p.rationale.trim().length>1000)
  throw new Error('Review exact foreign classification fields.');
 const included=p.classification==='Business'||p.classification==='Mixed';
 let valuation_revision_id:string|null=null,category_id:string|null=null;
 if(included){
  valuation_revision_id=fxEvidenceId(p.valuation_revision_id);category_id=fxEvidenceId(p.category_id);
  if(!p.treatment_reviewed||(p.classification==='Business'?p.business_use_bps!==10000:p.business_use_bps<=0||p.business_use_bps>=10000))
   throw new Error('Review valuation, category, treatment and business share.');
 }else if(p.valuation_revision_id!==null||p.category_id!==null||p.business_use_bps!==0||p.treatment_reviewed)
  throw new Error('Excluded or unresolved decisions require no valuation or claimed share.');
 return {schema_version:'foreign-classification-intent/1' as const,transaction_id:fxEvidenceId(p.transaction_id),transaction_version:p.transaction_version,
  valuation_revision_id,classification:p.classification as 'Business'|'Mixed'|'Personal'|'Unknown',category_id,business_use_bps:p.business_use_bps,
  rounding_policy:FOREIGN_SHARE_POLICY,treatment_reviewed:p.treatment_reviewed,expected_stamp:p.expected_stamp,rationale:redactBankDetailsForPrompt(p.rationale.trim()),request_id:fxEvidenceId(p.request_id),human_confirmed:true};
}
export type ForeignClassificationIntent=ReturnType<typeof foreignClassificationIntent>;
/** Arithmetic only: source ownership/currentness and tax treatment must be checked separately. */
export function foreignClassificationAmount(originalMinor:number,intent:ForeignClassificationIntent,valuedGbp:number|null){
 const i=foreignClassificationIntent(intent),original=currencyMinor(originalMinor);if(!original)throw new Error('Original observation must be nonzero.');
 const record_type=original>0?'income' as const:'expense' as const;
 if(i.classification==='Personal'||i.classification==='Unknown')return{record_type,recognized_pence:0,rounding_policy:FOREIGN_SHARE_POLICY};
 if(valuedGbp===null)throw new Error('A reviewed GBP valuation is required.');
 const value=currencyMinor(valuedGbp);
 if(value!==0&&Math.sign(value)!==Math.sign(original))throw new Error('Valuation direction differs from original cash.');
 if(i.classification==='Mixed'&&record_type!=='expense')throw new Error('Mixed use applies to expenses only.');
 return{record_type,recognized_pence:apportionPence(Math.abs(value),i.business_use_bps),rounding_policy:FOREIGN_SHARE_POLICY};
}

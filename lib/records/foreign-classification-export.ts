import { exactObject,currencyMinor } from '../fx/currency';
import { fxEvidenceId } from '../fx/document-facts';
import { foreignClassificationIntent,foreignClassificationAmount } from './foreign-classification';
import { foreignClassificationResult } from './foreign-classification-review';
import type { BankExportRow } from './bank-export-context';
import type { parseBankValuationRevision } from './bank-valuation';
import type { sourceRecordEffects } from './source-export';
export type ForeignDecisionExportRow={id:string;user_id:string;transaction_id:string;import_id:string;version:number;classification:string;business_use_bps:number;category_id:string|null;rationale:string;recognized_pence:number;author:string;evidence_status:string;bank_valuation_revision_id:string|null;foreign_request_id:string;created_at:string;request:unknown};
/** Complete immutable classification ancestry, independently recalculated against retained valuation revisions. */
export function foreignClassificationExport(owner:string,row:BankExportRow,decisions:ForeignDecisionExportRow[],valuations:ReturnType<typeof parseBankValuationRevision>[],effects:ReturnType<typeof sourceRecordEffects>){
 if(decisions.length!==row.decision_version)throw new Error('Complete foreign decision history required.');
 const sorted=[...decisions].sort((a,b)=>a.version-b.version),seen=new Set<string>();
 let retainedRecord:string|null=null;
 const history=sorted.map((d,index)=>{
  const id=fxEvidenceId(d.id),requestId=fxEvidenceId(d.foreign_request_id);
  const q=exactObject(Array.isArray(d.request)&&d.request.length===1?d.request[0]:d.request,['user_id','request_id','transaction_id','version','intent','result','created_at']);
  const intent=foreignClassificationIntent(q.intent),result=foreignClassificationResult(q.result,intent);
  if(seen.has(requestId)||d.user_id!==owner||d.author!==owner||d.transaction_id!==row.id||d.import_id!==row.import_id||d.version!==index+1||q.user_id!==owner||q.transaction_id!==row.id||q.request_id!==requestId||q.version!==d.version||
   intent.transaction_id!==row.id||intent.transaction_version!==index||intent.request_id!==requestId||d.classification!==intent.classification||d.business_use_bps!==intent.business_use_bps||d.category_id!==intent.category_id||d.bank_valuation_revision_id!==intent.valuation_revision_id||
   typeof d.rationale!=='string'||d.rationale!==(q.intent as {rationale:unknown}).rationale||typeof d.created_at!=='string'||typeof q.created_at!=='string'||!Number.isFinite(Date.parse(d.created_at))||!Number.isFinite(Date.parse(String(q.created_at))))throw new Error('Foreign decision/request ancestry differs.');
  seen.add(requestId);
  const valuation=intent.valuation_revision_id===null?null:valuations.find(v=>v.id===intent.valuation_revision_id);
  if(intent.valuation_revision_id!==null&&(!valuation||valuation.state!=='reviewed'||valuation.transaction_version===null||valuation.transaction_version>intent.transaction_version))throw new Error('Retained reviewed classification valuation missing.');
  const calculated=foreignClassificationAmount(Number(row.original_signed_minor),intent,valuation?.signed_gbp_pence??null);
  if(currencyMinor(d.recognized_pence)!==calculated.recognized_pence||result.recognized_pence!==calculated.recognized_pence||result.record_type!==calculated.record_type||d.evidence_status!==(valuation?'verified':'provisional'))throw new Error('Foreign decision amount differs from its exact valuation/share.');
  const record=result.record_id===null?null:fxEvidenceId(result.record_id);
  if(retainedRecord!==null&&retainedRecord!==record||retainedRecord===null&&calculated.recognized_pence===0&&record!==null)throw new Error('Foreign canonical record identity changed.');
  retainedRecord=record;
  return{id,version:d.version,author:owner,created_at:d.created_at,evidence_status:d.evidence_status,request_id:requestId,request_created_at:q.created_at as string,intent,result:{...result,record_id:record,record_type:calculated.record_type},valuation_revision_id:intent.valuation_revision_id,recognized_pence:calculated.recognized_pence};
 });
 const head=history.at(-1),latest=head?.intent;
 if(head&&(row.classification!==latest!.classification||row.business_use_bps!==latest!.business_use_bps||row.category_id!==latest!.category_id||row.recognized_record_id!==retainedRecord))throw new Error('Current foreign projection differs from decision history.');
 if(!head&&(row.classification!=='Unknown'||row.business_use_bps!==0||row.category_id!=null||row.recognized_record_id!=null||effects.records.length>0))throw new Error('Unreviewed foreign accounting projection.');
 if(effects.records.length!==(retainedRecord===null?0:1))throw new Error('Complete canonical foreign effect required.');
 if(retainedRecord!==null){const f=effects.records[0];if(f.id!==retainedRecord||f.effect_sign!==1||f.refund_link_id!==null||f.record_type!==head!.result.record_type||f.record_date!==row.transaction_date||
   (head!.recognized_pence>0?(f.status!=='approved'||f.recognized_effect_pence!==head!.recognized_pence||f.category_id!==latest!.category_id):f.status!=='excluded'))throw new Error('Canonical foreign effect differs from reviewed history.');}
 return history;
}

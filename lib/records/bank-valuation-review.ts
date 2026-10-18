import { bankEconomicSource, bankValuationIntent, parseBankValuationRevision } from './bank-valuation';
import { convertCurrencyMinor, currencyCode, currencyMinor, exactObject } from '../fx/currency';
import { fxEvidenceId, parseRegisteredDocumentSource } from '../fx/document-facts';

export function parseBankValuationReview(owner: string, value: unknown) {
  const p=exactObject(value,['schema_version','owner_id','stamp','transaction','source','head','head_current','can_change','documents']);
  const t=exactObject(p.transaction,['id','decision_version','currency','original_signed_minor']);
  const currency=currencyCode(t.currency),original=currencyMinor(t.original_signed_minor),id=fxEvidenceId(t.id);
  if(p.schema_version!=='bank-valuation-review/1'||fxEvidenceId(p.owner_id)!==fxEvidenceId(owner)||
    typeof p.stamp!=='string'||! /^[a-f0-9]{32}$/.test(p.stamp)||currency==='GBP'||!original||
    typeof t.decision_version!=='number'||!Number.isInteger(t.decision_version)||t.decision_version<0||t.decision_version>2147483647||
    typeof p.head_current!=='boolean'||typeof p.can_change!=='boolean'||!Array.isArray(p.documents)||p.documents.length>1000)
    throw new Error('Complete owned valuation review unavailable.');
  const source=p.source===null?null:bankEconomicSource(owner,p.source),head=p.head===null?null:parseBankValuationRevision(owner,p.head);
  for(const s of [source,head?.source_snapshot.economic_source])if(s&&(s.transaction_id!==id||s.currency!==currency||s.original_signed_minor!==original))
    throw new Error('Valuation sources differ from the selected observation.');
  if(p.head_current&&(!head||head.state!=='reviewed'||!source))throw new Error('Current valuation source unavailable.');
  const documents=p.documents.map(parseRegisteredDocumentSource);
  if(new Set(documents.map(d=>d.document.id)).size!==documents.length)throw new Error('Duplicate valuation document identities.');
  return {schema_version:'bank-valuation-review/1' as const,owner_id:fxEvidenceId(owner),stamp:p.stamp,
    transaction:{id,decision_version:t.decision_version,currency,original_signed_minor:original},source,head,
    head_current:p.head_current,can_change:p.can_change,documents};
}
export type BankValuationReview=ReturnType<typeof parseBankValuationReview>;

export function bankValuationReadback(owner:string,value:unknown,context:BankValuationReview){
  const c=parseBankValuationReview(owner,context),intent=bankValuationIntent(value);
  if(!c.can_change||intent.transaction_id!==c.transaction.id||intent.expected_stamp!==c.stamp||intent.expected_ordinal!==(c.head?.ordinal??0))
    throw new Error('Reload the current source and release dependent financial effects before valuation changes.');
  if(intent.state==='withdrawn'){
    if(!c.head)throw new Error('Choose a retained valuation to withdraw.');
    return {intent,source:c.head.source_snapshot.economic_source,document:c.head.source_snapshot.document_source,
      data:c.head.data,conversion:c.head.conversion};
  }
  const document=c.documents.find(d=>d.document.id===intent.document_id);
  if(!c.source||!document?.available||intent.transaction_version!==c.transaction.decision_version||intent.data?.rate.source_currency!==c.transaction.currency)
    throw new Error('Review current owned source, document and original currency.');
  return {intent,source:c.source,document,data:intent.data,conversion:convertCurrencyMinor(c.transaction.original_signed_minor,intent.data.rate)};
}

export async function readBankValuationReview(db:{rpc:(name:string,args:{p_transaction:string})=>PromiseLike<{data:unknown;error:unknown}>},owner:string,transaction:string){
  const result=await db.rpc('read_bank_valuation_review',{p_transaction:fxEvidenceId(transaction)});
  if(result.error||result.data===null)throw new Error('Owned valuation review unavailable.');
  return parseBankValuationReview(owner,result.data);
}

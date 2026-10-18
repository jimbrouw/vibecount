import { randomUUID } from 'node:crypto';
import { redactBankDetailsForPrompt } from '../ai/redaction';
import { currencyCode, currencyMinor, FX_CURRENCIES, FX_CURRENCY_RULESET } from '../fx/currency';
import { canonicalJson } from '../tax/snapshot';
import { encryptSource, sourceContext, sourceHash } from './source-crypto';
import { parseDimensionedSourceCsv, DIMENSIONED_SOURCE_PARSER_VERSION, type DimensionedSourceTransaction } from './source-csv-v2';
import { MAX_SOURCE_BYTES, type CsvMapping } from './source-csv';
import type { SourceAttempt, SourceRegistration, SourceTransport } from './source-persistence';
import type { EvidenceKeyring } from './evidence-keyring';
import { verifiedBytes, type RecoveryTransport } from './evidence-recovery';

/** Retain V1 unchanged. Foreign recovery records its original parser, units and mapping. */
export function dimensionedSourcePlan(bytes: Uint8Array, mapping: CsvMapping, filename: string, accountCurrency: string) {
  const currency=currencyCode(accountCurrency);
  if(currency==='GBP')throw new Error('Native GBP imports retain the original parser and recovery path.');
  if(bytes.length<1||bytes.length>MAX_SOURCE_BYTES)throw new Error('Choose a CSV between 1 byte and 1 MB.');
  const parsed=parseDimensionedSourceCsv(new TextDecoder('utf-8',{fatal:true}).decode(bytes),mapping,currency),rows=parsed.rows;
  if(!rows.length)throw new Error('CSV has no transaction rows.');
  const dates=rows.map(r=>r.date).sort();
  const total=(positive:boolean)=>rows.filter(r=>(r.signedOriginalMinor>0)===positive).reduce((sum,r)=>currencyMinor(sum+Math.abs(r.signedOriginalMinor)),0);
  const plan={version:2 as const,parser:DIMENSIONED_SOURCE_PARSER_VERSION,ruleset_id:FX_CURRENCY_RULESET,account_currency:currency,
    currency_exponent:FX_CURRENCIES[currency].exponent,filename:redactBankDetailsForPrompt(filename).slice(0,200),mapping:{...mapping},
    row_count:rows.length,incoming_original_minor:total(true),outgoing_original_minor:total(false),coverage_start:dates[0],coverage_end:dates.at(-1)!};
  return{plan,rows};
}
export type DimensionedSourcePlan=ReturnType<typeof dimensionedSourcePlan>['plan'];
export type DimensionedSourceAttempt=Omit<SourceAttempt,'recovery_plan'>&{recovery_plan:DimensionedSourcePlan};
export function prepareDimensionedSourceRows(owner:string,account:string,hash:string,mapping:CsvMapping,rows:DimensionedSourceTransaction[],key:Uint8Array){
  return rows.map(r=>{
    if(r.currency==='GBP'||r.signedAmountPence!==null||!currencyMinor(r.signedOriginalMinor)||r.currencyExponent!==FX_CURRENCIES[r.currency].exponent)throw new Error('Exact foreign original units required.');
    const raw=Buffer.from(JSON.stringify(r.rawCells));
    return{row_number:r.rowNumber,date:r.date,description:r.description,reference:r.reference,signed_pence:null,
      original_signed_minor:r.signedOriginalMinor,currency:r.currency,currency_exponent:r.currencyExponent,source_units_ruleset:FX_CURRENCY_RULESET,
      row_hash:sourceHash(raw),raw_encrypted:encryptSource(raw,key,sourceContext(owner,account,hash,r.rowNumber)).toString('base64'),
      fingerprint:sourceHash(Buffer.from(JSON.stringify([DIMENSIONED_SOURCE_PARSER_VERSION,FX_CURRENCY_RULESET,r.date,r.signedOriginalMinor,r.currency,
        r.rawCells[mapping.description].trim().toLowerCase(),mapping.reference<0?'':r.rawCells[mapping.reference].trim().toLowerCase()])))};
  });
}
export type PreparedDimensionedSourceRow=ReturnType<typeof prepareDimensionedSourceRows>[number];
export type DimensionedSourceTransport=Pick<SourceTransport,'upload'|'transition'>&{
  createAttempt:(attempt:DimensionedSourceAttempt)=>Promise<void>;
  register:(attempt:DimensionedSourceAttempt,rows:PreparedDimensionedSourceRow[])=>Promise<SourceRegistration>;
};
export async function persistDimensionedSourceCsv(input:{owner:string;account:string;accountCurrency:string;bytes:Uint8Array;filename:string;mapping:CsvMapping},key:Uint8Array,keyId:string,transport:DimensionedSourceTransport){
  const {plan,rows}=dimensionedSourcePlan(input.bytes,input.mapping,input.filename,input.accountCurrency),id=randomUUID(),hash=sourceHash(input.bytes);
  const attempt:DimensionedSourceAttempt={id,user_id:input.owner,account_id:input.account,file_hash:hash,object_path:`${input.owner}/${input.account}/${id}.enc`,key_id:keyId,size_bytes:input.bytes.length,recovery_plan:plan};
  const prepared=prepareDimensionedSourceRows(input.owner,input.account,hash,plan.mapping,rows,key);
  const encrypted=encryptSource(input.bytes,key,sourceContext(input.owner,input.account,hash));
  await transport.createAttempt(attempt);
  try{
    await transport.upload(attempt.object_path,encrypted);
    await transport.transition(id,input.owner,['pending'],'uploaded');
    return await transport.register(attempt,prepared);
  }catch(error){await transport.transition(id,input.owner,['pending','uploaded'],'failed').catch(()=>{});throw error;}
}
/** Privileged server use only; returned decrypted-row preparation must never reach browser/AI. */
export async function verifyDimensionedSourceRecovery(attempt:DimensionedSourceAttempt,owner:string,keys:EvidenceKeyring,transport:RecoveryTransport){
  const p=attempt.recovery_plan;
  if(attempt.user_id!==owner||! /^[a-f0-9]{64}$/.test(attempt.file_hash)||attempt.object_path!==`${owner}/${attempt.account_id}/${attempt.id}.enc`||
    attempt.size_bytes>MAX_SOURCE_BYTES||!p||p.version!==2||p.parser!==DIMENSIONED_SOURCE_PARSER_VERSION||p.ruleset_id!==FX_CURRENCY_RULESET)
    throw new Error('Owned versioned source recovery unavailable.');
  const key=keys.key(attempt.key_id),bytes=verifiedBytes(await transport.read('source-evidence',attempt.object_path),key,
    sourceContext(owner,attempt.account_id,attempt.file_hash),attempt.file_hash,attempt.size_bytes);
  const rebuilt=dimensionedSourcePlan(bytes,p.mapping,p.filename,p.account_currency);
  if(canonicalJson(rebuilt.plan)!==canonicalJson(p))throw new Error('Preserved source differs from its confirmed currency and mapping.');
  const rows=prepareDimensionedSourceRows(owner,attempt.account_id,attempt.file_hash,p.mapping,rebuilt.rows,key);
  const manifest=sourceHash(Buffer.from(canonicalJson({kind:'source',attempt_id:attempt.id,file_hash:attempt.file_hash,plan:p,
    rows:rows.map(r=>({row_number:r.row_number,row_hash:r.row_hash,fingerprint:r.fingerprint}))})));
  return{rows,manifest};
}

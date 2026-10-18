import { exactObject } from '../fx/currency';
import { fxEvidenceId } from '../fx/document-facts';
import { parseBankSourceCoverage } from './bank-source-coverage';
import { bankExportContext,type BankExportRow,type BankExportFamily } from './bank-export-context';
import type { ForeignDecisionExportRow } from './foreign-classification-export';
import { canonicalJson,sha256 } from '../tax/snapshot';
export type BankAccountingCoverageInput={schema_version:'vibecount.bank-source-coverage/2';source_coverage:unknown;foreign_rows:BankExportRow[];valuation_families:BankExportFamily[];valuation_revisions:unknown[];classification_decisions:ForeignDecisionExportRow[];blocked_transaction_ids:string[]};
/** Accounting eligibility is distinct from native cash eligibility and tax treatment acceptance. */
export function parseBankAccountingCoverage(value:unknown,owner:string){
 const p=exactObject(value,['schema_version','source_coverage','foreign_rows','valuation_families','valuation_revisions','classification_decisions','blocked_transaction_ids']);
 if(p.schema_version!=='vibecount.bank-source-coverage/2'||!['foreign_rows','valuation_families','valuation_revisions','classification_decisions','blocked_transaction_ids'].every(k=>Array.isArray(p[k])&&(p[k] as unknown[]).length<=20000))throw new Error('Complete accounting coverage unavailable.');
 const raw=p as BankAccountingCoverageInput,source=parseBankSourceCoverage(raw.source_coverage,owner),observations=source.observations.filter(r=>r.currency!=='GBP');
 const blocked=new Set(raw.blocked_transaction_ids.map(fxEvidenceId));if(blocked.size!==raw.blocked_transaction_ids.length||[...blocked].some(id=>!observations.some(r=>r.id===id)))throw new Error('Complete accounting dependencies unavailable.');
 const subset={...source,observations,counts:{...source.counts,observations:observations.length,native_observations:0,foreign_observations:observations.filter(r=>r.representation==='foreign').length,invalid_observations:observations.filter(r=>r.representation==='invalid').length,active_blocked_observations:observations.filter(r=>r.import_status!=='discarded').length,reviewed_zero_observations:observations.filter(r=>r.valuation_status==='reviewed_zero').length}};
 const proof=bankExportContext(owner,subset,raw.foreign_rows,raw.valuation_families,raw.valuation_revisions,undefined,raw.classification_decisions);
 const accounting=proof.snapshot.observations.map(r=>{
  const decision=r.classification_history.at(-1),included=['Business','Mixed'].includes(r.classification);
  let status:'discarded'|'unavailable'|'blocked'|'unresolved'|'personal'|'stale'|'reviewed_zero'|'approved';
  if(r.import_status==='discarded')status='discarded';
  else if(r.representation!=='foreign'||!r.source_complete||!r.source_available)status='unavailable';
  else if(blocked.has(r.id)||r.dedupe_status!=='clear')status='blocked';
  else if(!decision||!included&&r.classification!=='Personal')status='unresolved';
  else if(r.classification==='Personal')status='personal';
  else if(!r.valuation?.source_current||r.valuation.state!=='reviewed'||decision.valuation_revision_id!==r.valuation.id)status='stale';
  else status=decision.recognized_pence===0?'reviewed_zero':'approved';
  return{transaction_id:r.id,status,eligible:['personal','reviewed_zero','approved'].includes(status),decision:decision??null,record:r.financial_records[0]??null,recognized_income_pence:r.recognized_income_pence,recognized_expense_pence:r.recognized_expense_pence};
 });
 return{schema_version:'vibecount.bank-source-coverage/2' as const,source_coverage:source,accounting,proof:proof.snapshot,stamp:sha256(canonicalJson(raw))};
}

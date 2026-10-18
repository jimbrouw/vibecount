import type { BankExportContext } from './bank-export-context';
import { canonicalJson, sha256 } from '../tax/snapshot';
import { parseFxProvenance } from '../fx/provenance';
import { escapeCsv } from './export-csv';
import type { evidenceManifest } from './evidence-manifest';

export const BANK_LEDGER_SCHEMA = 'vibecount.evidence-ledger/4';
export const BANK_MANIFEST_SCHEMA = 'vibecount.evidence-manifest/5';
export function bankEvidenceLedger(context: BankExportContext, narratives?: {id:string;description:string;reference:string}[]) {
  const header = ['document_status','export_schema_version','bank_context_sha256','transaction_id','account_id','account_currency','import_id','import_status','source_row_id','source_row_number','source_row_sha256','file_sha256','parser_version','cash_date','tax_year_start','currency','currency_exponent','source_units_ruleset','original_signed_minor','actual_signed_gbp_pence','representation','source_metadata_available','classification','business_use_basis_points','dedupe_status','decision_version','valuation_status','valuation_history_json','financial_records_json','refund_portions_json','recognized_income_pence','recognized_expense_pence','recognized_profit_pence','active_transfer_id','active_duplicate_decision_id','retained_duplicate_transaction_id'];
  header.push('current_valuation_documents_json','description','reference','source_file_id','raw_signed_amount_pence','foreign_classification_history_json');
  const narrativeMap=new Map(narratives?.map(r=>[r.id,r]));
  if(narratives && (narrativeMap.size!==narratives.length || narratives.length!==context.snapshot.observations.length || context.snapshot.observations.some(r=>!narrativeMap.has(r.id))))throw new Error('Complete ledger descriptions required.');
  const rows = context.snapshot.observations.map(r => [
    'Draft — not submitted to HMRC', BANK_LEDGER_SCHEMA, context.snapshot_sha256, r.id, r.account_id, r.account_currency, r.import_id, r.import_status,
    r.source_row_id, r.source_row_number, r.row_sha256, r.file_sha256, r.parser_version, r.cash_date, r.tax_year_start, r.currency,
    r.currency_exponent, r.ruleset_id, r.original_signed_minor, r.actual_signed_gbp_pence, r.representation, r.source_available,
    r.classification, r.business_use_bps, r.dedupe_status, r.decision_version, r.valuation_status, canonicalJson(r.valuation_history),
    canonicalJson(r.financial_records), canonicalJson(r.refund_portions), r.recognized_income_pence, r.recognized_expense_pence, r.recognized_profit_pence,
    r.active_transfer_id, r.active_duplicate_decision_id, r.retained_duplicate_transaction_id,
    canonicalJson(context.snapshot.current_valuation_documents.filter(d=>r.valuation_history.some(v=>v.document_id===d.id))),
    narrativeMap.get(r.id)?.description??'',narrativeMap.get(r.id)?.reference??'',
    r.source_file_id,r.signed_amount_pence,canonicalJson(r.classification_history),
  ].map(v => v === null ? '' : String(v)));
  const csv = [header, ...rows].map(row => row.map(escapeCsv).join(',')).join('\r\n');
  if (Buffer.byteLength(csv) > 4_000_000) throw new Error('Complete bank ledger exceeds download capacity.');
  return { csv, count: rows.length, schema_version: BANK_LEDGER_SCHEMA };
}

export function bankEvidenceManifest(owner: string, context: BankExportContext, rawFx: unknown,
  imported?: {source:Parameters<typeof evidenceManifest>[0];account:Parameters<typeof evidenceManifest>[1]}) {
  if (context.snapshot.owner_id !== owner) throw new Error('Owned bank context required.');
  const fx = parseFxProvenance(owner, rawFx, context.snapshot.observations.map(r => ({
    id: r.id, import_id: r.import_id, source_row_id: r.source_row_id, transaction_date: r.cash_date, currency: r.currency, signed_amount_pence: r.signed_amount_pence,
  })));
  let import_context=null;
  if(imported){
    const {source,account}=imported;
    if(source.id!==context.snapshot.import_id||context.snapshot.observations.some(r=>r.import_id!==source.id||r.file_sha256!==source.file_hash||r.parser_version!==source.parser_version||r.account_id!==source.account_id||r.import_status!==source.status))throw new Error('Import metadata differs from source snapshot.');
    import_context={id:source.id,file_sha256:source.file_hash,parser_version:source.parser_version,account_id:source.account_id,status:source.status,
      created_at:source.created_at,coverage_start:source.coverage_start,coverage_end:source.coverage_end,account_label:account.label,account_ending:account.masked_identifier};
  }
  const snapshot = { import_context, bank_context: context.snapshot, fx_provenance: fx };
  const canonical = canonicalJson(snapshot);
  if (Buffer.byteLength(canonical) > 4_000_000) throw new Error('Complete bank manifest exceeds download capacity.');
  return { schema_version: BANK_MANIFEST_SCHEMA, document_status: 'Draft — not submitted to HMRC',
    scope: 'Current bank source snapshot and retained valuation/FX history; metadata availability does not prove readable bytes; not a locked filing pack.',
    hash_definition: 'SHA-256 of UTF-8 canonical JSON (recursively sorted object keys); integrity only, not authenticity.',
    bank_context_sha256: sha256(canonicalJson(context.snapshot)), snapshot_sha256: sha256(canonical), snapshot };
}

export const FOREIGN_DECISION_LEDGER_SCHEMA='vibecount.foreign-decision-ledger/1';
export function bankForeignDecisionLedger(context:BankExportContext){
 const header=['document_status','schema_version','bank_context_sha256','transaction_id','source_row_id','original_currency','original_signed_minor','decision_id','decision_version','classification','business_use_basis_points','category_id','recognized_gbp_pence','record_id','valuation_revision_id','classification_request_id','rounding_policy','rationale','author','created_at','reviewed_intent_json','result_json'];
 if(context.snapshot.observations.some(r=>r.representation!=='foreign'))throw new Error('Complete foreign source decision history required.');
 const rows=context.snapshot.observations.flatMap(r=>r.classification_history.map(d=>['Draft — not submitted to HMRC',FOREIGN_DECISION_LEDGER_SCHEMA,context.snapshot_sha256,r.id,r.source_row_id,r.currency,r.original_signed_minor,d.id,d.version,d.intent.classification,d.intent.business_use_bps,d.intent.category_id,d.recognized_pence,d.result.record_id,d.valuation_revision_id,d.request_id,d.intent.rounding_policy,d.intent.rationale,d.author,d.created_at,canonicalJson(d.intent),canonicalJson(d.result)].map(v=>v===null?'':String(v))));
 const csv=[header,...rows].map(r=>r.map(escapeCsv).join(',')).join('\r\n');if(Buffer.byteLength(csv)>4_000_000)throw new Error('Complete decision history exceeds download capacity.');
 return{csv,count:rows.length,schema_version:FOREIGN_DECISION_LEDGER_SCHEMA};
}

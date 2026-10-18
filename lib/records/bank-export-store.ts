import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readBankChoiceContext, finishBankChoiceContext } from './native-choice-store';
import { readFxEvidenceCatalog } from '../fx/document-facts-store';
import { readAllExportRows } from './export-pages';
import { attachSourceEffects } from './source-effect-store';
import { bankExportContext, type BankExportRow, type BankExportFamily } from './bank-export-context';
import type { ForeignDecisionExportRow } from './foreign-classification-export';
import { canonicalJson, sha256 } from '../tax/snapshot';

export const BANK_VALUATION_EXPORT_COLUMNS = 'id,user_id,family_id,ordinal,previous_revision_id,state,transaction_version,ruleset_id,document_id,data,source_snapshot,conversion,signed_gbp_pence,human_read_original,reviewed_stamp,rationale,author,request_id,created_at';
export const BANK_EXPORT_COLUMNS = 'id,user_id,account_id,import_id,transaction_date,tax_year_start,signed_amount_pence,original_signed_minor,source_units_ruleset,currency,description,reference,classification,business_use_bps,category_id,recognized_record_id,dedupe_status,decision_version,active_transfer_id,active_refund_id,active_duplicate_decision_id,duplicate_decision:duplicate_decisions!transaction_duplicate_owner_fk(id,retained_transaction_id),source_row_id,source_rows(row_number,row_hash)';

/** Caller finishes this bracket after reading other export relationships, before recording a download. */
export async function readBankExport(db: SupabaseClient, owner: string, importId?: string) {
  const before = await readBankChoiceContext(db, owner), evidence = await readFxEvidenceCatalog(db, owner);
  const expected=before.coverage.observations.filter(r=>importId===undefined||r.import_id===importId);
  if(expected.reduce((sum,r)=>sum+(r.valuation?.ordinal??0),0)>20000)throw new Error('Complete valuation history exceeds export capacity.');
  const rows = await readAllExportRows<BankExportRow>(async after => {
    let q = db.from('bank_transactions').select(BANK_EXPORT_COLUMNS+',record_imports(id,user_id,source_file_id,file_hash,parser_version)').eq('user_id', owner).order('id').limit(500);
    if (importId !== undefined) q = q.eq('import_id', importId);
    if (after) q = q.gt('id', after);
    const r = await q;
    return { data: r.data as unknown as BankExportRow[] | null, error: r.error };
  },{maxRows:20000,maxBytes:4_000_000});
  const expectedCount = before.coverage.observations.filter(r => importId === undefined || r.import_id === importId).length;
  if (rows.length !== expectedCount || rows.length > 20000) throw new Error('Complete bank inventory unavailable.');
  const families: BankExportFamily[] = [], revisions: ({ id: string } & Record<string, unknown>)[] = [];
  async function batches<T extends { id: string }>(ids: string[], table: string, key: string, columns: string, into: T[]) {
    let bytes=0;
    for (let start = 0; start < ids.length; start += 100) {
      const batch = ids.slice(start, start + 100);
      const read = await readAllExportRows<T>(async after => {
        let q = db.from(table).select(columns).eq('user_id', owner).in(key, batch).order('id').limit(500);
        if (after) q = q.gt('id', after);
        const r = await q;
        return { data: r.data as unknown as T[] | null, error: r.error };
      },{maxRows:20000-into.length,maxBytes:4_000_000-bytes});
      bytes+=Buffer.byteLength(JSON.stringify(read));
      into.push(...read);
      if (into.length > 20000) throw new Error('Complete bounded bank history required.');
    }
  }
  await batches(rows.map(r => r.id), 'bank_valuation_families', 'transaction_id', 'id,user_id,transaction_id', families);
  await batches(families.map(f => f.id), 'bank_valuation_revisions', 'family_id', BANK_VALUATION_EXPORT_COLUMNS, revisions);
  const decisions:ForeignDecisionExportRow[]=[];
  const foreign=rows.filter(r=>r.currency!=='GBP');
  if(foreign.reduce((n,r)=>n+r.decision_version,0)>20000)throw new Error('Complete foreign classification history exceeds export capacity.');
  await batches(foreign.map(r=>r.id),'classification_decisions','transaction_id','id,user_id,transaction_id,import_id,version,classification,business_use_bps,category_id,rationale,recognized_pence,author,evidence_status,bank_valuation_revision_id,foreign_request_id,created_at,request:foreign_classification_requests!classification_foreign_request(user_id,request_id,transaction_id,version,intent,result,created_at)',decisions);
  const attached = await attachSourceEffects(db, owner, importId, rows);
  const context = bankExportContext(owner, before.coverage, attached, families, revisions, importId, decisions);
  const documentIds = new Set(context.snapshot.observations.flatMap(r => r.valuation_history.map(v => v.document_id)));
  // Missing current metadata remains explicit; retained immutable evidence stays in each revision.
  const currentDocuments = [...documentIds].sort().map(id => ({ id, current: evidence.documents.find(d => d.id === id)?.source ?? null }));
  const snapshot = { ...context.snapshot, current_valuation_documents: currentDocuments };
  const canonical = canonicalJson(snapshot);
  if (Buffer.byteLength(canonical) > 4_000_000) throw new Error('Complete bank export exceeds download capacity.');
  return {
    context: { snapshot, snapshot_sha256: sha256(canonical) }, rows: attached,
    finish: async () => {
      await finishBankChoiceContext(db, owner, before);
      const after = await readFxEvidenceCatalog(db, owner);
      if (evidence.stamp !== after.stamp || canonicalJson(evidence.documents) !== canonicalJson(after.documents))
        throw new Error('Valuation evidence changed during export.');
    },
  };
}

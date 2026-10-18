import { parseBankSourceCoverage } from './bank-source-coverage';
import { parseBankValuationRevision } from './bank-valuation';
import type { parseRegisteredDocumentSource } from '../fx/document-facts';
import { fxEvidenceId } from '../fx/document-facts';
import { sourceRecordEffects, type SourceExportRow } from './source-export';
import { FX_CURRENCIES, type CurrencyCode } from '../fx/currency';
import { canonicalJson, sha256 } from '../tax/snapshot';
import { sumPence } from '../money';

import { foreignClassificationExport, type ForeignDecisionExportRow } from './foreign-classification-export';
export const BANK_EXPORT_SCHEMA = 'vibecount.bank-export-context/2';
export type BankExportRow = Omit<SourceExportRow, 'signed_amount_pence'> & {
  user_id: string; account_id: string; import_id: string; recognized_record_id?:string|null; category_id?:string|null;
  signed_amount_pence: number | string | null;
  original_signed_minor: number | string | null; source_units_ruleset: string | null;
  record_imports: {id:string;user_id:string;source_file_id:string;file_hash:string;parser_version:string} | {id:string;user_id:string;source_file_id:string;file_hash:string;parser_version:string}[] | null;
};
export type BankExportFamily = { id: string; user_id: string; transaction_id: string };
const one = <T>(v: T | T[] | null): T => {
  if (v === null || Array.isArray(v) && v.length !== 1) throw new Error('Unique source relationship required.');
  return Array.isArray(v) ? v[0] : v;
};
const units = (v: number | string | null) => v === null ? null : String(v);
function unique<T extends { id: string }>(rows: T[]) {
  const map = new Map(rows.map(r => [r.id, r]));
  if (map.size !== rows.length) throw new Error('Duplicate bank export member.');
  return map;
}

/** Complete selected source inventory. Valuations are retained evidence, never source cash or postings. */
export function bankExportContext(owner: string, rawCoverage: unknown, rows: BankExportRow[], families: BankExportFamily[], rawRevisions: unknown[], importId?: string, decisions:ForeignDecisionExportRow[]=[] ) {
  const coverage = parseBankSourceCoverage(rawCoverage, owner);
  const expected = coverage.observations.filter(r => importId === undefined || r.import_id === importId);
  if (rows.length !== expected.length || rows.length > 20000 || rawRevisions.length > 20000)
    throw new Error('Complete bounded bank export inventory required.');
  const rowMap = unique(rows), familyMap = unique(families), byTransaction = new Map(families.map(f => [f.transaction_id, f]));
  if (byTransaction.size !== families.length || families.some(f => f.user_id !== owner || !rowMap.has(f.transaction_id)))
    throw new Error('Owned unique valuation families required.');
  const revisions = rawRevisions.map(r => parseBankValuationRevision(owner, r));
  unique(revisions);
  if (new Set(revisions.map(r => r.request_id)).size !== revisions.length) throw new Error('Duplicate valuation request history.');
  if (revisions.some(r => !familyMap.has(r.family_id))) throw new Error('Unexpected valuation revision family.');
  unique(decisions);
  if(new Set(decisions.map(d=>d.foreign_request_id)).size!==decisions.length||decisions.length>20000||decisions.some(d=>d.user_id!==owner||!rowMap.has(d.transaction_id)||rowMap.get(d.transaction_id)!.currency==='GBP'))throw new Error('Unexpected foreign decision history.');
  const recordIds = new Set<string>();
  const observations = expected.map(source => {
    const row = rowMap.get(source.id), account = coverage.accounts.find(a => a.id === source.account_id);
    if (!row || !account || row.user_id !== owner || row.account_id !== source.account_id || row.import_id !== source.import_id ||
        row.source_row_id !== source.source_row_id || row.transaction_date !== source.cash_date || row.tax_year_start !== source.tax_year_start ||
        row.currency !== source.currency || units(row.signed_amount_pence) !== source.signed_amount_pence ||
        units(row.original_signed_minor) !== source.original_signed_minor || row.source_units_ruleset !== source.ruleset_id ||
        row.classification !== source.classification || row.dedupe_status !== source.dedupe_status || row.decision_version !== source.decision_version)
      throw new Error('Bank export source differs from authoritative coverage.');
    const evidence = one(row.source_rows);
    const imported = one(row.record_imports);
    if(imported.id!==source.import_id || imported.user_id!==owner || imported.file_hash!==source.file_sha256 || imported.parser_version!==source.parser_version)
      throw new Error('Owned immutable source-file provenance required.');
    const source_file_id=fxEvidenceId(imported.source_file_id);
    if (!Number.isInteger(row.business_use_bps) || row.business_use_bps < 0 || row.business_use_bps > 10000)
      throw new Error('Exact business-use percentage required.');
    if (evidence.row_hash !== source.row_sha256 || !Number.isSafeInteger(evidence.row_number) || evidence.row_number < 2)
      throw new Error('Complete original row provenance required.');
    const effects = sourceRecordEffects(row);
    if (effects.records.filter(r => r.status === 'approved').length !== source.approved_record_count)
      throw new Error('Approved bank effect coverage differs.');
    for (const record of effects.records) {
      if (recordIds.has(record.id)) throw new Error('Accounting effect counted more than once.');
      recordIds.add(record.id);
    }
    const family = byTransaction.get(source.id), history = revisions.filter(r => r.family_id === family?.id).sort((a,b) => a.ordinal - b.ordinal);
    if ((source.valuation === null) !== (family === undefined) || (source.valuation?.ordinal ?? 0) !== history.length)
      throw new Error('Complete valuation family history required.');
    for (const [i, revision] of history.entries()) {
      const economic = revision.source_snapshot.economic_source;
      if (revision.ordinal !== i + 1 || revision.previous_revision_id !== (i ? history[i-1].id : null) ||
          revision.family_id !== source.valuation?.family_id || economic.transaction_id !== source.id ||
          economic.account_id !== source.account_id || economic.import_id !== source.import_id || economic.source_row_id !== source.source_row_id ||
          economic.cash_date !== source.cash_date || economic.currency !== source.currency ||
          String(economic.original_signed_minor) !== source.original_signed_minor || economic.row_number !== evidence.row_number ||
          economic.source_file_id!==source_file_id || economic.file_sha256!==source.file_sha256 || economic.row_sha256!==source.row_sha256 ||
          economic.parser_version!==source.parser_version || economic.ruleset_id!==source.ruleset_id || economic.account_currency!==account.currency ||
          economic.size_bytes!==history[0].source_snapshot.economic_source.size_bytes)
        throw new Error('Complete valuation ancestry and economic source required.');
    }
    const head = history.at(-1);
    if (head && (head.id !== source.valuation?.id || head.state !== source.valuation.state || String(head.signed_gbp_pence) !== source.valuation.signed_gbp_pence))
      throw new Error('Valuation head differs from authoritative coverage.');
    const duplicate = row.duplicate_decision == null ? null : one(row.duplicate_decision);
    if (row.active_duplicate_decision_id && duplicate?.id !== row.active_duplicate_decision_id)
      throw new Error('Complete duplicate provenance required.');
    return {
      ...source, source_file_id, account_currency: account.currency,
      actual_signed_gbp_pence:source.representation==='native_gbp'?source.signed_amount_pence:null,
      currency_exponent: Object.hasOwn(FX_CURRENCIES, source.currency) ? FX_CURRENCIES[source.currency as CurrencyCode].exponent : null,
      source_row_number: evidence.row_number, business_use_bps: row.business_use_bps,
      active_transfer_id: row.active_transfer_id ?? null, active_refund_id: row.active_refund_id ?? null,
      active_duplicate_decision_id: row.active_duplicate_decision_id ?? null,
      retained_duplicate_transaction_id: duplicate?.retained_transaction_id ?? null,
      financial_records: effects.records, refund_portions: effects.refundPortions,
      recognized_income_pence: effects.incomePence, recognized_expense_pence: effects.expensePence,
      recognized_profit_pence: effects.profitPence, valuation_history: history,
      classification_history:source.representation==='foreign'?foreignClassificationExport(owner,row,decisions.filter(d=>d.transaction_id===row.id),history,effects):[],
    };
  }).sort((a,b) => a.id.localeCompare(b.id));
  const snapshot = { schema_version: BANK_EXPORT_SCHEMA, owner_id: owner, import_id: importId ?? null,
    scope: 'complete_selected_bank_observations; retained_valuations_are_not_cash_or_recognized_effects',
    coverage_stamp: coverage.stamp, observation_count: observations.length,
    recognized_income_pence: sumPence(observations.map(r => r.recognized_income_pence)),
    recognized_expense_pence: sumPence(observations.map(r => r.recognized_expense_pence)),
    current_valuation_documents: [] as {id:string;current:ReturnType<typeof parseRegisteredDocumentSource>|null}[], observations };
  const canonical = canonicalJson(snapshot);
  if (Buffer.byteLength(canonical) > 4_000_000) throw new Error('Complete bank context exceeds download capacity.');
  return { snapshot, snapshot_sha256: sha256(canonical) };
}
export type BankExportContext = ReturnType<typeof bankExportContext>;

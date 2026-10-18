import { recordEffectPence } from "./accounting-effect";
import { sumPence } from "../money";
import { escapeCsv } from "./export-csv";
import { minorPence } from './allocations';

export type SourceExportRecord = {
  id: string; amount: string | number; status: string; record_type?: string;
  effect_sign?: number; refund_link_id?: string | null;
  bank_transaction_id?: string | null; record_date?: string;
  category_id?: string | null; project_id?: string | null;
};
export type SourceRefundPortion = {
  id: string; original_transaction_id: string; refund_transaction_id: string;
  amount_pence: number | string; recognized_pence: number | string;
  record_type: string; business_use_bps: number; category_id: string; request_id: string;
  original: { id: string; import_id: string; source_row_id: string; transaction_date: string } | { id: string; import_id: string; source_row_id: string; transaction_date: string }[] | null;
  reversals: { id: string } | { id: string }[] | null;
};

export type SourceExportRow = {
  id: string;
  transaction_date: string;
  signed_amount_pence: number | string;
  currency: string;
  description: string;
  reference: string;
  classification: string;
  business_use_bps: number;
  dedupe_status: string;
  decision_version: number;
  active_transfer_id?: string | null;
  active_refund_id?: string | null;
  active_duplicate_decision_id?: string | null;
  duplicate_decision?:
    | { id: string; retained_transaction_id: string | null }
    | { id: string; retained_transaction_id: string | null }[]
    | null;
  source_row_id: string;
  tax_year_start: number;
  source_rows:
    | { row_number: number; row_hash: string }
    | { row_number: number; row_hash: string }[]
    | null;
  record: SourceExportRecord | SourceExportRecord[] | null;
  refund_portions?: SourceRefundPortion[];
};
const one = <T>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : value;

/** A bank observation owns cash once and may have multiple retained accounting effects. */
export function sourceRecordEffects(row: Omit<SourceExportRow, 'signed_amount_pence'> & { signed_amount_pence: number | string | null }) {
  const records = (Array.isArray(row.record) ? [...row.record] : row.record ? [row.record] : []).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (new Set(records.map(r => r.id)).size !== records.length) throw new Error('Duplicate accounting-effect provenance.');
  const safe = records.map(r => {
    if (r.bank_transaction_id !== undefined && r.bank_transaction_id !== row.id) throw new Error('Accounting effect belongs to another source observation.');
    const effect = recordEffectPence(r); // Also validate retained excluded magnitudes/signs.
    if ((r.effect_sign === -1 && (!r.refund_link_id || !['income','expense'].includes(r.record_type ?? ''))) ||
        (r.effect_sign !== -1 && r.refund_link_id)) throw new Error('Missing refund accounting bucket or link provenance.');
    if (r.record_type == null && (row.currency !== 'GBP' || row.signed_amount_pence === null))
      throw new Error('Foreign accounting effects require an explicit accounting bucket.');
    const kind = r.record_type ?? (minorPence(row.signed_amount_pence!) > 0 ? 'income' : 'expense');
    if (!['income','expense'].includes(kind)) throw new Error('Invalid accounting bucket.');
    return { id: r.id, amount_gbp: String(r.amount), status: r.status, record_type: kind, effect_sign: r.effect_sign ?? 1,
      recognized_effect_pence: r.status === 'approved' ? effect : 0, refund_link_id: r.refund_link_id ?? null,
      record_date: r.record_date ?? null, category_id: r.category_id ?? null, project_id: r.project_id ?? null };
  });
  const incomePence = sumPence(safe.filter(r => r.record_type === 'income').map(r => r.recognized_effect_pence));
  const expensePence = sumPence(safe.filter(r => r.record_type === 'expense').map(r => r.recognized_effect_pence));
  const portions = [...(row.refund_portions ?? [])].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(l => {
    const original=one(l.original),reversals=Array.isArray(l.reversals)?l.reversals:l.reversals?[l.reversals]:[];
    const cash=minorPence(l.amount_pence),recognized=minorPence(l.recognized_pence);
    if(l.refund_transaction_id!==row.id || !original || original.id!==l.original_transaction_id || !original.import_id || !original.source_row_id || !original.transaction_date ||
      cash<=0 || recognized<0 || recognized>cash || !['income','expense'].includes(l.record_type) || !Number.isInteger(l.business_use_bps) || l.business_use_bps<1 || l.business_use_bps>10000)
      throw new Error('Incomplete refund portion provenance.');
    return {id:l.id,original_transaction_id:l.original_transaction_id,refund_transaction_id:row.id,amount_pence:cash,recognized_pence:recognized,
      record_type:l.record_type,business_use_bps:l.business_use_bps,category_id:l.category_id,request_id:l.request_id,
      original_source:{id:original.id,import_id:original.import_id,source_row_id:original.source_row_id,transaction_date:original.transaction_date},
      reversal_ids:reversals.map(r=>r.id).sort(),active:reversals.length===0};
  });
  if(new Set(portions.map(l=>l.id)).size!==portions.length)throw new Error('Duplicate refund portion provenance.');
  if(row.refund_portions!==undefined){
    const active=portions.filter(l=>l.active);
    if((row.active_refund_id && !active.some(l=>l.id===row.active_refund_id)) || (active.length && (row.signed_amount_pence===null || sumPence(active.map(l=>l.amount_pence))!==Math.abs(minorPence(row.signed_amount_pence)))))throw new Error('Incomplete refund cash allocation.');
    for(const l of active){const effects=safe.filter(r=>r.status==='approved' && r.refund_link_id===l.id);
      if(effects.length!==(l.recognized_pence>0?1:0) || sumPence(effects.map(r=>r.recognized_effect_pence))!==-l.recognized_pence || effects.some(r=>r.record_type!==l.record_type || r.category_id!==l.category_id))throw new Error('Incomplete approved refund portion effects.');}
    if(safe.some(r=>r.status==='approved' && ((active.length && r.effect_sign!==-1) || (r.effect_sign===-1 && !active.some(l=>l.id===r.refund_link_id)))))throw new Error('Unreviewed refund accounting effect.');
  }
  return { records: safe, refundPortions: portions, incomePence, expensePence, recognizedPence: sumPence([incomePence,expensePence]), profitPence: sumPence([incomePence,-expensePence]) };
}
export function evidenceLedger(
  meta: {
    id: string;
    file_hash: string;
    parser_version: string;
    account_label: string;
    account_mask: string;
  },
  rows: SourceExportRow[],
) {
  if (new Set(rows.map(r => r.id)).size !== rows.length) throw new Error('Duplicate source observation.');
  const effects = rows.map((r) => {
    if (
      r.active_duplicate_decision_id &&
      one(r.duplicate_decision ?? null)?.id !== r.active_duplicate_decision_id
    )
      throw new Error("Missing active identity provenance.");
    return sourceRecordEffects(r);
  });
  const incomePence = sumPence(effects.map(r => r.incomePence));
  const expensePence = sumPence(effects.map(r => r.expensePence));
  const header = [
    "document_status",
    "import_id",
    "file_sha256",
    "parser_version",
    "account_label",
    "account_ending",
    "transaction_id",
    "source_row_id",
    "source_row_number",
    "source_row_sha256",
    "date",
    "tax_year_start",
    "signed_amount_pence",
    "currency",
    "description",
    "reference",
    "classification",
    "business_use_basis_points",
    "dedupe_status",
    "decision_version",
    "financial_record_id",
    "financial_record_status",
    "recognized_pence",
    "active_transfer_pair_id",
    "record_type",
    "effect_sign",
    "refund_link_id",
    "active_refund_id",
    "active_duplicate_decision_id",
    "retained_duplicate_transaction_id",
    "export_schema_version",
    "financial_record_count",
    "financial_records_json",
    "recognized_income_pence",
    "recognized_expense_pence",
    "recognized_profit_pence",
    "refund_portions_json",
  ];
  const cells = rows.map((r, i) => {
    const source = one(r.source_rows);
    const e = effects[i], rec = e.records.length === 1 ? e.records[0] : null;
    if (!source) throw new Error("Missing source-row provenance.");
    return [
      "Draft — not submitted to HMRC",
      meta.id,
      meta.file_hash,
      meta.parser_version,
      meta.account_label,
      meta.account_mask,
      r.id,
      r.source_row_id,
      String(source.row_number),
      source.row_hash,
      r.transaction_date,
      String(r.tax_year_start),
      String(r.signed_amount_pence),
      r.currency,
      r.description,
      r.reference,
      r.classification,
      String(r.business_use_bps),
      r.dedupe_status,
      String(r.decision_version),
      rec?.id ?? "",
      rec?.status ?? (e.records.length ? 'multiple_retained_effects' : 'unresolved'),
      String(e.recognizedPence),
      r.active_transfer_id ?? "",
      rec?.record_type ?? "",
      rec ? String(rec.effect_sign) : "",
      rec?.refund_link_id ?? "",
      r.active_refund_id ?? "",
      r.active_duplicate_decision_id ?? "",
      one(r.duplicate_decision ?? null)?.retained_transaction_id ?? "",
      "vibecount.evidence-ledger/2",
      String(e.records.length),
      JSON.stringify(e.records),
      String(e.incomePence), String(e.expensePence), String(e.profitPence),
      JSON.stringify(e.refundPortions),
    ];
  });
  return {
    csv: [header, ...cells]
      .map((row) => row.map(escapeCsv).join(","))
      .join("\r\n"),
    incomePence,
    expensePence,
  };
}

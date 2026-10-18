import type { TransferExportPair } from "./transfer-export";
import { minorPence } from './allocations';
import { sumPence } from '../money';
type Source = TransferExportPair["outgoing"];
const one = <T>(v: T | T[] | null) => (Array.isArray(v) ? (v[0] ?? null) : v);
export type RefundExportLink = {
  id: string;
  original_transaction_id: string;
  refund_transaction_id: string;
  amount_pence: number | string;
  recognized_pence: number | string;
  record_type: string;
  category_id?: string;
  business_use_bps: number;
  author: string;
  rationale: string;
  request_id: string;
  created_at: string;
  original_snapshot: { date: string };
  refund_snapshot: { date: string };
  original: Source;
  refund: Source;
};
export type RefundExportReversal = {
  id: string;
  refund_id: string;
  author: string;
  rationale: string;
  request_id: string;
  created_at: string;
};
export const refundExportHeaders = [
  "refund_link_id",
  "accounting_record_type",
  "recognized_effect_pence",
  "business_use_basis_points",
  "original_transaction_id",
  "original_source_row_id",
  "original_source_row_number",
  "original_source_row_sha256",
  "original_file_sha256",
  "original_date",
  "refund_date",
  "original_account",
  "refund_account",
  "category_id",
];
/** Observation cash is repeated as context but contributes once, independently
 * of retained/reversed portions. Active portions have a separate cash total. */
export function refundObservationFields(links: RefundExportLink[], reversals: RefundExportReversal[]) {
  if (new Set(links.map(l => l.id)).size !== links.length) throw new Error('Duplicate refund link evidence.');
  const byId = new Map(links.map(l => [l.id, l])), reversed = new Set(reversals.map(r => r.refund_id)), groups = new Map<string, { cash: number; first: string; active: number[] }>();
  for (const l of links) {
    const refund = one(l.refund), portion = minorPence(l.amount_pence);
    if (!refund || refund.id !== l.refund_transaction_id || refund.signed_amount_pence === undefined || portion <= 0) throw new Error('Missing refund cash observation.');
    const cash = minorPence(refund.signed_amount_pence);
    if (cash === 0 || Math.abs(cash) > 999999999999 || portion > Math.abs(cash)) throw new Error('Invalid refund cash observation.');
    const group = groups.get(refund.id) ?? { cash, first: l.id, active: [] };
    if (group.cash !== cash) throw new Error('Inconsistent shared refund cash.');
    if (l.id < group.first) group.first = l.id;
    if (!reversed.has(l.id)) group.active.push(portion);
    groups.set(refund.id, group);
  }
  for (const group of groups.values()) if (group.active.length && sumPence(group.active) !== Math.abs(group.cash)) throw new Error('Incomplete active refund cash allocation.');
  return (linkId: string, reversal: boolean) => {
    const link = byId.get(linkId), group = link && groups.get(link.refund_transaction_id);
    if (!link || !group) throw new Error('Missing refund observation evidence.');
    return [String(group.cash), String(!reversal && group.first === link.id ? group.cash : 0), String(link.amount_pence), String(!reversal && !reversed.has(link.id) ? link.amount_pence : 0)];
  };
}
export function refundExportRows(
  links: RefundExportLink[],
  reversals: RefundExportReversal[],
) {
  function row(
    l: RefundExportLink,
    e: RefundExportLink | RefundExportReversal,
    reversed: boolean,
  ) {
    const original = one(l.original),
      refund = one(l.refund),
      os = original && one(original.source_rows),
      rs = refund && one(refund.source_rows),
      of = original && one(original.record_imports),
      rf = refund && one(refund.record_imports),
      oa = original && one(original.financial_accounts),
      ra = refund && one(refund.financial_accounts);
    if (!original || !refund || !os || !rs || !of || !rf || !oa || !ra)
      throw new Error("Missing original/refund evidence.");
    return [
      "Draft — not submitted to HMRC",
      "refund_event",
      "",
      "",
      refund.id,
      e.id,
      reversed ? "reversal" : "refund",
      reversed ? l.id : "",
      String(l.amount_pence),
      "",
      "",
      refund.source_row_id,
      String(rs.row_number),
      rs.row_hash,
      rf.file_hash,
      e.created_at,
      reversed
        ? "Unknown — refund reduction excluded"
        : "Refund — reduces " + l.record_type,
      e.author,
      e.rationale,
      e.request_id,
      ...Array(9).fill(""),
      l.id,
      l.record_type,
      String((reversed ? 1 : -1) * Number(l.recognized_pence)),
      String(l.business_use_bps),
      original.id,
      original.source_row_id,
      String(os.row_number),
      os.row_hash,
      of.file_hash,
      l.original_snapshot.date,
      l.refund_snapshot.date,
      `${oa.label} ending ${oa.masked_identifier}`,
      `${ra.label} ending ${ra.masked_identifier}`,
      l.category_id ?? "",
    ];
  }
  return [
    ...links.map((l) => row(l, l, false)),
    ...reversals.map((e) => {
      const l = links.find((l) => l.id === e.refund_id);
      if (!l) throw new Error("Missing reversed refund evidence.");
      return row(l, e, true);
    }),
  ];
}

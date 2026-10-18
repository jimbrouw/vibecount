import type { RefundExportLink } from "../records/refund-export";
import { minorPence } from "../records/allocations";
export type AssignmentExportRow = {
  id: string;
  invoice_id: string;
  allocation_id: string;
  credit_id: string;
  refund_id: string;
  amount_pence: number | string;
  invoice_snapshot: { number: string };
  credit_snapshot: { pdf_sha256: string };
  author: string;
  rationale: string;
  request_id: string;
  created_at: string;
};
export type AssignmentExportReversal = {
  id: string;
  assignment_id: string;
  author: string;
  rationale: string;
  request_id: string;
  created_at: string;
};
export const assignmentExportHeaders = [
  "invoice_refund_assignment_id",
  "assignment_allocation_id",
  "assignment_credit_id",
  "assignment_refund_link_id",
  "assignment_original_transaction_id",
  "assignment_original_source_row_id",
  "assignment_original_row_sha256",
  "assignment_original_file_sha256",
  "assignment_credit_pdf_sha256",
  "retained_cash_effect_pence",
  "assignment_accounting_effect_pence",
  "invoice_returned_pence",
  "assignment_refund_date",
];
const one = <T>(v: T | T[] | null) => (Array.isArray(v) ? (v[0] ?? null) : v);
export function assignmentExportRows(
  assignments: AssignmentExportRow[],
  reversals: AssignmentExportReversal[],
  refunds: RefundExportLink[],
  prefix: number,
) {
  function row(
    a: AssignmentExportRow,
    event: AssignmentExportRow | AssignmentExportReversal,
    reverse: boolean,
  ) {
    const refund = refunds.find((r) => r.id === a.refund_id),
      original = refund && one(refund.original),
      returned = refund && one(refund.refund),
      os = original && one(original.source_rows),
      of = original && one(original.record_imports),
      rs = returned && one(returned.source_rows),
      rf = returned && one(returned.record_imports);
    if (
      !refund ||
      !original ||
      !returned ||
      !os ||
      !of ||
      !rs ||
      !rf ||
      !a.invoice_snapshot.number ||
      !/^[a-f0-9]{64}$/.test(a.credit_snapshot.pdf_sha256)
    )
      throw new Error("Missing refund assignment provenance.");
    const base = [
      "Draft — not submitted to HMRC",
      "refund_assignment_event",
      a.invoice_id,
      a.invoice_snapshot.number,
      returned.id,
      event.id,
      reverse ? "refund_assignment_reversal" : "refund_assignment",
      reverse ? a.id : "",
      String(a.amount_pence),
      "",
      "",
      returned.source_row_id,
      String(rs.row_number),
      rs.row_hash,
      rf.file_hash,
      event.created_at,
      reverse
        ? "Unmatched; parents remain approved"
        : "Matched recorded return; zero extra posting",
      event.author,
      event.rationale,
      event.request_id,
    ];
    while (base.length < prefix) base.push("");
    base.push(
      a.id,
      a.allocation_id,
      a.credit_id,
      a.refund_id,
      original.id,
      original.source_row_id,
      os.row_hash,
      of.file_hash,
      a.credit_snapshot.pdf_sha256,
      String((reverse ? 1 : -1) * minorPence(a.amount_pence)),
      "0",
      "",
      refund.refund_snapshot.date,
    );
    return base;
  }
  return [
    ...assignments.map((a) => row(a, a, false)),
    ...reversals.map((r) => {
      const a = assignments.find((a) => a.id === r.assignment_id);
      if (!a) throw new Error("Missing reversed refund assignment.");
      return row(a, r, true);
    }),
  ];
}

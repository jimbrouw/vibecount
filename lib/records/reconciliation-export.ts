import {
  refundExportHeaders,
  refundExportRows,
  refundObservationFields,
  type RefundExportLink,
  type RefundExportReversal,
} from "./refund-export";
import { escapeCsv } from "./export-csv.ts";
import {
  assignmentExportHeaders,
  assignmentExportRows,
  type AssignmentExportRow,
  type AssignmentExportReversal,
} from "../invoices/refund-assignment-export";
import {
  creditExportHeaders,
  creditExportRows,
  type CreditExportNote,
  type CreditExportReversal,
} from "../invoices/credit-export";
import {
  transferExportHeaders,
  transferExportRows,
  type TransferExportPair,
  type TransferExportReversal,
} from "./transfer-export.ts";

type Relation<T> = T | T[] | null;
const one = <T>(value: Relation<T>) =>
  Array.isArray(value) ? (value[0] ?? null) : value;
export type SettlementExportRow = {
  id: string;
  invoice_id: string;
  transaction_id: string;
  amount_pence: number | string;
  event_kind: string;
  reverses_id: string | null;
  request_id: string;
  author: string;
  rationale: string;
  created_at: string;
  invoice_snapshot: { number: string; gross_pence: number; currency: string };
  transaction: Relation<{
    id: string;
    transaction_date: string;
    source_row_id: string;
    source_rows: Relation<{ row_number: number; row_hash: string }>;
    record_imports: Relation<{ file_hash: string; parser_version: string }>;
  }>;
};
export type ReceiptExportBalance = {
  id: string;
  import_id: string;
  transaction_date: string;
  signed_amount_pence: number | string;
  allocated_pence: number | string;
  unallocated_pence: number | string;
  classification: string;
  record_status: string | null;
  active_transfer_id?: string | null;
  active_refund_id?: string | null;
  refunded_pence?: number | string;
  source_row_id: string;
  source_rows: Relation<{ row_number: number; row_hash: string }>;
  record_imports: Relation<{ file_hash: string }>;
};
export type InvoiceExportBalance = {
  currency?: string;
  status?: string;
  id: string;
  number: string;
  invoice_pence: number | string;
  allocated_pence: number | string;
  outstanding_pence: number | string;
  delivery_status: string;
  credited_pence?: number | string;
  entitlement_pence?: number | string;
  refund_due_pence?: number | string;
  retained_cash_pence?: number | string;
  returned_pence?: number | string;
};
export function reconciliationExportTable(
  events: SettlementExportRow[],
  receipts: ReceiptExportBalance[],
  invoices: InvoiceExportBalance[],
  pairs: TransferExportPair[] = [],
  reversals: TransferExportReversal[] = [],
  refunds: RefundExportLink[] = [],
  refundReversals: RefundExportReversal[] = [],
  credits: CreditExportNote[] = [],
  creditReversals: CreditExportReversal[] = [],
  assignments: AssignmentExportRow[] = [],
  assignmentReversals: AssignmentExportReversal[] = [],
) {
  const creditStart =
    20 + transferExportHeaders.length + refundExportHeaders.length;
  const assignmentStart = creditStart + creditExportHeaders.length;
  const header = [
    "document_status",
    "row_kind",
    "invoice_id",
    "invoice_number",
    "transaction_id",
    "decision_event_id",
    "event_kind",
    "reverses_id",
    "amount_pence",
    "allocated_pence",
    "unallocated_or_outstanding_pence",
    "source_row_id",
    "source_row_number",
    "source_row_sha256",
    "file_sha256",
    "date",
    "classification_or_status",
    "author",
    "rationale",
    "request_id",
    ...transferExportHeaders,
    ...refundExportHeaders,
    ...creditExportHeaders,
    ...assignmentExportHeaders,
  ];
  const draft = "Draft — not submitted to HMRC";
  const rows: string[][] = events.map((event) => {
    const tx = one(event.transaction),
      source = tx && one(tx.source_rows),
      file = tx && one(tx.record_imports);
    if (!tx || !source || !file)
      throw new Error("Missing reconciliation evidence.");
    return [
      draft,
      "settlement_event",
      event.invoice_id,
      event.invoice_snapshot.number,
      event.transaction_id,
      event.id,
      event.event_kind,
      event.reverses_id ?? "",
      String(event.amount_pence),
      "",
      "",
      tx.source_row_id,
      String(source.row_number),
      source.row_hash,
      file.file_hash,
      event.created_at,
      event.event_kind,
      event.author,
      event.rationale,
      event.request_id,
    ];
  });
  for (const receipt of receipts) {
    const source = one(receipt.source_rows),
      file = one(receipt.record_imports);
    if (!source || !file) throw new Error("Missing receipt evidence.");
    rows.push([
      draft,
      "receipt_balance",
      "",
      "",
      receipt.id,
      "",
      "",
      "",
      String(receipt.signed_amount_pence),
      String(receipt.allocated_pence),
      String(receipt.unallocated_pence),
      receipt.source_row_id,
      String(source.row_number),
      source.row_hash,
      file.file_hash,
      receipt.transaction_date,
      `${receipt.classification}; ${receipt.record_status ?? "unresolved"}; refund link ${receipt.active_refund_id ?? "none"}; refunded cash ${receipt.refunded_pence ?? 0} pence — invoice credit/correction separate`,
      "",
      "",
      "",
      receipt.active_transfer_id ?? "",
    ]);
  }
  for (const invoice of invoices) {
    const row = [
      draft,
      "invoice_balance",
      invoice.id,
      invoice.number,
      "",
      "",
      "",
      "",
      String(invoice.invoice_pence),
      String(invoice.allocated_pence),
      String(invoice.outstanding_pence),
      "",
      "",
      "",
      "",
      "",
      "Evidence-backed allocation balance; legacy marker: " +
        invoice.delivery_status,
      "",
      "",
      "",
    ];
    while (row.length < creditStart) row.push("");
    row.push(
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      String(invoice.credited_pence ?? 0),
      String(invoice.entitlement_pence ?? invoice.invoice_pence),
      String(invoice.refund_due_pence ?? 0),
      String(invoice.retained_cash_pence ?? invoice.allocated_pence),
      "",
      "",
      "",
    );
    while (row.length < assignmentStart) row.push("");
    row.push(
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      String(invoice.returned_pence ?? 0),
      "",
    );
    rows.push(row);
  }
  rows.push(
    ...transferExportRows(pairs, reversals),
    ...refundExportRows(refunds, refundReversals),
    ...creditExportRows(credits, creditReversals, creditStart),
    ...assignmentExportRows(
      assignments,
      assignmentReversals,
      refunds,
      assignmentStart,
    ),
  );
  const refundCash = refundObservationFields(refunds, refundReversals), linkColumn = header.indexOf('refund_link_id');
  for (const row of rows) {
    while (row.length < header.length) row.push("");
    const cash = row[1] === 'refund_event' ? refundCash(row[linkColumn], row[6] === 'reversal') : ['', '', '', ''];
    row.push('vibecount.reconciliation/2', ...cash);
  }
  header.push('reconciliation_schema_version', 'refund_observed_signed_cash_pence', 'refund_observed_signed_cash_once_pence', 'refund_cash_portion_pence', 'refund_active_cash_portion_pence');
  return { header, rows, count: rows.length };
}

/** Retained version 2 serialization. New dimensions are emitted by a separate V3 exporter. */
export function reconciliationExport(...args: Parameters<typeof reconciliationExportTable>) {
  const { header, rows, count } = reconciliationExportTable(...args);
  return {
    csv: [header, ...rows]
      .map((row) => row.map(escapeCsv).join(","))
      .join("\r\n"),
    count,
  };
}

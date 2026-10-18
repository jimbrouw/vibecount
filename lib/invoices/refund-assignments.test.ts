import assert from "node:assert/strict";
import test from "node:test";
import {
  refundAssignmentReview,
  type RefundAssignmentChoice,
} from "./refund-assignments.ts";
import { reconciliationExport } from "../records/reconciliation-export.ts";
import { readSourceCsv } from "../records/source-csv.ts";
import type { RefundExportLink } from "../records/refund-export.ts";
const choice: RefundAssignmentChoice = {
  id: "choice",
  credit_id: "credit",
  credit_number: "CN-120-001",
  credit_pdf_sha256: "c".repeat(64),
  allocation_id: "allocation",
  refund_id: "refund",
  original_transaction_id: "receipt",
  refund_transaction_id: "returned",
  invoice_id: "invoice",
  invoice_number: "INV-120",
  invoice_pence: 12000,
  allocated_pence: 12000,
  credited_pence: 3000,
  returned_pence: 0,
  credit_remaining_pence: 3000,
  allocation_remaining_pence: 12000,
  refund_remaining_pence: 3000,
};
test("returned-cash matching settles an overpayment and can reopen a partially funded invoice without any tax effect", () => {
  const full = refundAssignmentReview(choice, "30.00");
  assert.equal(full.after.retained, 9000);
  assert.equal(full.before.refundDue, 3000);
  assert.equal(full.after.refundDue, 0);
  assert.equal(full.after.outstanding, 0);
  const partial = refundAssignmentReview(
    {
      ...choice,
      invoice_pence: 10000,
      allocated_pence: 7000,
      allocation_remaining_pence: 7000,
    },
    "30.00",
  );
  assert.equal(partial.before.outstanding, 0);
  assert.equal(partial.after.outstanding, 3000);
  assert.equal(partial.after.retained, 4000);
  for (const input of ["0", "-1", "30.001", "30.01", "1e2"])
    assert.throws(() => refundAssignmentReview(choice, input));
  for (const key of [
    "credit_remaining_pence",
    "allocation_remaining_pence",
    "refund_remaining_pence",
  ] as const)
    assert.throws(() =>
      refundAssignmentReview({ ...choice, [key]: 100 }, "1.01"),
    );
});
test("assignment exports preserve both source chains, reversal direction and zero extra accounting effects", () => {
  const source = (id: string) => ({
    id,
    source_row_id: id + "-row",
    source_rows: { row_number: 2, row_hash: id + "-row-hash" },
    record_imports: { file_hash: id + "-file-hash" },
    financial_accounts: { label: "Synthetic bank", masked_identifier: "1234" },
  });
  const refund: RefundExportLink = {
    id: "refund",
    original_transaction_id: "receipt",
    refund_transaction_id: "returned",
    amount_pence: 3000,
    recognized_pence: 3000,
    record_type: "income",
    business_use_bps: 10000,
    author: "owner",
    rationale: "Bank refund",
    request_id: "refund-request",
    created_at: "2026-04-06",
    original_snapshot: { date: "2026-04-05" },
    refund_snapshot: { date: "2026-04-06" },
    original: source("receipt"),
    refund: { ...source("returned"), signed_amount_pence: -3000 },
  };
  const assignment = {
    id: "assignment",
    invoice_id: "invoice",
    allocation_id: "allocation",
    credit_id: "credit",
    refund_id: "refund",
    amount_pence: 3000,
    invoice_snapshot: { number: "INV-120" },
    credit_snapshot: { pdf_sha256: "c".repeat(64) },
    author: "owner",
    rationale: "=unsafe",
    request_id: "assignment-request",
    created_at: "2026-04-07",
  };
  const reversal = {
    id: "reversal",
    assignment_id: "assignment",
    author: "owner",
    rationale: "Unmatch",
    request_id: "reverse-request",
    created_at: "2026-04-08",
  };
  const csv = reconciliationExport(
    [],
    [],
    [
      {
        id: "invoice",
        number: "INV-120",
        invoice_pence: 12000,
        allocated_pence: 12000,
        outstanding_pence: 0,
        delivery_status: "paid",
        returned_pence: 3000,
        retained_cash_pence: 9000,
      },
    ],
    [],
    [],
    [refund],
    [],
    [],
    [],
    [assignment],
    [reversal],
  ).csv;
  const [header, ...rows] = readSourceCsv(csv),
    col = (name: string) => header.indexOf(name),
    events = rows.filter(
      (r) => r[col("row_kind")] === "refund_assignment_event",
    );
  assert.ok(rows.every((r) => r.length === header.length));
  assert.equal(rows[0][col("invoice_returned_pence")], "3000");
  assert.equal(rows[0][col("retained_cash_pence")], "9000");
  assert.equal(events[0][col("retained_cash_effect_pence")], "-3000");
  assert.equal(events[1][col("retained_cash_effect_pence")], "3000");
  assert.ok(
    events.every((r) => r[col("assignment_accounting_effect_pence")] === "0"),
  );
  assert.equal(
    events[0][col("assignment_original_file_sha256")],
    "receipt-file-hash",
  );
  assert.equal(events[0][col("file_sha256")], "returned-file-hash");
  assert.equal(
    events[0][col("assignment_credit_pdf_sha256")],
    assignment.credit_snapshot.pdf_sha256,
  );
  assert.equal(events[0][col("rationale")], "'=unsafe");
  assert.throws(
    () =>
      reconciliationExport(
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [assignment],
        [],
      ),
    /Missing refund assignment provenance/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { refundReview, type RefundChoice } from "./refunds.ts";
import { recordEffectPence, recordEffectDecimal } from "./accounting-effect.ts";
import { buildSelfAssessmentChecklist } from "./self-assessment.ts";
import { evidenceLedger, type SourceExportRow } from "./source-export.ts";
import { evidenceManifest } from "./evidence-manifest.ts";
import { readSourceCsv } from "./source-csv.ts";
import { reconciliationExport } from "./reconciliation-export.ts";
import type { RefundExportLink } from "./refund-export.ts";
const base: RefundChoice = {
  id: "original",
  account_id: "account",
  import_id: "original-import",
  transaction_date: "2026-04-05",
  signed_amount_pence: -63029,
  currency: "GBP",
  description: "Synthetic car repair",
  account_label: "Synthetic bank",
  account_mask: "1234",
  account_type: "bank",
  classification: "Mixed",
  decision_version: 1,
  dedupe_status: "clear",
  active_transfer_id: null,
  active_refund_id: null,
  has_refunds: false,
  import_status: "review",
  record_status: "approved",
  recognized_pence: 18909,
  invoice_allocated_pence: 0,
  business_use_bps: 3000,
  record_type: "expense",
  effect_sign: 1,
  category_id: "travel",
  refunded_pence: 0,
  reduced_pence: 0,
  refund_count: 0,
  refund_stamp: "a".repeat(32),
};
const refund: RefundChoice = {
  ...base,
  id: "refund",
  import_id: "refund-import",
  transaction_date: "2026-04-06",
  signed_amount_pence: 10000,
  classification: "Unknown",
  record_status: null,
  recognized_pence: 0,
  effect_sign: null,
};
test("refund preview uses original bucket and cumulative mixed-use rounding, including zero pennies", () => {
  assert.equal(refundReview(base, refund).reduction, 3000);
  const second = refundReview(
    { ...base, refunded_pence: 10000, reduced_pence: 3000 },
    { ...refund, signed_amount_pence: 53029 },
  );
  assert.equal(second.reduction, 15909);
  assert.equal(second.remainingGross, 0);
  const tiny = {
    ...base,
    signed_amount_pence: -2,
    business_use_bps: 5000,
    recognized_pence: 1,
    refunded_pence: 1,
    reduced_pence: 1,
  };
  assert.equal(
    refundReview(tiny, { ...refund, signed_amount_pence: 1 }).reduction,
    0,
  );
  assert.throws(
    () => refundReview(base, { ...refund, signed_amount_pence: 63030 }),
    /exceeds/,
  );
  assert.throws(
    () => refundReview(base, { ...refund, active_refund_id: "prior" }),
    /relationships/,
  );
});
test("signed effects agree across checklist, category totals, source CSV and evidence manifests", () => {
  const category = { name: "Travel costs", sa103_box: "travel costs" };
  const records = [
    {
      record_type: "income" as const,
      amount: "1500.00",
      effect_sign: 1,
      record_categories: null,
    },
    {
      record_type: "income" as const,
      amount: "500.00",
      effect_sign: -1,
      record_categories: null,
    },
    {
      record_type: "expense" as const,
      amount: "189.09",
      effect_sign: 1,
      record_categories: category,
    },
    {
      record_type: "expense" as const,
      amount: "30.00",
      effect_sign: -1,
      record_categories: category,
    },
  ];
  const summary = buildSelfAssessmentChecklist(records);
  assert.equal(summary.incomeTotal, 100000);
  assert.equal(summary.expenseTotal, 15909);
  assert.equal(summary.profitTotal, 84091);
  assert.equal(
    summary.items.find((i) => i.id === "travel-costs")?.suggestedValue,
    "£159.09",
  );
  assert.equal(
    recordEffectDecimal({ amount: "30.00", effect_sign: -1 }),
    "-30.00",
  );
  assert.throws(
    () => recordEffectPence({ amount: "30", effect_sign: 0 }),
    /Invalid/,
  );
  const source = {
    id: "refund-import",
    file_hash: "f".repeat(64),
    parser_version: "mapped-csv/1",
    account_id: "account",
    status: "review",
    created_at: "2026-04-06",
    coverage_start: "2026-04-06",
    coverage_end: "2026-04-06",
  };
  const row: SourceExportRow = {
    id: "refund",
    transaction_date: "2026-04-06",
    signed_amount_pence: 10000,
    currency: "GBP",
    description: "Synthetic refund",
    reference: "",
    classification: "Refund",
    business_use_bps: 3000,
    dedupe_status: "clear",
    decision_version: 1,
    active_refund_id: "link",
    source_row_id: "row",
    tax_year_start: 2026,
    source_rows: { row_number: 2, row_hash: "r".repeat(64) },
    record: {
      id: "posting",
      amount: "30.00",
      status: "approved",
      record_type: "expense",
      effect_sign: -1,
      refund_link_id: "link",
    },
  };
  const exportResult = evidenceLedger(
    { ...source, account_label: "Bank", account_mask: "1234" },
    [row],
  );
  assert.equal(exportResult.incomePence, 0);
  assert.equal(exportResult.expensePence, -3000);
  const csv = readSourceCsv(exportResult.csv);
  assert.equal(csv[1][csv[0].indexOf("recognized_pence")], "-3000");
  const manifest = evidenceManifest(
    source,
    { label: "Bank", masked_identifier: "1234" },
    [row],
  );
  assert.equal(manifest.snapshot.recognized_expense_pence, "-3000");
  assert.equal(
    manifest.snapshot.transactions[0].financial_records[0]?.effect_sign,
    -1,
  );
  assert.equal(manifest.snapshot.transactions[0].active_refund_id, "link");
});
test("refund reconciliation events retain both original/refund source chains and reversible signed trace", () => {
  const source = (id: string) => ({
    id,
    source_row_id: id + "-row",
    source_rows: { row_number: 2, row_hash: id + "-row-hash" },
    record_imports: { file_hash: id + "-file-hash" },
    financial_accounts: { label: "Bank " + id, masked_identifier: "1234" },
  });
  const link: RefundExportLink = {
    id: "link",
    original_transaction_id: "original",
    refund_transaction_id: "refund",
    amount_pence: 10000,
    recognized_pence: 3000,
    record_type: "expense",
    business_use_bps: 3000,
    author: "owner",
    rationale: "=dangerous",
    request_id: "request",
    created_at: "2026-04-07",
    original_snapshot: { date: "2026-04-05" },
    refund_snapshot: { date: "2026-04-06" },
    original: source("original"),
    refund: { ...source("refund"), signed_amount_pence: 10000 },
  };
  const result = reconciliationExport(
    [],
    [],
    [],
    [],
    [],
    [link],
    [
      {
        id: "reversal",
        refund_id: "link",
        author: "owner",
        rationale: "Reviewed reversal",
        request_id: "reverse-request",
        created_at: "2026-04-08",
      },
    ],
  );
  const csv = readSourceCsv(result.csv);
  const col = (name: string) => csv[0].indexOf(name);
  assert.equal(csv[1][col("source_row_sha256")], "refund-row-hash");
  assert.equal(csv[1][col("original_source_row_sha256")], "original-row-hash");
  assert.equal(csv[1][col("recognized_effect_pence")], "-3000");
  assert.equal(csv[2][col("recognized_effect_pence")], "3000");
  assert.equal(csv[1][col("rationale")], "'=dangerous");
  assert.ok(csv.every((row) => row.length === csv[0].length));
  assert.throws(
    () =>
      reconciliationExport([], [], [], [], [], [{ ...link, original: null }]),
    /evidence/,
  );
});

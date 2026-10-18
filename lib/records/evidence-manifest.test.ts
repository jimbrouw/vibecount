import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { evidenceManifest } from "./evidence-manifest.ts";
import type { SourceExportRow } from "./source-export.ts";

const source = {
  id: "import1",
  file_hash: "f".repeat(64),
  parser_version: "mapped-csv/1",
  account_id: "account1",
  status: "review",
  created_at: "2026-10-17T12:00:00Z",
  coverage_start: "2026-02-01",
  coverage_end: "2026-02-02",
  object_path: "PRIVATE PATH",
  key_id: "PRIVATE KEY ID",
  raw_cells: "PRIVATE CELLS",
};
const row: SourceExportRow = {
  id: "tx1",
  transaction_date: "2026-02-01",
  signed_amount_pence: -63029,
  currency: "GBP",
  description: "PRIVATE DESCRIPTION",
  reference: "PRIVATE REFERENCE",
  classification: "Mixed",
  business_use_bps: 3000,
  dedupe_status: "clear",
  decision_version: 1,
  source_row_id: "row1",
  tax_year_start: 2025,
  source_rows: { row_number: 2, row_hash: "a".repeat(64) },
  record: { id: "record1", amount: "189.09", status: "approved" },
};
const account = {
  label: "Bank",
  masked_identifier: "1234",
  full_number: "PRIVATE ACCOUNT",
};

test("evidence manifest carries verifiable hashes, exact totals and exclusions with an explicit privacy allowlist", () => {
  const excluded = {
    ...row,
    id: "tx2",
    classification: "Personal",
    record: { id: "record2", amount: "463.09", status: "excluded" },
  };
  const result = evidenceManifest(source, account, [row, excluded]);
  assert.equal(result.snapshot.recognized_expense_pence, "18909");
  assert.equal(result.snapshot.recognized_income_pence, "0");
  assert.equal(result.snapshot.transaction_count, 2);
  assert.equal(
    result.snapshot.transactions[1].financial_records[0]?.status,
    "excluded",
  );
  assert.equal(result.snapshot.file_sha256, source.file_hash);
  assert.equal(
    result.snapshot.transactions[0].source_row_sha256,
    "a".repeat(64),
  );
  assert.equal(
    result.snapshot_sha256,
    createHash("sha256").update(JSON.stringify(result.snapshot)).digest("hex"),
  );
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  assert.match(result.document_status, /Draft — not submitted to HMRC/);
  assert.deepEqual(evidenceManifest(source, account, [excluded, row]), result);
  const duplicate = {...excluded, dedupe_status: "duplicate", active_duplicate_decision_id: "identity-decision", duplicate_decision: [{id:"identity-decision",retained_transaction_id:"retained-observation"}]};
  const linked = evidenceManifest(source, account, [duplicate]);
  assert.equal(linked.snapshot.transactions[0].active_duplicate_decision_id,"identity-decision");
  assert.equal(linked.snapshot.transactions[0].retained_duplicate_transaction_id,"retained-observation");
  assert.equal(linked.snapshot.recognized_expense_pence,"0");
  assert.throws(()=>evidenceManifest(source, account, [{...duplicate,duplicate_decision:null}]),/identity provenance/);
  assert.notEqual(
    evidenceManifest(source, account, [
      { ...row, decision_version: 2 },
      excluded,
    ]).snapshot_sha256,
    result.snapshot_sha256,
  );
});

test("manifest cannot silently export missing provenance", () => {
  assert.throws(
    () => evidenceManifest(source, account, [{ ...row, source_rows: null }]),
    /provenance/,
  );
});

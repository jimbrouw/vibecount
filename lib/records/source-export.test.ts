import assert from "node:assert/strict";
import test from "node:test";
import { evidenceLedger, type SourceExportRow } from "./source-export.ts";

test("evidence exports preserve exclusions and exact source-linked amounts without inflating totals", () => {
  const base: SourceExportRow = {
    id: "tx1",
    transaction_date: "2026-02-01",
    signed_amount_pence: -63029,
    currency: "GBP",
    description: "=formula",
    reference: "",
    classification: "Mixed",
    business_use_bps: 3000,
    dedupe_status: "clear",
    decision_version: 1,
    source_row_id: "row1",
    tax_year_start: 2025,
    source_rows: { row_number: 2, row_hash: "rowhash" },
    record: { id: "record1", amount: "189.09", status: "approved" },
  };
  const result = evidenceLedger(
    {
      id: "import1",
      file_hash: "filehash",
      parser_version: "v1",
      account_label: "Bank",
      account_mask: "1234",
    },
    [
      base,
      {
        ...base,
        id: "tx2",
        classification: "Personal",
        record: { id: "record2", amount: "463.09", status: "excluded" },
      },
    ],
  );
  assert.equal(result.expensePence, 18909);
  assert.equal(result.incomePence, 0);
  assert.ok(result.csv.includes("filehash"));
  assert.ok(result.csv.includes("rowhash"));
  assert.ok(result.csv.includes("Personal"));
  assert.ok(result.csv.includes("'-formula") === false);
  assert.ok(result.csv.includes("'=formula"));
  assert.ok(result.csv.includes("-63029"));
  assert.ok(result.csv.includes("Draft — not submitted to HMRC"));
  assert.throws(
    () =>
      evidenceLedger(
        {
          id: "x",
          file_hash: "h",
          parser_version: "v",
          account_label: "b",
          account_mask: "1",
        },
        [{ ...base, source_rows: null }],
      ),
    /provenance/,
  );
});

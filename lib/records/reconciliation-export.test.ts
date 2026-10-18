import assert from "node:assert/strict";
import test from "node:test";
import {
  reconciliationExport,
  type SettlementExportRow,
} from "./reconciliation-export.ts";
import {
  readConsistentReconciliation,
  readFinancialStamp,
} from "./consistent-reconciliation.ts";
import { readSourceCsv } from "./source-csv.ts";

const event: SettlementExportRow = {
  id: "allocation",
  invoice_id: "invoice",
  transaction_id: "tx",
  amount_pence: 150000,
  event_kind: "allocation",
  reverses_id: null,
  request_id: "request",
  author: "owner",
  rationale: "=unsafe formula",
  created_at: "2026-10-17",
  invoice_snapshot: {
    number: "INV-1500",
    gross_pence: 150000,
    currency: "GBP",
  },
  transaction: {
    id: "tx",
    transaction_date: "2026-02-01",
    source_row_id: "row",
    source_rows: { row_number: 2, row_hash: "row-hash" },
    record_imports: { file_hash: "file-hash", parser_version: "mapped-csv/1" },
  },
};
test("reconciliation export separates events and current balances while preserving source evidence and reversals", () => {
  const result = reconciliationExport(
    [
      event,
      {
        ...event,
        id: "reversal",
        event_kind: "reversal",
        reverses_id: event.id,
      },
    ],
    [
      {
        id: "tx",
        import_id: "import",
        transaction_date: "2026-02-01",
        signed_amount_pence: 150000,
        allocated_pence: 0,
        unallocated_pence: 150000,
        classification: "Business",
        record_status: "approved",
        source_row_id: "row",
        source_rows: { row_number: 2, row_hash: "row-hash" },
        record_imports: { file_hash: "file-hash" },
      },
    ],
    [
      {
        id: "invoice",
        number: "INV-1500",
        invoice_pence: 150000,
        allocated_pence: 0,
        outstanding_pence: 150000,
        delivery_status: "not_sent",
      },
    ],
  );
  const csv = readSourceCsv(result.csv);
  assert.equal(result.count, 4);
  assert.equal(csv.length, 5);
  assert.ok(csv.every((row) => row.length === csv[0].length));
  assert.equal(csv[1][13], "row-hash");
  assert.equal(csv[1][14], "file-hash");
  assert.equal(csv[1][18], "'=unsafe formula");
  assert.equal(csv[2][7], "allocation");
  assert.equal(csv[3][1], "receipt_balance");
  assert.equal(csv[3][14], "file-hash");
  assert.equal(csv[4][1], "invoice_balance");
  assert.throws(
    () => reconciliationExport([{ ...event, transaction: null }], [], []),
    /evidence/,
  );
});
test("exports reject changes or unavailable stamps rather than emit mixed financial states", async () => {
  assert.deepEqual(
    await readConsistentReconciliation(
      async () => "same",
      async () => ["complete"],
    ),
    ["complete"],
  );
  let calls = 0;
  await assert.rejects(
    readConsistentReconciliation(
      async () => String(calls++),
      async () => ["inconsistent"],
    ),
    /changed/,
  );
  await assert.rejects(
    readConsistentReconciliation(
      async () => {
        throw new Error("stamp unavailable");
      },
      async () => ["inconsistent"],
    ),
    /unavailable/,
  );
  assert.equal(
    await readFinancialStamp(async () => ({ data: "snapshot", error: null })),
    "snapshot",
  );
  await assert.rejects(
    readFinancialStamp(async () => ({ data: null, error: null })),
    /snapshot/,
  );
  await assert.rejects(
    readFinancialStamp(async () => ({
      data: "snapshot",
      error: new Error("failed"),
    })),
    /snapshot/,
  );
});

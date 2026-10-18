import assert from "node:assert/strict";
import test from "node:test";
import { reconciliationExport } from "./reconciliation-export.ts";
import type { TransferExportPair } from "./transfer-export.ts";
import { readSourceCsv } from "./source-csv.ts";
const pair: TransferExportPair = {
  id: "pair",
  kind: "card_repayment",
  amount_pence: 30000,
  author: "owner",
  rationale: "=formula",
  request_id: "request",
  created_at: "2026-10-17",
  outgoing: {
    id: "out",
    source_row_id: "out-row",
    source_rows: { row_number: 2, row_hash: "out-hash" },
    record_imports: { file_hash: "out-file" },
    financial_accounts: { label: "Bank", masked_identifier: "1234" },
  },
  incoming: {
    id: "in",
    source_row_id: "in-row",
    source_rows: { row_number: 3, row_hash: "in-hash" },
    record_imports: { file_hash: "in-file" },
    financial_accounts: { label: "Card", masked_identifier: "5678" },
  },
};
test("reconciliation exports preserve both transfer source chains, reversal history and formula protection", () => {
  const result = reconciliationExport(
    [],
    [],
    [],
    [pair],
    [
      {
        id: "reversal",
        pair_id: pair.id,
        author: "owner",
        rationale: "Review correction",
        request_id: "reverse-request",
        created_at: "2026-10-18",
      },
    ],
  );
  const rows = readSourceCsv(result.csv);
  assert.equal(result.count, 2);
  assert.ok(rows.every((r) => r.length === rows[0].length));
  assert.equal(rows[1][1], "transfer_event");
  assert.equal(rows[1][14], "out-file");
  assert.equal(rows[1][21], "in");
  assert.equal(rows[1][25], "in-file");
  assert.equal(rows[1][26], "card_repayment");
  assert.equal(rows[1][18], "'=formula");
  assert.equal(rows[2][7], "pair");
  assert.match(rows[2][16], /Unknown/);
  assert.throws(
    () => reconciliationExport([], [], [], [{ ...pair, incoming: null }], []),
    /provenance/,
  );
});

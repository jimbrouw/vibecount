import assert from "node:assert/strict";
import test from "node:test";
import { parseBankStatementText } from "./bank-statement.ts";
import { parseRecordsCsv, type CsvCategory } from "./csv.ts";

const categories: CsvCategory[] = [
  { id: "income-category", name: "Sales and fees", record_type: "income" },
  { id: "expense-category", name: "Office costs", record_type: "expense" },
];

test("parses CSV files with common bank export headers", () => {
  const csv = [
    "Transaction Date,Details,Paid In,Paid Out",
    "29/05/2026,Client work,750.00,",
    "30/05/2026,Software,,12.50",
  ].join("\n");

  const parsed = parseRecordsCsv(csv, categories);

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].recordType, "income");
  assert.equal(parsed.rows[0].description, "Client work");
  assert.equal(parsed.rows[0].amountPence, 75_000);
  assert.equal(parsed.rows[0].categoryId, "income-category");
  assert.equal(parsed.rows[1].recordType, "expense");
  assert.equal(parsed.rows[1].amountPence, 1_250);
});

test("parses text-readable statement lines with month-name dates", () => {
  const rows = parseBankStatementText(
    ["29 May 2026 CLIENT PAYMENT 750.00", "30 May 2026 CARD SOFTWARE -12.50"].join("\n"),
    categories
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].recordDate, "2026-05-29");
  assert.equal(rows[0].recordType, "income");
  assert.equal(rows[0].amountPence, 75_000);
  assert.equal(rows[1].recordType, "expense");
  assert.equal(rows[1].amountPence, 1_250);
});

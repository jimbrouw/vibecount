import assert from "node:assert/strict";
import test from "node:test";
import { readTaxPrepData, type TaxPrepRecord } from "./tax-prep-data.ts";
import { buildSelfAssessmentChecklist } from "./self-assessment.ts";

test("tax prep includes records and years beyond a short server page cap", async () => {
  const records: TaxPrepRecord[] = Array.from({ length: 1203 }, (_, i) => ({
    id: String(i).padStart(8, "0"),
    record_type: i === 1202 ? "expense" : "income",
    amount: i === 1202 ? "2.39" : "1.01",
    record_categories: null,
  }));
  const years = records.map((row, i) => ({
    id: row.id,
    tax_year_start: i === 1202 ? 2024 : 2025,
  }));
  const result = await readTaxPrepData(
    async (after) => ({
      data: records.filter((r) => after === null || r.id > after).slice(0, 173),
      error: null,
    }),
    async (after) => ({
      data: years.filter((r) => after === null || r.id > after).slice(0, 173),
      error: null,
    }),
  );
  assert.equal(result.status, "ready");
  if (result.status !== "ready") throw new Error("Expected complete data");
  const checklist = buildSelfAssessmentChecklist(result.records);
  assert.equal(checklist.incomeCount, 1202);
  assert.equal(checklist.incomeTotal, 121402);
  assert.equal(checklist.expenseTotal, 239);
  assert.equal(checklist.profitTotal, 121163);
  assert.deepEqual(
    new Set(result.years.map((r) => r.tax_year_start)),
    new Set([2024, 2025]),
  );
});

test("tax prep returns unavailable on any failed or stalled page, preserving the distinction from empty records", async () => {
  const row: TaxPrepRecord = {
    id: "a",
    amount: "100.00",
    record_type: "income",
    record_categories: null,
  };
  const empty = async () => ({ data: [], error: null });
  const failure = async () => ({
    data: null,
    error: new Error("private database detail"),
  });
  assert.deepEqual(
    await readTaxPrepData(
      async (after) => (after ? failure() : { data: [row], error: null }),
      empty,
    ),
    { status: "unavailable" },
  );
  assert.deepEqual(await readTaxPrepData(empty, failure), {
    status: "unavailable",
  });
  assert.deepEqual(
    await readTaxPrepData(async () => ({ data: [row], error: null }), empty),
    { status: "unavailable" },
  );
  assert.deepEqual(await readTaxPrepData(empty, empty), {
    status: "ready",
    records: [],
    years: [],
  });
});

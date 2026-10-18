import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  normalizeSourceCsv,
  readSourceCsv,
  suggestMapping,
} from "./source-csv.ts";
import { apportionPence } from "../money.ts";

test("the committed anonymised demo fixture parses and preserves repeated purchases", async () => {
  const text = await readFile(new URL("../../fixtures/synthetic-starling.csv", import.meta.url), "utf8");
  const table = readSourceCsv(text);
  const rows = normalizeSourceCsv(table, suggestMapping(table[0], "starling"));
  assert.equal(rows.length, 8);
  assert.equal(rows.filter((r) => r.description === "Software vendor").length, 2);
  assert.equal(apportionPence(Math.abs(rows.find((r) => r.description === "Vehicle repair")!.signedPence), 3000), 18909);
});

// Synthetic format fixtures: bank-specific certification requires an anonymised real export.
const sample =
  'Date,Counter Party,Reference,Amount (GBP),Balance (GBP)\r\n05/04/2026,Studio,Inv 12,1500.00,2000.00\r\n06/04/2026,Software,,"-1,250.29",749.71';
test("Starling-style mapping uses transaction amount rather than running balance, preserves sign and dates", () => {
  const table = readSourceCsv(sample);
  const mapping = suggestMapping(table[0], "starling");
  const rows = normalizeSourceCsv(table, mapping);
  assert.deepEqual(
    rows.map((r) => [r.date, r.signedPence]),
    [
      ["2026-04-05", 150000],
      ["2026-04-06", -125029],
    ],
  );
  assert.equal(rows[0].rowNumber, 2);
  assert.deepEqual(rows[1].rawCells, [
    "06/04/2026",
    "Software",
    "",
    "-1,250.29",
    "749.71",
  ]);
});
test("CSV rejects malformed quotes, row width and duplicate headers but retains quoted newlines and whitespace", () => {
  for (const text of [
    "Date,Date\na,b",
    'a,b\n"unclosed,x',
    'a,b\n"x"oops,y',
    "a,b\nx,y,z",
    'a,b\nx"y,z',
  ])
    assert.throws(() => readSourceCsv(text));
  assert.deepEqual(readSourceCsv('a,b\n" first\nsecond ","a""b"'), [
    ["a", "b"],
    [" first\nsecond ", 'a"b'],
  ]);
});
test("currency, sign, precision and invalid calendar dates hard-stop", () => {
  const head = "Date,Description,Amount,Currency\n";
  for (const row of [
    "31/02/2026,Item,10,GBP",
    "01/02/2026,Item,1.005,GBP",
    "01/02/2026,Item,1.00,EUR",
    "01/02/2026,Item,0,GBP",
    "01/02/2026,Item,1e3,GBP",
    "01/02/2026,Item,10000000000.00,GBP",
  ]) {
    const t = readSourceCsv(head + row);
    assert.throws(() => normalizeSourceCsv(t, suggestMapping(t[0], "generic")));
  }
});
test("debit-credit and Amex sign mappings remain explicit and refunds/repayments are observations", () => {
  const t = readSourceCsv(
    "Date,Description,Paid Out,Paid In\n01/02/2026,Purchase,12.50,0\n02/02/2026,Receipt,0,100.00",
  );
  assert.deepEqual(
    normalizeSourceCsv(t, suggestMapping(t[0], "nationwide")).map(
      (r) => r.signedPence,
    ),
    [-1250, 10000],
  );
  t[1][3] = "5";
  assert.throws(
    () => normalizeSourceCsv(t, suggestMapping(t[0], "nationwide")),
    /only one/,
  );
  const card = readSourceCsv(
    "Date,Description,Amount\n01/02/2026,Card purchase,12.50\n02/02/2026,Card repayment,-100.00",
  );
  assert.deepEqual(
    normalizeSourceCsv(card, suggestMapping(card[0], "amex")).map(
      (r) => r.signedPence,
    ),
    [-1250, 10000],
  );
});
test("browser descriptions redact bank identifiers while original cells remain unchanged", () => {
  const t = readSourceCsv(
    "Date,Description,Amount\n01/02/2026,Account 12345678 sort 12-34-56,1.00",
  );
  const row = normalizeSourceCsv(t, suggestMapping(t[0], "starling"))[0];
  assert.ok(!row.description.includes("12345678"));
  assert.ok(!row.description.includes("12-34-56"));
  assert.ok(row.rawCells[1].includes("12345678"));
});
test("business-use apportionment is exact and uses a defined penny rounding rule", () => {
  assert.equal(apportionPence(63029, 3000), 18909);
  assert.equal(apportionPence(1, 5000), 1);
  assert.equal(apportionPence(-1, 5000), -1);
  assert.throws(() => apportionPence(10, 10001));
});


test("reviewed expenses use Outflow_GBP as money out without approving spreadsheet claims", () => {
  const table = readSourceCsv("Account,Date,Description,Outflow_GBP,Claim_status\nStarling,2026-04-01,Synthetic expense,12.50,Claim\nStarling,2026-04-02,Synthetic refund,-2.50,Claim");
  const mapping = suggestMapping(table[0], "generic");
  assert.equal(mapping.amount, 3);
  assert.equal(mapping.amountMode, "card_charges");
  mapping.dateFormat = "iso";
  const rows = normalizeSourceCsv(table, mapping);
  assert.deepEqual(rows.map((row) => row.signedPence), [-1250, 250]);
  assert.equal(rows[0].date, "2026-04-01");
  assert.equal(rows[0].rawCells[4], "Claim");
  assert.equal("classification" in rows[0], false);
});

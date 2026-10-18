import assert from "node:assert/strict";
import test from "node:test";
import { escapeCsv } from "./export-csv.ts";

test("spreadsheet formulas are neutralised even behind whitespace and control characters", () => {
  for (const value of ["=1+1", "+SUM(1)", "-1+2", "@SUM(1)", "  =1", "\t=1", "\u0000=1"]) {
    assert.equal(escapeCsv(value), `'${value}`);
  }
  assert.equal(escapeCsv("\r=1"), '"\'\r=1"');
  assert.equal(escapeCsv("\ntext"), '"\'\ntext"');
});

test("CSV syntax escapes independently of formula protection and ordinary fields survive", () => {
  assert.equal(escapeCsv('Studio, "A"'), '"Studio, ""A"""');
  assert.equal(escapeCsv("ordinary\ntext"), '"ordinary\ntext"');
  assert.equal(escapeCsv("123.45"), "123.45");
  assert.equal(escapeCsv("2025-04-06"), "2025-04-06");
  assert.equal(escapeCsv("-1250"), "-1250");
});

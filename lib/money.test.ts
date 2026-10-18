import assert from "node:assert/strict";
import test from "node:test";
import { decimalToPence, requirePence, sumPence } from "./money.ts";

test("decimal conversion preserves exact signed pence and rejects ambiguity", () => {
  assert.equal(decimalToPence("14,033.52"), null);
  assert.equal(decimalToPence("14033.52"), 1403352);
  assert.equal(decimalToPence("0.29"), 29);
  assert.equal(decimalToPence("-630.29"), -63029);
  assert.equal(decimalToPence("0001.2"), 120);
  for (const input of ["1.005", "1e3", "NaN", "", "£1", "1-2", "+1"]) {
    assert.equal(decimalToPence(input), null);
  }
});

test("money conversion and aggregation stop rather than silently lose precision", () => {
  assert.equal(decimalToPence("90071992547409.91"), Number.MAX_SAFE_INTEGER);
  assert.equal(decimalToPence("90071992547409.92"), null);
  assert.equal(decimalToPence("-90071992547409.92"), null);
  assert.throws(() => requirePence("bad"));
  assert.equal(sumPence([requirePence("0.1"), requirePence("0.2")]), 30);
  assert.throws(() => sumPence([Number.MAX_SAFE_INTEGER, 1]));
  assert.throws(() => sumPence([1.1]));
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  allocationReview,
  minorPence,
  type ReceiptBalance,
  type InvoiceBalance,
} from "./allocations.ts";
const receipt: ReceiptBalance = {
  id: "tx",
  signed_amount_pence: 150000,
  allocated_pence: 0,
  unallocated_pence: 150000,
  decision_version: 1,
  classification: "Business",
  business_use_bps: 10000,
  dedupe_status: "clear",
  record_status: "approved",
  recognized_pence: 150000,
  currency: "GBP",
};
const invoices: InvoiceBalance[] = [
  {
    id: "a",
    number: "A",
    invoice_pence: 100000,
    allocated_pence: 0,
    outstanding_pence: 100000,
    updated_at: "2026-01-01T00:00:00Z",
    currency: "GBP",
    status: "finalised",
  },
  {
    id: "b",
    number: "B",
    invoice_pence: 100000,
    allocated_pence: 0,
    outstanding_pence: 100000,
    updated_at: "2026-01-01T00:00:00Z",
    currency: "GBP",
    status: "finalised",
  },
];
test("allocation read-back uses exact gross balances and exposes remaining amounts", () => {
  const result = allocationReview(receipt, invoices, {
    a: "1000",
    b: "275.25",
  });
  assert.equal(result.total, 127525);
  assert.equal(result.remaining, 22475);
  assert.equal(result.rows[1].remaining_pence, 72475);
  assert.equal(result.rows[0].invoice_updated_at, invoices[0].updated_at);
});
test("unreviewed receipts, excess/ambiguous amounts and unowned invoices stop allocation preview", () => {
  for (const value of ["1000.001", "-1", "£100", "1,000", "0"])
    assert.throws(() => allocationReview(receipt, invoices, { a: value }));
  assert.throws(
    () => allocationReview(receipt, invoices, { a: "1000", b: "500.01" }),
    /unallocated/,
  );
  assert.throws(
    () => allocationReview(receipt, invoices, { foreign: "1" }),
    /finalised/,
  );
  assert.throws(
    () =>
      allocationReview({ ...receipt, classification: "Unknown" }, invoices, {
        a: "1",
      }),
    /complete receipt/,
  );
  assert.throws(() => minorPence("1.5"));
  assert.throws(() => minorPence("9007199254740992"));
});

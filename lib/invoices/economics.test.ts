import assert from "node:assert/strict";
import test from "node:test";
import {
  invoiceEconomics,
  invoiceEditAmounts,
  MAX_INVOICE_PENCE,
} from "./economics.ts";

test("saved invoice net/VAT/gross survives edits without adding VAT to gross", () => {
  const original = invoiceEconomics(10000, true, "20", "GB-SYNTHETIC");
  assert.equal(original.totalPence, 12000);
  const edit = invoiceEditAmounts({
    origin:"native_gbp",currency:"GBP",
    amount: "120.00",
    net_pence: "10000",
    vat_pence: "2000",
    vat_rate_bps: 2000,
    vat_enabled: true,
    vat_number_snapshot: "GB-SYNTHETIC",
  });
  assert.equal(edit.amount, "100.00");
  assert.equal(edit.vatRate, "20");
  assert.deepEqual(
    invoiceEconomics(10000, edit.vatEnabled, edit.vatRate, edit.vatNumber),
    original,
  );
  assert.equal(invoiceEconomics(1, true, "50", "GB-SYNTHETIC").vatPence, 1);
});

test("legacy invoice total does not imply a net amount or VAT treatment", () => {
  assert.deepEqual(
    invoiceEditAmounts({
    origin:"native_gbp",currency:"GBP",
      amount: "120.00",
      net_pence: null,
      vat_pence: null,
      vat_rate_bps: null,
      vat_enabled: null,
      vat_number_snapshot: null,
    }),
    {
      amount: "",
      legacyGrossPence: 12000,
      vatEnabled: false,
      vatRate: "",
      vatNumber: "",
    },
  );
});

test("invoice economics reject arbitrary tax amounts, rates, overflow and inconsistent saved facts", () => {
  for (const net of [0, -1, 1.5, NaN, Infinity, MAX_INVOICE_PENCE + 1])
    assert.throws(() => invoiceEconomics(net, false, 0, ""));
  for (const rate of [-1, 100.01, "20.001", NaN, Infinity, null])
    assert.throws(() => invoiceEconomics(10000, true, rate, "GB-SYNTHETIC"));
  assert.throws(() => invoiceEconomics(10000, true, 20, ""));
  assert.throws(() =>
    invoiceEconomics(MAX_INVOICE_PENCE, true, 20, "GB-SYNTHETIC"),
  );
  assert.throws(() =>
    invoiceEditAmounts({
    origin:"native_gbp",currency:"GBP",
      amount: "144.00",
      net_pence: 10000,
      vat_pence: 2000,
      vat_rate_bps: 2000,
      vat_enabled: true,
      vat_number_snapshot: "GB-SYNTHETIC",
    }),
  );
});

test("unfinalised drafts review their candidate net with current explicit VAT defaults", () => {
  const edit = invoiceEditAmounts({
    origin:"native_gbp",currency:"GBP",
    amount: "100.00",
    status: "draft",
    finalised_at: null,
    net_pence: null,
    vat_pence: null,
    vat_rate_bps: null,
    vat_enabled: null,
    vat_number_snapshot: null,
  });
  assert.equal(edit.amount, "100.00");
  assert.equal(edit.legacyGrossPence, undefined);
  assert.equal(edit.vatEnabled, undefined);
  assert.equal(
    invoiceEconomics(10000, true, "20", "GB-SYNTHETIC").totalPence,
    12000,
  );
});

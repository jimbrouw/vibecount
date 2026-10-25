import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCashBuckets,
  evaluateWhatIf,
} from "./cash-buckets.ts";

test("calculateCashBuckets computes 3 buckets and runway correctly", () => {
  const result = calculateCashBuckets({
    actualCashPence: 600000, // £6,000
    liabilitiesPence: 50000, // £500 debt
    actualTaxReservePence: 100000, // £1,000 in tax pot
    requiredTaxProtectionPence: 150000, // £1,500 tax needed
    currentFreeCashPence: 400000, // £4,000 safe to spend
    monthlyCostsPence: 40000, // £400 costs
    monthlyDrawingsPence: 100000, // £1,000 drawings
    unpaidInvoicesPence: 120000, // £1,200 invoices
  });

  assert.equal(result.totalCashPence, 600000);
  assert.equal(result.safeToSpendPence, 400000);
  assert.equal(result.taxProtectionPence, 200000); // 1500 + 500 debt
  assert.equal(result.unpaidInvoicesPence, 120000);
  assert.equal(result.monthlyBurnPence, 140000); // £1,400 / month
  // 400000 / 140000 = 2.857 -> 2.9 months
  assert.equal(result.runwayMonths, 2.9);
  assert.equal(result.runwayStatus, "stable");
  assert.equal(result.taxNudgePence, 50000); // Need 1500, have 1000 -> move 500
});

test("evaluateWhatIf calculates sandbox impact without touching base data", () => {
  const result = evaluateWhatIf({
    baseSafePence: 400000, // £4,000 safe
    baseTaxPence: 200000, // £2,000 tax/debt
    baseMonthlyBurnPence: 100000, // £1,000 / month
    drawingsAdjustmentPence: 100000, // Take £1,000 personal drawings
    equipmentPurchasePence: 50000, // Buy £500 camera
    incomingInvoicePaidPence: 100000, // Receive £1,000 invoice (20% to tax = £200, net safe = £800)
    taxReserveRatioBps: 2000,
  });

  // Safe spend = 4000 + 800 - 1000 - 500 = 3300 (£3,300)
  assert.equal(result.newSafeToSpendPence, 330000);
  // Tax protection = 2000 + 200 = 2200 (£2,200)
  assert.equal(result.newTaxProtectionPence, 220000);
  // 330000 / 100000 = 3.3 months
  assert.equal(result.newRunwayMonths, 3.3);
  assert.equal(result.isSafe, true);
});

test("evaluateWhatIf warns when a decision dips into tax or debt buffer", () => {
  const result = evaluateWhatIf({
    baseSafePence: 50000, // £500 safe
    baseTaxPence: 150000,
    baseMonthlyBurnPence: 100000,
    drawingsAdjustmentPence: 100000, // Taking £1,000 with only £500 safe
    equipmentPurchasePence: 0,
    incomingInvoicePaidPence: 0,
  });

  assert.equal(result.newSafeToSpendPence, -50000); // £500 deficit
  assert.equal(result.isSafe, false);
  assert.match(result.message, /dip £500\.00 into your protected tax or debt money/);
});

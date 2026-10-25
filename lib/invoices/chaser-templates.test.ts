import assert from "node:assert/strict";
import test from "node:test";
import { generateChaserCopy } from "./chaser-templates.ts";

const sampleParams = {
  invoiceNumber: "INV-042",
  clientName: "Simon",
  amountPence: 85000, // £850.00
  dueDate: "2025-10-15",
  daysOverdue: 7,
  lateFeePence: 4000, // £40.00
  senderName: "Jim",
  paymentLinkUrl: "https://stripe.com/pay/123",
  pdfShareUrl: "https://vibecount.com/invoices/inv-042.pdf",
};

test("generateChaserCopy generates gentle tone without aggressive language", () => {
  const result = generateChaserCopy("gentle", sampleParams);
  assert.equal(result.subject, "Quick check-in: Invoice INV-042 (£850.00)");
  assert.match(result.body, /Hope you're having a great week!/);
  assert.match(result.body, /friendly check-in on invoice INV-042 for £850\.00/);
  assert.doesNotMatch(result.body, /statutory compensation/i);
});

test("generateChaserCopy generates firm tone with statutory interest", () => {
  const result = generateChaserCopy("firm", sampleParams);
  assert.equal(result.subject, "OVERDUE: Invoice INV-042 — £850.00");
  assert.match(result.body, /Under UK Late Payment legislation/);
  assert.match(result.body, /fee and interest of £40\.00 has been applied/);
  assert.match(result.body, /making the revised total due £890\.00/);
});

test("generateChaserCopy generates standard professional tone", () => {
  const result = generateChaserCopy("standard", sampleParams);
  assert.equal(result.subject, "Overdue: Invoice INV-042 — £850.00");
  assert.match(result.body, /Following up on invoice INV-042 for £850\.00/);
  assert.match(result.body, /is now 7 days overdue/);
});

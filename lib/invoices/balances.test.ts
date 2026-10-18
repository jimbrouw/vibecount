import assert from "node:assert/strict";
import test from "node:test";
import {
  summariseInvoiceBalances,
  type InvoiceBalanceRow,
} from "./balances.ts";
import { reminderMatchesBalance } from "./reminders.ts";
const base: InvoiceBalanceRow = {
  id: "invoice",
  status: "finalised",
  currency: "GBP",
  updated_at: "2026-04-06T12:00:00+00:00",
  invoice_pence: 100000,
  allocated_pence: 25000,
  credited_pence: 0,
  outstanding_pence: 75000,
  refund_due_pence: 0,
  settlement_state: "part_paid",
  has_reconciliation_history: true,
  paid_at: null,
  delivery_status: "sent",
};
test("dashboard totals count partial evidence separately from manual paid assertions and drafts", () => {
  const result = summariseInvoiceBalances([
    base,
    {
      ...base,
      id: "manual",
      has_reconciliation_history: false,
      paid_at: "2026-04-06",
      allocated_pence: 0,
      outstanding_pence: 100000,
    },
    {
      ...base,
      id: "credited",
      invoice_pence: 12000,
      allocated_pence: 12000,
      credited_pence: 3000,
      outstanding_pence: 0,
      refund_due_pence: 3000,
    },
    { ...base, id: "draft", status: "draft", invoice_pence: 90000000 },
  ]);
  assert.deepEqual(result, {
    invoiced: 212000,
    receipts: 37000,
    returned: 0,
    retained: 37000,
    credited: 3000,
    outstanding: 175000,
    cashToReconcile: 3000,
    manualPaidAssertions: 1,
  });
  assert.throws(
    () => summariseInvoiceBalances([{ ...base, currency: "USD" }]),
    /Separate currency/,
  );
  assert.throws(
    () => summariseInvoiceBalances([{ ...base, allocated_pence: -1 }]),
    /Invalid/,
  );
});
test("reminders reject legacy, stale, changed, zero and unavailable balances", () => {
  const draft = {
    balance_updated_at: base.updated_at,
    amount_due_pence: 75000,
  };
  assert.equal(reminderMatchesBalance(draft, base), true);
  assert.equal(
    reminderMatchesBalance({ ...draft, balance_updated_at: null }, base),
    false,
  );
  assert.equal(
    reminderMatchesBalance(draft, { ...base, updated_at: "changed" }),
    false,
  );
  assert.equal(
    reminderMatchesBalance(draft, { ...base, outstanding_pence: 70000 }),
    false,
  );
  assert.equal(
    reminderMatchesBalance(
      { ...draft, amount_due_pence: 0 },
      { ...base, outstanding_pence: 0 },
    ),
    false,
  );
  assert.equal(reminderMatchesBalance(draft, null), false);
});

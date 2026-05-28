import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInvoiceEmailDraft,
  buildReminderEmail,
  firstReminderAt,
  inferDueDate,
  nextReminderAtFrom,
  parseReminderSchedule,
} from "./reminders.ts";

test("infers due date from invoice date and payment terms", () => {
  assert.equal(inferDueDate("2026-05-28", "Payment due within 14 days"), "2026-06-11");
  assert.equal(inferDueDate("2026-05-28", "Payment due within 30 days"), "2026-06-27");
});

test("uses the later of due date plus three days or today for first reminder", () => {
  assert.equal(
    firstReminderAt("2026-05-28", new Date("2026-05-20T10:00:00.000Z")),
    "2026-05-31T00:00:00.000Z"
  );
  assert.equal(
    firstReminderAt("2026-05-01", new Date("2026-05-28T10:00:00.000Z")),
    "2026-05-28T00:00:00.000Z"
  );
});

test("calculates next reminder seven days from send time", () => {
  assert.equal(
    nextReminderAtFrom(new Date("2026-05-28T09:00:00.000Z")),
    "2026-06-04T09:00:00.000Z"
  );
  assert.equal(
    nextReminderAtFrom(new Date("2026-05-28T09:00:00.000Z"), 3),
    "2026-05-31T09:00:00.000Z"
  );
});

test("falls back to default reminder schedule for invalid values", () => {
  assert.deepEqual(parseReminderSchedule({ maxReminders: 5, repeatEveryDays: 0 }), {
    firstReminderDaysAfterDue: 3,
    repeatEveryDays: 7,
    maxReminders: 5,
  });
});

test("builds deterministic invoice and reminder copy", () => {
  const draft = buildInvoiceEmailDraft({
    invoiceNumber: "VC-2026-0001",
    clientName: "Simon",
    amountPence: 85000,
    dueDate: "2026-06-27",
    paymentTerms: "Payment due within 30 days",
    paymentLinkUrl: "https://pay.example.com/vc-1",
    senderName: "Alex Freelancer",
  });

  assert.match(draft.subject, /VC-2026-0001/);
  assert.match(draft.body, /£850.00/);
  assert.match(draft.body, /https:\/\/pay\.example\.com\/vc-1/);

  const reminder = buildReminderEmail({
    invoice: {
      number: "VC-2026-0001",
      amountPence: 85000,
      invoiceDate: "2026-05-28",
      dueDate: "2026-06-27",
      paymentTerms: "Payment due within 30 days",
      paymentLinkUrl: "https://pay.example.com/vc-1",
    },
    client: { name: "Simon", email: "simon@example.com" },
    sender: { name: "Alex Freelancer", email: "invoices@example.com" },
    reminderCount: 1,
  });

  assert.match(reminder.subject, /Payment reminder/);
  assert.match(reminder.text, /Please ignore this message if payment has already been made/);
});

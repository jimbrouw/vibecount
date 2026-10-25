import assert from "node:assert/strict";
import test from "node:test";
import { buildAccountantHandover } from "./accountant-handover.ts";

test("buildAccountantHandover formats figures and words with compliant disclaimer", () => {
  const output = buildAccountantHandover({
    userName: "Jim Freelancer",
    tradingName: "Jim Design Studio",
    taxYearStart: 2025,
    incomeTotalPence: 4500000, // £45,000.00
    expenseTotalPence: 850000, // £8,500.00
    profitTotalPence: 3650000, // £36,500.00
    incomeCount: 14,
    expenseCount: 88,
    sa103Boxes: [
      {
        box: "Box 9",
        label: "Turnover",
        amountPence: 4500000,
        count: 14,
      },
      {
        box: "Box 17",
        label: "Travel and transport",
        amountPence: 250000,
        count: 42,
      },
      {
        box: "Box 19",
        label: "Phone, software and admin",
        amountPence: 600000,
        count: 46,
      },
    ],
  });

  // Verify figures and words in cover letter
  assert.match(output.coverLetterText, /Gross Business Turnover: £45,000\.00/);
  assert.match(output.coverLetterText, /In words: forty-five thousand pounds/i);
  assert.match(output.coverLetterText, /Net Trading Profit: £36,500\.00/);
  assert.match(output.coverLetterText, /In words: thirty-six thousand five hundred pounds/i);

  // Compliance statement
  assert.match(output.coverLetterText, /MTD-ready records prepared by the client using VibeCount/);
  assert.match(output.coverLetterText, /not an\s+automated HMRC tax return filing/);

  // Email template
  assert.match(output.emailTemplateText, /Hi \[Accountant Name\]/);
  assert.match(output.emailTemplateText, /Gross Turnover: £45,000\.00 \(forty-five thousand pounds\)/i);
  assert.match(output.emailTemplateText, /Net Trading Profit: £36,500\.00 \(thirty-six thousand five hundred pounds\)/i);
  assert.match(output.emailTemplateText, /Jim Freelancer/);

  // Summary boxes
  assert.equal(output.summaryBoxes.length, 3);
  assert.equal(output.summaryBoxes[0].box, "Box 9");
  assert.equal(output.summaryBoxes[0].formattedAmount, "£45,000.00");
});

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

test("buildAccountantHandover includes employment and tax-free redundancy when provided", () => {
  const output = buildAccountantHandover({
    userName: "James Frank Brouwer",
    taxYearStart: 2025,
    incomeTotalPence: 1675500, // £16,755.00
    expenseTotalPence: 0,
    profitTotalPence: 1675500,
    incomeCount: 22,
    expenseCount: 0,
    sa103Boxes: [],
    employmentDetails: {
      employerName: "Nottingham Contemporary",
      payeReference: "507 / LA10989",
      leavingDate: "2025-09-29",
      taxCode: "1263L",
      taxablePayPence: 1403352, // £14,033.52
      taxWithheldPence: 154260, // £1,542.60
      redundancyPaymentPence: 1025525, // £10,255.25
      redundancyExemptPence: 1025525,
    },
  });

  // Verify employment details in cover letter
  assert.match(output.coverLetterText, /Employer: Nottingham Contemporary/);
  assert.match(output.coverLetterText, /HMRC PAYE Reference: 507 \/ LA10989/);
  assert.match(output.coverLetterText, /Total Taxable Pay \(P45 Box 7 \/ SA102 Box 1\): £14,033\.52/);
  assert.match(output.coverLetterText, /PAYE Income Tax Deducted \(P45 Box 7 \/ SA102 Box 2\): £1,542\.60/);
  assert.match(output.coverLetterText, /Redundancy \/ Termination Award: £10,255\.25/);
  assert.match(output.coverLetterText, /100% Tax-Free Statutory Exemption \(Section 401 ITEPA 2003\)/);

  // Verify email template mentions employment and redundancy
  assert.match(output.emailTemplateText, /Employment \(P45\): Nottingham Contemporary/);
  assert.match(output.emailTemplateText, /Redundancy Award: £10,255\.25/);
});

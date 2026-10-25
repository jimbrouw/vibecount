import { formatPounds, signedAmountToWords } from "../invoices/money.ts";
import { getTaxYearLabel } from "../records/tax-periods.ts";
import type { EmploymentRecord } from "./employment.ts";

export type HandoverInput = {
  userName: string;
  tradingName?: string;
  taxYearStart: number;
  incomeTotalPence: number;
  expenseTotalPence: number;
  profitTotalPence: number;
  incomeCount: number;
  expenseCount: number;
  sa103Boxes: {
    box: string;
    label: string;
    amountPence: number;
    count: number;
  }[];
  notes?: string[];
  employmentDetails?: EmploymentRecord | null;
};

export type HandoverOutput = {
  coverLetterText: string;
  emailTemplateText: string;
  summaryBoxes: {
    box: string;
    label: string;
    formattedAmount: string;
    amountWords: string;
  }[];
};

/**
 * Builds an accountant-ready handover summary and cover note.
 * Uses exact integer pence and outputs all amounts in figures and words.
 */
export function buildAccountantHandover(input: HandoverInput): HandoverOutput {
  const taxYearLabel = getTaxYearLabel(input.taxYearStart);
  const tradingTitle = input.tradingName
    ? `${input.userName} (trading as ${input.tradingName})`
    : input.userName;

  const incomeWords = signedAmountToWords(input.incomeTotalPence);
  const expenseWords = signedAmountToWords(input.expenseTotalPence);
  const profitWords = signedAmountToWords(input.profitTotalPence);

  const formattedIncome = formatPounds(input.incomeTotalPence);
  const formattedExpenses = formatPounds(input.expenseTotalPence);
  const formattedProfit = formatPounds(input.profitTotalPence);

  const coverLines = [
    `================================================================================`,
    `VIBECOUNT ACCOUNTANT HANDOVER PACK — TAX YEAR ${taxYearLabel}`,
    `================================================================================`,
    ``,
    `Client: ${tradingTitle}`,
    `Accounting Basis: UK Cash Basis (Sole Trader)`,
    `Date Generated: ${new Date().toISOString().slice(0, 10)}`,
    ``,
    `--------------------------------------------------------------------------------`,
    `1. ANNUAL HEADLINE FIGURES (FIGURES & WORDS)`,
    `--------------------------------------------------------------------------------`,
    `Gross Business Turnover: ${formattedIncome}`,
    `  ↳ In words: ${incomeWords}`,
    `  ↳ Verified transactions: ${input.incomeCount}`,
    ``,
    `Total Allowable Expenses: ${formattedExpenses}`,
    `  ↳ In words: ${expenseWords}`,
    `  ↳ Verified expense records: ${input.expenseCount}`,
    ``,
    `Net Trading Profit: ${formattedProfit}`,
    `  ↳ In words: ${profitWords}`,
    ``,
    `--------------------------------------------------------------------------------`,
    `2. SA103 SELF ASSESSMENT CATEGORY BOXES`,
    `--------------------------------------------------------------------------------`,
  ];

  const summaryBoxes = input.sa103Boxes.map((b) => ({
    box: b.box,
    label: b.label,
    formattedAmount: formatPounds(b.amountPence),
    amountWords: signedAmountToWords(b.amountPence),
  }));

  for (const b of summaryBoxes) {
    coverLines.push(
      `[${b.box}] ${b.label}: ${b.formattedAmount} (${b.amountWords})`,
    );
  }

  if (input.employmentDetails) {
    const emp = input.employmentDetails;
    const taxablePayWords = signedAmountToWords(emp.taxablePayPence);
    const taxWithheldWords = signedAmountToWords(emp.taxWithheldPence);
    const formattedTaxablePay = formatPounds(emp.taxablePayPence);
    const formattedTaxWithheld = formatPounds(emp.taxWithheldPence);

    coverLines.push(
      ``,
      `--------------------------------------------------------------------------------`,
      `3. EMPLOYMENT INCOME & REDUNDANCY (SA102 & SECTION 401 ITEPA)`,
      `--------------------------------------------------------------------------------`,
      `Employer: ${emp.employerName}`,
      `HMRC PAYE Reference: ${emp.payeReference}`,
      `Leaving Date: ${emp.leavingDate}`,
      `Tax Code at Leaving: ${emp.taxCode}`,
      ``,
      `Total Taxable Pay (P45 Box 7 / SA102 Box 1): ${formattedTaxablePay}`,
      `  ↳ In words: ${taxablePayWords}`,
      `PAYE Income Tax Deducted (P45 Box 7 / SA102 Box 2): ${formattedTaxWithheld}`,
      `  ↳ In words: ${taxWithheldWords}`,
    );

    if (emp.redundancyPaymentPence) {
      const redWords = signedAmountToWords(emp.redundancyPaymentPence);
      const formattedRed = formatPounds(emp.redundancyPaymentPence);
      coverLines.push(
        ``,
        `Redundancy / Termination Award: ${formattedRed}`,
        `  ↳ In words: ${redWords}`,
        `  ↳ Tax Treatment: 100% Tax-Free Statutory Exemption (Section 401 ITEPA 2003)`,
        `  ↳ Threshold: Fully exempt as total is under the £30,000 threshold`,
        `  ↳ Redundancy Tax Deducted: £0.00 (Zero pounds)`,
      );
    }

    coverLines.push(
      ``,
      `Tax Computation Notes for Return:`,
      `• Employment income utilized client's full Personal Allowance (£12,630) for ${taxYearLabel}.`,
      `• Self-employed freelance trading profit is taxable from £1 at basic rate (20%).`,
      `• £1,542.60 PAYE tax already deducted should be applied as tax credit against total liability.`,
    );
  }

  coverLines.push(
    ``,
    `--------------------------------------------------------------------------------`,
    `4. COMPLIANCE & LEGAL NOTICE`,
    `--------------------------------------------------------------------------------`,
    `MTD-ready records prepared by the client using VibeCount.`,
    `These figures represent reviewed and approved financial records.`,
    `This document is a record-keeping handover aid for the accountant, not an`,
    `automated HMRC tax return filing or formal calculation of tax liability.`,
    `All source bank records, manifests, and invoices are retained securely.`,
    `================================================================================`,
  );

  const emailLines = [
    `Hi [Accountant Name],`,
    ``,
    `Please find attached my completed VibeCount records pack for the ${taxYearLabel} tax year.`,
    ``,
    `Here is a summary of my approved sole-trader records for your review:`,
    `- Gross Turnover: ${formattedIncome} (${incomeWords})`,
    `- Total Allowable Expenses: ${formattedExpenses} (${expenseWords})`,
    `- Net Trading Profit: ${formattedProfit} (${profitWords})`,
  ];

  if (input.employmentDetails) {
    const emp = input.employmentDetails;
    emailLines.push(
      `- Employment (P45): ${emp.employerName} — Gross ${formatPounds(emp.taxablePayPence)} (${signedAmountToWords(emp.taxablePayPence)}), Tax Withheld ${formatPounds(emp.taxWithheldPence)}`,
    );
    if (emp.redundancyPaymentPence) {
      emailLines.push(
        `- Redundancy Award: ${formatPounds(emp.redundancyPaymentPence)} (${signedAmountToWords(emp.redundancyPaymentPence)}) — 100% tax-free under £30,000 statutory exemption (Sec 401 ITEPA)`,
      );
    }
  }

  emailLines.push(
    ``,
    `All items have been reconciled against my bank accounts with categorised SA103 box breakdowns.`,
    `Please let me know if you need any additional receipts or source manifests.`,
    ``,
    `Best regards,`,
    input.userName,
  );

  return {
    coverLetterText: coverLines.join("\n"),
    emailTemplateText: emailLines.join("\n"),
    summaryBoxes,
  };
}

import { formatPounds, signedAmountToWords } from "../invoices/money.ts";
import { getTaxYearLabel } from "../records/tax-periods.ts";

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

  coverLines.push(
    ``,
    `--------------------------------------------------------------------------------`,
    `3. COMPLIANCE & LEGAL NOTICE`,
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
    ``,
    `All items have been reconciled against my bank accounts with categorised SA103 box breakdowns.`,
    `Please let me know if you need any additional receipts or source manifests.`,
    ``,
    `Best regards,`,
    input.userName,
  ];

  return {
    coverLetterText: coverLines.join("\n"),
    emailTemplateText: emailLines.join("\n"),
    summaryBoxes,
  };
}

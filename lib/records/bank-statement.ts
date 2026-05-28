import { parseAmountToPence } from "@/lib/invoices/money";
import { parseInvoiceDateToIso } from "@/lib/invoices/validation";
import { type CsvCategory } from "./csv";

export type BankStatementCandidate = {
  rowNumber: number;
  recordType: "income" | "expense";
  recordDate: string | null;
  description: string;
  amountPence: number | null;
  categoryId: string | null;
  redactedLine: string;
  errorMessage: string | null;
};

export function redactBankStatementText(text: string) {
  return text
    .replace(/\b\d{2}-\d{2}-\d{2}\b/g, "[sort-code]")
    .replace(/\b\d{8}\b/g, "[account-number]")
    .replace(/\b[A-Z]{4}GB[A-Z0-9]{2}[A-Z0-9]{14,24}\b/gi, "[iban]")
    .replace(/\b(?:\d[ -]*?){12,19}\b/g, "[card-or-long-number]");
}

export function parseBankStatementText(
  text: string,
  categories: CsvCategory[]
): BankStatementCandidate[] {
  const redacted = redactBankStatementText(text);
  return redacted
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 150)
    .flatMap((line, index) => {
      const parsed = parseStatementLine(line, index + 1, categories);
      return parsed ? [parsed] : [];
    });
}

function parseStatementLine(
  line: string,
  rowNumber: number,
  categories: CsvCategory[]
): BankStatementCandidate | null {
  const dateMatch = line.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/);
  const amountMatches = [...line.matchAll(/-?£?\d{1,3}(?:,\d{3})*(?:\.\d{2})|-?£?\d+\.\d{2}/g)];
  const amountText = amountMatches.at(-1)?.[0];

  if (!dateMatch || !amountText) {
    return null;
  }

  const normalisedDate = normaliseDate(dateMatch[1]);
  const amountPence = parseAmountToPence(amountText.replace("-", ""));
  const isExpense = amountText.trim().startsWith("-") || /\b(debit|paid|payment|card)\b/i.test(line);
  const recordType = isExpense ? "expense" : "income";
  const categoryId = categories.find((category) => category.record_type === recordType)?.id ?? null;
  const description = line
    .replace(dateMatch[0], "")
    .replace(amountText, "")
    .replace(/\s+/g, " ")
    .trim();
  const errors = [
    normalisedDate ? null : "date",
    description ? null : "description",
    amountPence && amountPence > 0 ? null : "amount",
    categoryId ? null : "category",
  ].filter(Boolean);

  return {
    rowNumber,
    recordType,
    recordDate: normalisedDate,
    description,
    amountPence,
    categoryId,
    redactedLine: line,
    errorMessage: errors.length > 0 ? `Check ${errors.join(", ")}.` : null,
  };
}

function normaliseDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return parseInvoiceDateToIso(value);
  }

  const parts = value.split(/[/-]/);
  if (parts.length !== 3) {
    return null;
  }

  const [day, month, year] = parts;
  const fullYear = year.length === 2 ? `20${year}` : year;
  return parseInvoiceDateToIso(`${day}/${month}/${fullYear}`);
}

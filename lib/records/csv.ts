import { parseInvoiceDateToIso } from "@/lib/invoices/validation";
import { parseAmountToPence } from "@/lib/invoices/money";
import { type RecordType } from "./validation";

export type CsvCategory = {
  id: string;
  name: string;
  record_type: RecordType;
};

export type ParsedCsvRow = {
  rowNumber: number;
  recordType: RecordType;
  recordDate: string | null;
  description: string;
  amountPence: number | null;
  categoryId: string | null;
  errorMessage: string | null;
  rawRow: Record<string, string>;
};

export function parseRecordsCsv(text: string, categories: CsvCategory[]) {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return { ok: false as const, error: "CSV needs a header row and at least one record." };
  }

  const headers = rows[0].map(normaliseHeader);
  const missing = [
    headers.includes("date") ? null : "date",
    headers.includes("description") ? null : "description",
    hasAmountHeader(headers) ? null : "amount",
  ].filter(Boolean);

  if (missing.length > 0) {
    return {
      ok: false as const,
      error: `CSV is missing: ${missing.join(", ")}.`,
    };
  }

  const parsedRows = rows.slice(1).flatMap((row, index) => {
    if (row.every((cell) => !cell.trim())) {
      return [];
    }

    const rawRow = Object.fromEntries(
      headers.map((header, cellIndex) => [header, row[cellIndex]?.trim() ?? ""])
    );

    return [parseRecordRow(index + 2, rawRow, categories)];
  });

  if (parsedRows.length === 0) {
    return { ok: false as const, error: "CSV did not contain any record rows." };
  }

  return { ok: true as const, rows: parsedRows };
}

function parseRecordRow(
  rowNumber: number,
  rawRow: Record<string, string>,
  categories: CsvCategory[]
): ParsedCsvRow {
  const amountText = readAmount(rawRow);
  const recordType = readRecordType(rawRow, amountText);
  const recordDate = parseInvoiceDateToIso(rawRow.date ?? "");
  const description = rawRow.description?.trim() ?? "";
  const amountPence = parseAmountToPence(amountText.replace("-", ""));
  const categoryId = matchCategory(rawRow.category ?? "", recordType, categories);
  const errors = [
    recordDate ? null : "date",
    description ? null : "description",
    amountPence && amountPence > 0 ? null : "amount",
    categoryId ? null : "category",
  ].filter(Boolean);

  return {
    rowNumber,
    recordType,
    recordDate,
    description,
    amountPence,
    categoryId,
    errorMessage: errors.length > 0 ? `Check ${errors.join(", ")}.` : null,
    rawRow,
  };
}

function matchCategory(
  value: string,
  recordType: RecordType,
  categories: CsvCategory[]
) {
  const normalised = normaliseCategory(value);
  const options = categories.filter((category) => category.record_type === recordType);

  if (!normalised) {
    return options[0]?.id ?? null;
  }

  return (
    options.find((category) => normaliseCategory(category.name) === normalised)?.id ??
    options[0]?.id ??
    null
  );
}

function normaliseCategory(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function readRecordType(rawRow: Record<string, string>, amountText: string): RecordType {
  const explicitType = rawRow.type?.toLowerCase();
  if (explicitType === "expense" || explicitType === "debit" || explicitType === "out") {
    return "expense";
  }
  if (explicitType === "income" || explicitType === "credit" || explicitType === "in") {
    return "income";
  }
  if (rawRow.debit || rawRow.paid_out || rawRow.money_out || rawRow.withdrawal) {
    return "expense";
  }
  if (rawRow.credit || rawRow.paid_in || rawRow.money_in || rawRow.deposit) {
    return "income";
  }
  return amountText.trim().startsWith("-") ? "expense" : "income";
}

function readAmount(rawRow: Record<string, string>) {
  return (
    rawRow.amount ||
    rawRow.value ||
    rawRow.debit ||
    rawRow.credit ||
    rawRow.paid_out ||
    rawRow.paid_in ||
    rawRow.money_out ||
    rawRow.money_in ||
    rawRow.withdrawal ||
    rawRow.deposit ||
    ""
  );
}

function hasAmountHeader(headers: string[]) {
  return [
    "amount",
    "value",
    "debit",
    "credit",
    "paid_out",
    "paid_in",
    "money_out",
    "money_in",
    "withdrawal",
    "deposit",
  ].some((header) => headers.includes(header));
}

function normaliseHeader(value: string) {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/£|gbp|\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

  const aliases: Record<string, string> = {
    transaction_date: "date",
    posted_date: "date",
    date_paid: "date",
    details: "description",
    detail: "description",
    narrative: "description",
    reference: "description",
    transaction_description: "description",
    transaction_details: "description",
    name: "description",
    payee: "description",
    merchant: "description",
    value: "amount",
    transaction_amount: "amount",
    debit_amount: "debit",
    credit_amount: "credit",
    paid_out: "paid_out",
    money_out: "money_out",
    withdrawals: "withdrawal",
    withdrawal: "withdrawal",
    paid_in: "paid_in",
    money_in: "money_in",
    deposits: "deposit",
    deposit: "deposit",
    income_expense: "type",
    record_type: "type",
  };

  return aliases[key] ?? key;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);

  return rows;
}

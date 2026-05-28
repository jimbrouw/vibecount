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
  const requiredHeaders = ["type", "date", "description", "amount"];
  const missing = requiredHeaders.filter((header) => !headers.includes(header));

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
  const recordType = rawRow.type?.toLowerCase() === "expense" ? "expense" : "income";
  const recordDate = parseInvoiceDateToIso(rawRow.date ?? "");
  const description = rawRow.description?.trim() ?? "";
  const amountPence = parseAmountToPence(rawRow.amount ?? "");
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

function normaliseHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
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

import { decimalToPence } from "../money";
import { redactBankDetailsForPrompt } from "../ai/redaction";

export const MAX_SOURCE_BYTES = 1_000_000;
export const MAX_SOURCE_ROWS = 5000;
export const SOURCE_PARSER_VERSION = "mapped-csv/1";
export type CsvMapping = {
  accountScope?: { column: number; value: string };
  date: number;
  description: number;
  amount: number;
  debit: number;
  credit: number;
  currency: number;
  reference: number;
  dateFormat: "dmy" | "iso";
  amountMode: "signed" | "debit_credit" | "card_charges";
};
export type SourceTransaction = {
  rowNumber: number;
  date: string;
  description: string;
  signedPence: number;
  currency: "GBP";
  reference: string;
  rawCells: string[];
};

/** Strict CSV tokenizer. Original cell contents and logical record numbers are preserved. */
export function readSourceCsv(text: string): string[][] {
  if (new TextEncoder().encode(text).length > MAX_SOURCE_BYTES)
    throw new Error("CSV must be no larger than 1 MB.");
  text = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
      continue;
    }
    if (c === '"') {
      if (cell || closed) throw new Error("Unexpected quote in CSV field.");
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
      closed = false;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      closed = false;
    } else {
      if (closed) throw new Error("Unexpected text after a quoted CSV field.");
      cell += c;
    }
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  if (cell || row.length || closed) {
    row.push(cell);
    rows.push(row);
  }
  if (rows.length < 2 || rows.length > MAX_SOURCE_ROWS + 1)
    throw new Error("Choose a CSV with 1 to 5,000 data rows.");
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  if (headers.some((h) => !h) || new Set(headers).size !== headers.length)
    throw new Error("CSV headers must be non-empty and distinct.");
  if (
    rows
      .slice(1)
      .some((r) => r.some((c) => c.trim()) && r.length !== headers.length)
  )
    throw new Error("CSV rows must match the header columns.");
  return rows;
}

export function suggestMapping(
  headers: string[],
  provider: string,
): CsvMapping {
  const keys = headers.map((h) =>
    h
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim(),
  );
  const find = (...names: string[]) => keys.findIndex((h) => names.includes(h));
  return {
    date: find("date", "transaction date", "posted date"),
    description: find(
      "counter party",
      "counterparty",
      "description",
      "details",
      "merchant",
      "name",
      "payee",
    ),
    amount: find("outflow gbp") >= 0 ? find("outflow gbp") : find("amount", "amount gbp", "amount in gbp", "value"),
    debit: find("paid out", "debit", "money out", "withdrawals"),
    credit: find("paid in", "credit", "money in", "deposits"),
    currency: find("currency", "currency code"),
    reference: find("reference", "payment reference"),
    dateFormat: "dmy",
    amountMode:
      find("outflow gbp") >= 0 || provider === "amex"
        ? "card_charges"
        : find("paid out", "debit", "money out") >= 0
          ? "debit_credit"
          : "signed",
  };
}

function exactDate(value: string, format: CsvMapping["dateFormat"]): string {
  const m = (
    format === "dmy"
      ? /^(\d{2})\/(\d{2})\/(\d{4})$/
      : /^(\d{4})-(\d{2})-(\d{2})$/
  ).exec(value.trim());
  if (!m) throw new Error("Date does not match the selected format.");
  const [year, month, day] =
    format === "dmy"
      ? [Number(m[3]), Number(m[2]), Number(m[1])]
      : [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    year > 9998 ||
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  )
    throw new Error("Invalid calendar date.");
  return d.toISOString().slice(0, 10);
}

// Shared calendar validation; V1 normalization and its retained bytes stay unchanged.
export { exactDate as sourceCsvDate };

function money(value: string): number {
  let text = value.trim().replace(/^£/, "");
  // Grouping is permitted only in correct thousands groups, never used as a decimal separator.
  if (text.includes(",")) {
    if (!/^-?\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(text))
      throw new Error("Ambiguous money formatting.");
    text = text.replaceAll(",", "");
  }
  const result = decimalToPence(text);
  if (result === null || Math.abs(result) > 999_999_999_999)
    throw new Error("Invalid or out-of-range amount.");
  return result;
}

export function normalizeSourceCsv(
  table: string[][],
  mapping: CsvMapping,
): SourceTransaction[] {
  const width = table[0]?.length ?? 0;
  const required = [
    mapping.date,
    mapping.description,
    ...(mapping.amountMode === "debit_credit"
      ? [mapping.debit, mapping.credit]
      : [mapping.amount]),
  ];
  const optional = [mapping.currency, mapping.reference].filter(
    (i) => i !== -1,
  );
  if (
    !["dmy", "iso"].includes(mapping.dateFormat) ||
    !["signed", "debit_credit", "card_charges"].includes(mapping.amountMode) ||
    [...required, ...optional].some(
      (i) => !Number.isInteger(i) || i < 0 || i >= width,
    ) ||
    new Set(required).size !== required.length
  )
    throw new Error(
      "Choose distinct, valid columns for date, description and amounts.",
    );
  const headerCurrency = table[0].join(" ").match(/\b(USD|EUR|AUD|CAD|JPY)\b/i);
  if (headerCurrency && mapping.currency < 0)
    throw new Error(
      "This import currently requires GBP amounts; select a GBP column or currency field.",
    );
  return table.slice(1).flatMap((cells, i) => {
    if (cells.every((c) => !c.trim())) return [];
    try {
      const currency =
        mapping.currency < 0
          ? "GBP"
          : cells[mapping.currency].trim().toUpperCase();
      if (currency !== "GBP")
        throw new Error(
          "Only GBP is supported in this import. FX needs separate review.",
        );
      let signedPence: number;
      if (mapping.amountMode === "debit_credit") {
        const debit = cells[mapping.debit].trim()
          ? money(cells[mapping.debit])
          : 0;
        const credit = cells[mapping.credit].trim()
          ? money(cells[mapping.credit])
          : 0;
        if (debit < 0 || credit < 0 || (debit !== 0 && credit !== 0))
          throw new Error(
            "Debit and credit must be positive and only one may be non-zero.",
          );
        signedPence = credit - debit;
      } else {
        signedPence = money(cells[mapping.amount]);
        if (mapping.amountMode === "card_charges") signedPence = -signedPence;
      }
      const description = redactBankDetailsForPrompt(
        cells[mapping.description].trim(),
      );
      if (!description || description.length > 1000)
        throw new Error("Description must contain 1 to 1,000 characters.");
      if (signedPence === 0)
        throw new Error(
          "Zero amounts need correction or a different column mapping.",
        );
      return [
        {
          rowNumber: i + 2,
          date: exactDate(cells[mapping.date], mapping.dateFormat),
          description,
          signedPence,
          currency: "GBP" as const,
          reference:
            mapping.reference < 0
              ? ""
              : redactBankDetailsForPrompt(
                  cells[mapping.reference].trim(),
                ).slice(0, 1000),
          rawCells: cells,
        },
      ];
    } catch (error) {
      throw new Error(
        `Row ${i + 2}: ${error instanceof Error ? error.message : "Invalid row."}`,
      );
    }
  });
}

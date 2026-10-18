import { redactBankDetailsForPrompt } from '../ai/redaction';
import {
  currencyAmount, currencyCode, currencyMinor, exactObject,
  FX_CURRENCIES, FX_CURRENCY_RULESET, type CurrencyCode,
} from '../fx/currency';
import {
  normalizeSourceCsv, readSourceCsv, sourceCsvDate, type CsvMapping,
} from './source-csv';

/** Preparation contract only. Current ingestion remains mapped-csv/1 and GBP-only. */
export const DIMENSIONED_SOURCE_PARSER_VERSION = 'mapped-csv/2';
export type DimensionedSourceTransaction = {
  rowNumber: number;
  date: string;
  description: string;
  signedOriginalMinor: number;
  currency: CurrencyCode;
  currencyExponent: number;
  /** Actual GBP observation only, never an inferred foreign-currency valuation. */
  signedAmountPence: number | null;
  reference: string;
  rawCells: string[];
};
export type DimensionedSourceCsv = {
  parser_version: typeof DIMENSIONED_SOURCE_PARSER_VERSION;
  currency_ruleset: typeof FX_CURRENCY_RULESET;
  account_currency: CurrencyCode;
  rows: DimensionedSourceTransaction[];
};

function mappingFor(table: string[][], value: unknown): CsvMapping {
  const p = exactObject(value, [
    'date', 'description', 'amount', 'debit', 'credit', 'currency', 'reference',
    'dateFormat', 'amountMode',
  ]);
  if ((p.dateFormat !== 'dmy' && p.dateFormat !== 'iso') ||
      (p.amountMode !== 'signed' && p.amountMode !== 'debit_credit' && p.amountMode !== 'card_charges'))
    throw new Error('Choose an explicit date format and amount sign convention.');
  const width = table[0].length;
  for (const field of ['date', 'description', 'amount', 'debit', 'credit', 'currency', 'reference']) {
    if (!Number.isInteger(p[field]) || (p[field] as number) < -1 || (p[field] as number) >= width)
      throw new Error('Choose valid source columns or the explicit unused value.');
  }
  const selected = [p.date, p.description,
    ...(p.amountMode === 'debit_credit' ? [p.debit, p.credit] : [p.amount]),
    ...[p.currency, p.reference].filter(i => i !== -1)] as number[];
  if (selected.some(i => i < 0) || new Set(selected).size !== selected.length)
    throw new Error('Choose distinct columns for each selected source field.');
  return p as unknown as CsvMapping;
}

function checkAmountHeaders(table: string[][], mapping: CsvMapping, code: CurrencyCode) {
  const fields = mapping.amountMode === 'debit_credit' ? [mapping.debit, mapping.credit] : [mapping.amount];
  for (const index of fields) {
    const header = table[0][index];
    // V2 checks selected monetary columns. The GBP delegate additionally retains V1's stricter global header check.
    const ordinaryWords = new Set(['OUT', 'NET', 'TAX', 'SUM', 'PAY', 'FEE', 'VAT', 'PER']);
    const declarations = [...header.matchAll(/(?:^|[^A-Za-z])([A-Za-z]{3})(?=$|[^A-Za-z])/g)]
      .map(m => m[1].toUpperCase()).filter(c => !ordinaryWords.has(c));
    if (declarations.some(c => c !== code))
      throw new Error('The selected amount column currency must match the account.');
    const symbols = code === 'GBP' ? header.replaceAll('£', '') : header;
    if (/\p{Sc}/u.test(symbols))
      throw new Error('Use an explicit matching currency code; only GBP headers may use the £ symbol.');
  }
}

function exactSourceMinor(value: string, code: CurrencyCode): number {
  let text = value.trim();
  if (text.includes(',')) {
    if (!/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text))
      throw new Error('Ambiguous source amount grouping.');
    text = text.replaceAll(',', '');
  }
  return currencyAmount(text, code);
}

/**
 * Original units only. Explicit account currency is required even without a CSV currency column.
 * No GBP valuation, classification, fingerprint, registration or posting is inferred here.
 */
export function parseDimensionedSourceCsv(text: string, value: unknown, accountCurrency: unknown): DimensionedSourceCsv {
  const code = currencyCode(accountCurrency), table = readSourceCsv(text), mapping = mappingFor(table, value);
  checkAmountHeaders(table, mapping, code);
  let rows: DimensionedSourceTransaction[];
  if (code === 'GBP') {
    // Keep native money/date/redaction/row semantics; never reinterpret retained V1 registrations.
    rows = normalizeSourceCsv(table, mapping).map(row => ({
      rowNumber: row.rowNumber, date: row.date, description: row.description,
      signedOriginalMinor: row.signedPence, currency: row.currency, currencyExponent: 2,
      signedAmountPence: row.signedPence, reference: row.reference, rawCells: row.rawCells,
    }));
  } else {
    rows = table.slice(1).flatMap((cells, i) => {
      if (cells.every(c => !c.trim())) return [];
      try {
        const rowCurrency = mapping.currency === -1 ? code : currencyCode(cells[mapping.currency].trim().toUpperCase());
        if (rowCurrency !== code) throw new Error('Every source row must match the selected account currency.');
        let signed: number;
        if (mapping.amountMode === 'debit_credit') {
          const debit = cells[mapping.debit].trim() ? exactSourceMinor(cells[mapping.debit], code) : 0;
          const credit = cells[mapping.credit].trim() ? exactSourceMinor(cells[mapping.credit], code) : 0;
          if (debit < 0 || credit < 0 || (debit !== 0 && credit !== 0))
            throw new Error('Debit and credit must be positive and only one may be non-zero.');
          signed = currencyMinor(credit - debit);
        } else {
          signed = exactSourceMinor(cells[mapping.amount], code);
          if (mapping.amountMode === 'card_charges') signed = -signed;
        }
        if (!signed) throw new Error('Zero source amounts need correction or a different mapping.');
        const description = redactBankDetailsForPrompt(cells[mapping.description].trim());
        if (!description || description.length > 1000)
          throw new Error('Description must contain 1 to 1,000 characters.');
        return [{ rowNumber: i + 2, date: sourceCsvDate(cells[mapping.date], mapping.dateFormat),
          description, signedOriginalMinor: signed, currency: code, currencyExponent: FX_CURRENCIES[code].exponent,
          signedAmountPence: null, reference: mapping.reference === -1 ? '' :
            redactBankDetailsForPrompt(cells[mapping.reference].trim()).slice(0, 1000), rawCells: cells }];
      } catch (error) {
        throw new Error(`Row ${i + 2}: ${error instanceof Error ? error.message : 'Invalid source row.'}`);
      }
    });
  }
  return { parser_version: DIMENSIONED_SOURCE_PARSER_VERSION, currency_ruleset: FX_CURRENCY_RULESET,
    account_currency: code, rows };
}

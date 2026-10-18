import { normalizeSourceCsv, type CsvMapping } from './source-csv';
import { redactBankDetailsForPrompt } from '../ai/redaction';

export const GROUPED_SOURCE_PARSER = 'grouped-csv/1';
export type AccountScope = { column: number; value: string };

/** Scope selects observations, never rewrites the preserved original or row numbers. */
export function sourceGroups(table: string[][], mapping: CsvMapping) {
  const column = table[0].findIndex(header => header.trim().toLowerCase() === 'account');
  if (column < 0) throw new Error('This file needs an Account column to split payments.');
  const rows = normalizeSourceCsv(table, mapping);
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const value = row.rawCells[column].trim();
    if (!value || value.length > 80 || redactBankDetailsForPrompt(value) !== value)
      throw new Error(`Row ${row.rowNumber}: use a short account label without private bank details.`);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value)!.push(row);
  }
  if (groups.size > 20) throw new Error('Split imports support up to 20 accounts per file.');
  return [...groups].map(([value, rows]) => ({
    scope: { column, value }, rows,
    incoming: rows.reduce((sum, row) => sum + Math.max(0, row.signedPence), 0),
    outgoing: rows.reduce((sum, row) => sum + Math.max(0, -row.signedPence), 0),
  }));
}

export function scopedSourceRows(table: string[][], mapping: CsvMapping) {
  const scope = mapping.accountScope;
  if (!scope || !Number.isInteger(scope.column) || typeof scope.value !== 'string')
    throw new Error('Choose a valid account group.');
  const group = sourceGroups(table, mapping).find(group => group.scope.column === scope.column && group.scope.value === scope.value);
  if (!group) throw new Error('The selected account group is not in this file.');
  return group.rows;
}

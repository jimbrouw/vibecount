/** Spreadsheet-safe presentation only. Never modify preserved source evidence. */
export function escapeCsv(value: string): string {
  // Spreadsheet importers may ignore leading whitespace/control characters.
  const plainNegativeNumber = /^-\d+(?:\.\d+)?$/.test(value);
  const safe = (!plainNegativeNumber && /^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(value)) || /^[\t\r\n]/.test(value)
    ? `'${value}`
    : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const SORT_CODE_PATTERN = /\b\d{2}[- ]?\d{2}[- ]?\d{2}\b/g;
const ACCOUNT_NUMBER_PATTERN = /\b\d{8}\b/g;
const IBAN_PATTERN = /\b[A-Z]{2}\d{2}[A-Z0-9 ]{11,30}\b/gi;

export function redactBankDetailsForPrompt(value: string | null | undefined) {
  if (!value) return "";

  return value
    .replace(IBAN_PATTERN, "[redacted IBAN]")
    .replace(SORT_CODE_PATTERN, "[redacted sort code]")
    .replace(ACCOUNT_NUMBER_PATTERN, "[redacted account number]");
}

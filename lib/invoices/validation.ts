import { normaliseClientName, parseAmountToPence } from "./money";

export const DEFAULT_PAYMENT_TERMS = "Payment due within 30 days";

export type InvoiceInput = {
  clientName: string;
  invoiceDate: string;
  description: string;
  amount: string;
  paymentTerms: string;
};

export type ValidInvoiceInput = {
  clientName: string;
  invoiceDate: string;
  description: string;
  amountPence: number;
  paymentTerms: string;
};

export function validateInvoiceInput(input: InvoiceInput):
  | { ok: true; value: ValidInvoiceInput }
  | { ok: false; error: string } {
  const clientName = normaliseClientName(input.clientName);
  const description = input.description.trim();
  const paymentTerms = input.paymentTerms.trim() || DEFAULT_PAYMENT_TERMS;
  const amountPence = parseAmountToPence(input.amount);
  const invoiceDate = parseInvoiceDateToIso(input.invoiceDate);

  if (!clientName) {
    return { ok: false, error: "Add a client name." };
  }

  if (!invoiceDate) {
    return { ok: false, error: "Use day/month/year for the invoice date." };
  }

  if (!description) {
    return { ok: false, error: "Add what the invoice is for." };
  }

  if (amountPence === null || amountPence <= 0) {
    return { ok: false, error: "Add an amount above £0." };
  }

  return {
    ok: true,
    value: {
      clientName,
      invoiceDate,
      description,
      amountPence,
      paymentTerms,
    },
  };
}

export function formatTodayAsUkDate() {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
}

export function parseInvoiceDateToIso(value: string) {
  const trimmed = value.trim();
  const ukMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ukMatch) {
    const [, dayText, monthText, yearText] = ukMatch;
    return toValidIsoDate(Number(yearText), Number(monthText), Number(dayText));
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, yearText, monthText, dayText] = isoMatch;
    return toValidIsoDate(Number(yearText), Number(monthText), Number(dayText));
  }

  return null;
}

function toValidIsoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

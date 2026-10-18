import { requireNativeGbpInvoice } from "./native";
import { apportionPence, decimalToPence } from "../money";

export const MAX_INVOICE_PENCE = 999_999_999_999;
export type InvoiceEconomics = {
  netPence: number;
  vatPence: number;
  totalPence: number;
  vatEnabled: boolean;
  vatRateBps: number;
  vatNumber: string;
};

export function invoiceEconomics(
  netPence: number,
  vatEnabled: boolean,
  rate: unknown,
  vatNumber: string,
): InvoiceEconomics {
  const rateBps =
    typeof rate === "string" || typeof rate === "number"
      ? decimalToPence(rate)
      : null;
  if (
    !Number.isSafeInteger(netPence) ||
    netPence <= 0 ||
    netPence > MAX_INVOICE_PENCE
  )
    throw new Error(
      "Use a positive invoice amount within the supported range.",
    );
  if (
    vatEnabled &&
    (rateBps === null || rateBps < 0 || rateBps > 10000 || !vatNumber.trim())
  )
    throw new Error("Check the VAT rate and VAT registration number.");
  const vatPence = vatEnabled ? apportionPence(netPence, rateBps!) : 0;
  const totalPence = netPence + vatPence;
  if (totalPence > MAX_INVOICE_PENCE)
    throw new Error("Invoice total is too large.");
  return {
    netPence,
    vatPence,
    totalPence,
    vatEnabled,
    vatRateBps: vatEnabled ? rateBps! : 0,
    vatNumber: vatEnabled ? vatNumber.trim() : "",
  };
}

export function invoiceEditAmounts(invoice: {
  origin: string; currency: string;
  amount: string | number;
  status?: string;
  finalised_at?: string | null;
  net_pence: string | number | null;
  vat_pence: string | number | null;
  vat_rate_bps: number | null;
  vat_number_snapshot: string | null;
  vat_enabled: boolean | null;
}) {
  requireNativeGbpInvoice(invoice);
  const gross = decimalToPence(invoice.amount);
  if (gross === null || gross <= 0)
    throw new Error("Invoice total needs review.");
  if (
    invoice.status === "draft" &&
    !invoice.finalised_at &&
    invoice.net_pence === null
  )
    return {
      amount: `${Math.floor(gross / 100)}.${String(gross % 100).padStart(2, "0")}`,
      legacyGrossPence: undefined,
      vatEnabled: undefined,
      vatRate: undefined,
      vatNumber: undefined,
    };
  if (invoice.net_pence === null || invoice.vat_enabled === null)
    return {
      amount: "",
      legacyGrossPence: gross,
      vatEnabled: false,
      vatRate: "",
      vatNumber: "",
    };
  const net = Number(invoice.net_pence);
  const result = invoiceEconomics(
    net,
    invoice.vat_enabled,
    (invoice.vat_rate_bps ?? 0) / 100,
    invoice.vat_number_snapshot ?? "",
  );
  if (
    result.totalPence !== gross ||
    result.vatPence !== Number(invoice.vat_pence)
  )
    throw new Error("Invoice amounts need review.");
  return {
    amount: `${Math.floor(net / 100)}.${String(net % 100).padStart(2, "0")}`,
    legacyGrossPence: undefined,
    vatEnabled: result.vatEnabled,
    vatRate: String(result.vatRateBps / 100),
    vatNumber: result.vatNumber,
  };
}

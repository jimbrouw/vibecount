import { parseAmountToPence, amountToWords } from "@/lib/invoices/money";
import { parseInvoiceDateToIso } from "@/lib/invoices/validation";

export type ReceiptCategory = { id: string; name: string; record_type: string };
export type ReceiptDraft = {
  merchant: string | null;
  documentDate: string | null;
  currency: string | null;
  totalPence: number | null;
  vatPence: number | null;
  amounts: { label: string; pence: number; role: string }[];
  ambiguous: boolean;
  paymentStatus: "paid" | "unpaid" | "unknown";
  paymentDate: string | null;
  kind: "expense" | "refund";
  categoryId: string | null;
  notes: string[];
};

const MAX_PENCE = 99_999_999_999;
const roles = ["subtotal", "vat", "total", "tendered", "change", "balance", "other"];
const date = (v: unknown) => typeof v === "string" ? parseInvoiceDateToIso(v) : null;
const shortText = (v: unknown, max = 200) => typeof v === "string" ? v.trim().slice(0, max) || null : null;
const pence = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= MAX_PENCE ? v : null;

// Treat every model field as untrusted. Missing money stays missing.
export function validateReceiptExtraction(value: unknown, categories: ReceiptCategory[]): ReceiptDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid receipt response");
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.amounts) || typeof input.ambiguous !== "boolean") throw new Error("Invalid receipt response");
  const amounts = input.amounts.slice(0, 12).map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("Invalid amount");
    const a = item as Record<string, unknown>;
    const n = pence(a.pence);
    const label = shortText(a.label, 80);
    if (n === null || !label || typeof a.role !== "string" || !roles.includes(a.role)) throw new Error("Invalid amount");
    return { label, pence: n, role: a.role };
  });
  const totals = [...new Set(amounts.filter(a => a.role === "total").map(a => a.pence))];
  const candidateTotal = pence(input.totalPence);
  // No final total unless it also appears as an explicitly labelled total.
  const totalPence = candidateTotal !== null && totals.includes(candidateTotal) ? candidateTotal : null;
  const candidateVat = pence(input.vatPence);
  const vatPence = candidateVat !== null && amounts.some(a => a.role === "vat" && a.pence === candidateVat) ? candidateVat : null;
  const currency = typeof input.currency === "string" && /^[A-Z]{3}$/.test(input.currency) ? input.currency : null;
  const documentDate = date(input.documentDate);
  const paymentStatus = input.paymentStatus === "paid" || input.paymentStatus === "unpaid" ? input.paymentStatus : "unknown";
  const subtotal = amounts.find(a => a.role === "subtotal")?.pence;
  const arithmeticMismatch = subtotal !== undefined && vatPence !== null && totalPence !== null && subtotal + vatPence !== totalPence;
  return {
    merchant: shortText(input.merchant), documentDate, currency, totalPence, vatPence, amounts,
    ambiguous: input.ambiguous || totals.length !== 1 || totalPence === null || arithmeticMismatch || (vatPence !== null && totalPence !== null && vatPence > totalPence),
    paymentStatus, paymentDate: paymentStatus === "paid" ? date(input.paymentDate) : null,
    kind: input.kind === "refund" ? "refund" : "expense",
    categoryId: categories.find(c => c.record_type === "expense" && c.id === input.categoryId)?.id ?? null,
    notes: Array.isArray(input.notes) ? input.notes.slice(0, 8).map(n => shortText(n)).filter((n): n is string => Boolean(n)) : [],
  };
}

export type ConfirmReceipt = {
  merchant: string; documentDate: string; currency: "GBP"; grossPence: number;
  vatPence: number | null; businessUsePercent: number; categoryId: string;
  paymentStatus: "paid" | "unpaid"; paymentDate: string | null;
  kind: "expense" | "refund"; refundOf: string | null; matchRecordId: string | null;
  amountConfirmed: true;
};

export function validateReceiptConfirmation(input: Record<string, unknown>): ConfirmReceipt {
  const merchant = shortText(input.merchant);
  const documentDate = date(input.documentDate);
  const grossPence = typeof input.amount === "string" ? parseAmountToPence(input.amount) : null;
  const vatPence = input.vat === "" || input.vat == null ? null : typeof input.vat === "string" ? parseAmountToPence(input.vat) : null;
  const percent = typeof input.businessUsePercent === "number" ? input.businessUsePercent : NaN;
  if (!merchant || !documentDate) throw new Error("Check the merchant and document date.");
  if (input.currency !== "GBP") throw new Error("Only GBP can be confirmed in this first version. Keep other currencies in review; do not relabel them as pounds.");
  if (grossPence === null || grossPence <= 0 || grossPence > MAX_PENCE || !Number.isSafeInteger(grossPence)) throw new Error("Enter a valid final total above £0.");
  if (input.vat !== "" && input.vat != null && (vatPence === null || vatPence > grossPence)) throw new Error("VAT must be explicit, valid, and no greater than the total. Leave it blank if unknown.");
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) throw new Error("Business use must be a whole percentage from 1 to 100. Exclude personal spending.");
  if (input.paymentStatus !== "paid" && input.paymentStatus !== "unpaid") throw new Error("Choose whether this expense has been paid.");
  const paymentDate = input.paymentStatus === "paid" ? date(input.paymentDate) : null;
  if (input.paymentStatus === "paid" && !paymentDate) throw new Error("Add the actual payment date. The document date does not prove payment.");
  if (input.amountConfirmed !== true) throw new Error("Check the amount in figures and words before confirming.");
  const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v) ? v : null;
  const categoryId = uuid(input.categoryId);
  if (!categoryId) throw new Error("Choose an existing expense category.");
  const kind = input.kind === "refund" ? "refund" : "expense";
  const refundOf = uuid(input.refundOf);
  if (kind === "refund" && (!refundOf || input.paymentStatus !== "paid")) throw new Error("Link this refund to the original expense and add the date it was received.");
  if (input.matchRecordId && !uuid(input.matchRecordId)) throw new Error("Choose a valid matching record.");
  return { merchant, documentDate, currency: "GBP", grossPence, vatPence, businessUsePercent: percent,
    categoryId, paymentStatus: input.paymentStatus, paymentDate, kind, refundOf,
    matchRecordId: uuid(input.matchRecordId), amountConfirmed: true };
}

export function receiptAmountWords(pence: number, currency: string | null) {
  return currency === "GBP" ? amountToWords(pence) : `${amountToWords(pence).replace(/pounds?/g, "major units").replace(/pence|penny/g, "minor units")} (${currency ?? "currency unknown"})`;
}

export function formatReceiptMoney(pence: number, currency: string | null) {
  if (!currency) return `${(pence / 100).toFixed(2)} (currency unknown)`;
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(pence / 100); }
  catch { return `${(pence / 100).toFixed(2)} ${currency}`; }
}

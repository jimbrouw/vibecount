import { decimalToPence, sumPence } from "../money.ts";

export type InvoiceBalance = {
  id: string;
  number: string;
  invoice_date?: string;
  client_name?: string;
  invoice_pence: number | string;
  allocated_pence: number | string;
  outstanding_pence: number | string;
  updated_at: string;
  currency: string;
  status: string;
  credited_pence?: number | string;
  entitlement_pence?: number | string;
  refund_due_pence?: number | string;
  returned_pence?: number | string;
  retained_cash_pence?: number | string;
};
export type ReceiptBalance = {
  id: string;
  signed_amount_pence: number | string;
  allocated_pence: number | string;
  unallocated_pence: number | string;
  decision_version: number;
  classification: string;
  business_use_bps: number;
  dedupe_status: string;
  record_status: string | null;
  recognized_pence: number | string | null;
  currency: string;
  active_refund_id?: string | null;
  refunded_pence?: number | string;
};
export function minorPence(value: number | string): number {
  const number = Number(value);
  if (!/^-?\d+$/.test(String(value)) || !Number.isSafeInteger(number))
    throw new Error("Invalid pence amount.");
  return number;
}
export function allocationReview(
  receipt: ReceiptBalance,
  invoices: InvoiceBalance[],
  amounts: Record<string, string>,
) {
  if (
    receipt.active_refund_id ||
    receipt.classification !== "Business" ||
    receipt.business_use_bps !== 10000 ||
    receipt.dedupe_status !== "clear" ||
    receipt.record_status !== "approved" ||
    receipt.currency !== "GBP" ||
    receipt.recognized_pence === null ||
    minorPence(receipt.recognized_pence) !==
      minorPence(receipt.signed_amount_pence)
  )
    throw new Error(
      "Review the complete receipt as Business income before allocating it.",
    );
  const rows = Object.entries(amounts)
    .filter(([, value]) => value.trim() !== "")
    .map(([id, value]) => {
      const invoice = invoices.find((inv) => inv.id === id);
      const pence = decimalToPence(value);
      if (
        !invoice ||
        invoice.status !== "finalised" ||
        invoice.currency !== "GBP"
      )
        throw new Error("Choose a finalised GBP invoice from this review.");
      if (pence === null || pence <= 0 || pence > 999999999999)
        throw new Error(
          "Enter a positive amount with at most two decimal places.",
        );
      const outstanding = minorPence(invoice.outstanding_pence);
      if (pence > outstanding)
        throw new Error(
          "An allocation exceeds the invoice outstanding amount.",
        );
      return {
        invoice_id: id,
        invoice_updated_at: invoice.updated_at,
        amount_pence: pence,
        number: invoice.number,
        remaining_pence: outstanding - pence,
      };
    });
  if (rows.length < 1 || rows.length > 50)
    throw new Error("Choose 1 to 50 invoice allocations.");
  const total = sumPence(rows.map((row) => row.amount_pence));
  const remaining = minorPence(receipt.unallocated_pence) - total;
  if (remaining < 0)
    throw new Error("Allocations exceed the unallocated receipt amount.");
  return { rows, total, remaining };
}

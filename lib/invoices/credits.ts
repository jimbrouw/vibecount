import { minorPence } from "../records/allocations";
export type CreditBalance = {
  id: string;
  number: string;
  invoice_date: string;
  status: string;
  currency: string;
  updated_at: string;
  invoice_pence: number | string;
  allocated_pence: number | string;
  outstanding_pence: number | string;
  credited_pence: number | string;
  entitlement_pence: number | string;
  refund_due_pence: number | string;
  returned_pence?: number | string;
  net_pence: number | string | null;
  vat_pence: number | string | null;
  credited_net_pence: number | string;
  credited_vat_pence: number | string;
  vat_rate_bps: number | null;
  vat_number_snapshot: string | null;
  economics_version: number;
  balance_stamp: string;
};
export function invoiceBalance(
  gross: number,
  credited: number,
  receipts: number,
  refunds = 0,
) {
  if (
    [gross, credited, receipts, refunds].some(
      (v) => !Number.isSafeInteger(v) || v < 0,
    ) ||
    credited > gross ||
    refunds > receipts
  )
    throw new Error("Invalid invoice balance.");
  const entitlement = gross - credited,
    retained = receipts - refunds;
  return {
    entitlement,
    retained,
    outstanding: Math.max(entitlement - retained, 0),
    refundDue: Math.max(retained - entitlement, 0),
    state:
      retained > entitlement
        ? "refund_due"
        : entitlement === 0
          ? "fully_credited"
          : retained === entitlement
            ? "settled"
            : retained > 0
              ? "part_paid"
              : "unpaid",
  };
}
export function creditReview(
  invoice: CreditBalance,
  gross: number,
  date: string,
  today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
  }).format(new Date()),
) {
  const total = minorPence(invoice.invoice_pence),
    credited = minorPence(invoice.credited_pence);
  if (
    invoice.status !== "finalised" ||
    invoice.currency !== "GBP" ||
    !Number.isSafeInteger(gross) ||
    gross <= 0 ||
    gross > total - credited
  )
    throw new Error(
      "Choose a positive GBP credit within the remaining invoice value.",
    );
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date ||
    date < invoice.invoice_date ||
    date > today
  )
    throw new Error(
      "Use a valid credit date between the invoice date and today.",
    );
  const known =
    invoice.net_pence !== null &&
    invoice.vat_pence !== null &&
    invoice.economics_version > 0;
  const net = known
    ? Number(
        (BigInt(credited + gross) * BigInt(minorPence(invoice.net_pence!)) +
          BigInt(Math.floor(total / 2))) /
          BigInt(total),
      ) - minorPence(invoice.credited_net_pence)
    : null;
  const vat = net === null ? null : gross - net;
  if (
    net !== null &&
    (net < 0 ||
      vat! < 0 ||
      minorPence(invoice.credited_net_pence) + net >
        minorPence(invoice.net_pence!) ||
      minorPence(invoice.credited_vat_pence) + vat! >
        minorPence(invoice.vat_pence!))
  )
    throw new Error("Credit breakdown exceeds the verified invoice economics.");
  return {
    gross,
    net,
    vat,
    known,
    before: invoiceBalance(
      total,
      credited,
      minorPence(invoice.allocated_pence),
      minorPence(invoice.returned_pence ?? 0),
    ),
    after: invoiceBalance(
      total,
      credited + gross,
      minorPence(invoice.allocated_pence),
      minorPence(invoice.returned_pence ?? 0),
    ),
  };
}

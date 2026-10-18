import { minorPence } from "../records/allocations";
import { sumPence } from "../money";
export type InvoiceBalanceRow = {
  id: string;
  status: string;
  currency: string;
  updated_at: string;
  invoice_pence: number | string;
  allocated_pence: number | string;
  credited_pence: number | string;
  outstanding_pence: number | string;
  refund_due_pence: number | string;
  settlement_state: string;
  has_reconciliation_history: boolean;
  has_credit_history?: boolean;
  returned_pence?: number | string;
  paid_at: string | null;
  delivery_status: string;
};
/** Evidence-backed commercial totals. A manual paid assertion is not a cash observation. */
export function summariseInvoiceBalances(rows: InvoiceBalanceRow[]) {
  const finalised = rows.filter((r) => r.status === "finalised");
  if (finalised.some((r) => r.currency !== "GBP"))
    throw new Error("Separate currency totals are required.");
  const total = (
    key:
      | "invoice_pence"
      | "allocated_pence"
      | "credited_pence"
      | "outstanding_pence"
      | "refund_due_pence"
      | "returned_pence",
  ) =>
    sumPence(
      finalised.map((r) => {
        const p = minorPence(r[key] ?? 0);
        if (p < 0) throw new Error("Invalid invoice balance.");
        return p;
      }),
    );
  return {
    invoiced: total("invoice_pence"),
    receipts: total("allocated_pence"),
    returned: total("returned_pence"),
    retained: sumPence(
      finalised.map((r) => {
        const p =
          minorPence(r.allocated_pence) - minorPence(r.returned_pence ?? 0);
        if (p < 0) throw new Error("Returned cash exceeds receipts.");
        return p;
      }),
    ),
    credited: total("credited_pence"),
    outstanding: total("outstanding_pence"),
    cashToReconcile: total("refund_due_pence"),
    manualPaidAssertions: finalised.filter(
      (r) =>
        !r.has_reconciliation_history &&
        (r.paid_at || r.delivery_status === "paid"),
    ).length,
  };
}

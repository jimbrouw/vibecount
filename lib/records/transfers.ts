import { minorPence } from "./allocations.ts";

export type TransferChoice = {
  id: string;
  account_id: string;
  import_id: string;
  transaction_date: string;
  signed_amount_pence: number | string;
  currency: string;
  description: string;
  account_label: string;
  account_mask: string;
  account_type: string;
  classification: string;
  decision_version: number;
  dedupe_status: string;
  active_transfer_id: string | null;
  active_refund_id?: string | null;
  has_refunds?: boolean;
  import_status: string;
  record_status: string | null;
  recognized_pence: number | string;
  invoice_allocated_pence: number | string;
};
export type TransferKind = "transfer" | "card_repayment";
export function transferReview(
  outgoing: TransferChoice,
  incoming: TransferChoice,
  kind: TransferKind,
) {
  const amount = minorPence(incoming.signed_amount_pence);
  if (
    outgoing.id === incoming.id ||
    outgoing.account_id === incoming.account_id ||
    amount <= 0 ||
    minorPence(outgoing.signed_amount_pence) !== -amount ||
    outgoing.currency !== "GBP" ||
    incoming.currency !== "GBP"
  )
    throw new Error(
      "Choose equal opposite GBP amounts from different owned accounts.",
    );
  if (
    outgoing.import_status === "discarded" ||
    incoming.import_status === "discarded"
  )
    throw new Error("Reopen reversed imports before pairing.");
  if (outgoing.dedupe_status !== "clear" || incoming.dedupe_status !== "clear")
    throw new Error("Resolve possible duplicate observations before pairing.");
  if (
    outgoing.has_refunds ||
    incoming.has_refunds ||
    outgoing.active_refund_id ||
    incoming.active_refund_id
  )
    throw new Error("Reverse refund relationships before pairing a transfer.");
  if (outgoing.active_transfer_id || incoming.active_transfer_id)
    throw new Error(
      "Reverse an existing pair before choosing these transactions.",
    );
  if (
    minorPence(outgoing.invoice_allocated_pence) !== 0 ||
    minorPence(incoming.invoice_allocated_pence) !== 0
  )
    throw new Error("Reverse invoice allocations before pairing.");
  if (
    outgoing.account_type !== "bank" ||
    (kind === "transfer"
      ? incoming.account_type !== "bank"
      : kind !== "card_repayment" || incoming.account_type !== "credit_card")
  )
    throw new Error(
      "Choose bank-to-bank transfer or bank-to-card repayment as appropriate.",
    );
  return {
    amount,
    removedIncome: minorPence(incoming.recognized_pence),
    removedExpense: minorPence(outgoing.recognized_pence),
  };
}

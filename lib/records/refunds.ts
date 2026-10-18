import { apportionPence } from "../money";
import { minorPence } from "./allocations";
import type { TransferChoice } from "./transfers";
export type RefundChoice = TransferChoice & {
  business_use_bps: number;
  record_type: "income" | "expense" | null;
  effect_sign: number | null;
  category_id: string | null;
  refunded_pence: number | string;
  reduced_pence: number | string;
  refund_count: number;
  refund_stamp: string;
};
export function refundReview(original: RefundChoice, refund: RefundChoice) {
  const gross = Math.abs(minorPence(original.signed_amount_pence)),
    cash = Math.abs(minorPence(refund.signed_amount_pence));
  if (
    original.id === refund.id ||
    original.currency !== "GBP" ||
    refund.currency !== "GBP" ||
    minorPence(original.signed_amount_pence) > 0 ===
      minorPence(refund.signed_amount_pence) > 0
  )
    throw new Error("Choose an opposite-sign GBP refund.");
  if (
    original.import_status === "discarded" ||
    refund.import_status === "discarded" ||
    original.dedupe_status !== "clear" ||
    refund.dedupe_status !== "clear"
  )
    throw new Error("Resolve duplicates and reopen reversed imports first.");
  if (
    original.active_transfer_id ||
    refund.active_transfer_id ||
    original.active_refund_id ||
    refund.active_refund_id ||
    refund.has_refunds
  )
    throw new Error(
      "Reverse existing transfer/refund relationships before linking this refund.",
    );
  if (
    original.record_status !== "approved" ||
    original.effect_sign !== 1 ||
    !["Business", "Mixed"].includes(original.classification) ||
    !original.category_id ||
    !original.record_type ||
    original.business_use_bps < 1 ||
    minorPence(original.recognized_pence) !==
      apportionPence(gross, original.business_use_bps)
  )
    throw new Error("Review the original Business or Mixed payment first.");
  if (minorPence(refund.invoice_allocated_pence) !== 0)
    throw new Error("Reverse allocations on the refund observation first.");
  const refunded = minorPence(original.refunded_pence),
    reduced = minorPence(original.reduced_pence);
  if (refunded + cash > gross)
    throw new Error("Refund exceeds the remaining original payment.");
  const reduction =
    apportionPence(refunded + cash, original.business_use_bps) - reduced;
  if (
    reduction < 0 ||
    reduced + reduction > minorPence(original.recognized_pence)
  )
    throw new Error("Refund exceeds the original recognised amount.");
  return {
    cash,
    reduction,
    type: original.record_type,
    remainingGross: gross - refunded - cash,
    priorReduction: reduced,
    removedIncome:
      refund.record_status === "approved" && refund.record_type === "income"
        ? minorPence(refund.recognized_pence)
        : 0,
    removedExpense:
      refund.record_status === "approved" && refund.record_type === "expense"
        ? minorPence(refund.recognized_pence)
        : 0,
    needsInvoiceCorrection:
      original.record_type === "income" &&
      minorPence(original.invoice_allocated_pence) > 0,
  };
}

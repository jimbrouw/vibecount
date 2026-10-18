import { decimalToPence } from "../money";
import { minorPence } from "../records/allocations";
import { invoiceBalance } from "./credits";
export type RefundAssignmentChoice = {
  id: string;
  credit_id: string;
  credit_number: string;
  credit_pdf_sha256: string;
  allocation_id: string;
  refund_id: string;
  original_transaction_id: string;
  refund_transaction_id: string;
  invoice_id: string;
  invoice_number: string;
  invoice_pence: number | string;
  allocated_pence: number | string;
  credited_pence: number | string;
  returned_pence: number | string;
  credit_remaining_pence: number | string;
  allocation_remaining_pence: number | string;
  refund_remaining_pence: number | string;
};
export function refundAssignmentReview(
  choice: RefundAssignmentChoice,
  input: string,
) {
  const amount = decimalToPence(input),
    gross = minorPence(choice.invoice_pence),
    credits = minorPence(choice.credited_pence),
    receipts = minorPence(choice.allocated_pence),
    returns = minorPence(choice.returned_pence);
  const capacities = [
    minorPence(choice.credit_remaining_pence),
    minorPence(choice.allocation_remaining_pence),
    minorPence(choice.refund_remaining_pence),
    receipts - returns,
    credits - returns,
  ];
  if (amount === null || amount <= 0 || capacities.some((n) => n < amount))
    throw new Error(
      "Choose an exact positive amount within the remaining credit, original receipt allocation and recorded refund.",
    );
  return {
    amount,
    before: invoiceBalance(gross, credits, receipts, returns),
    after: invoiceBalance(gross, credits, receipts, returns + amount),
    refundRemaining: minorPence(choice.refund_remaining_pence) - amount,
  };
}

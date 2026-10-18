"use client";
import { useState } from "react";
import {
  refundAssignmentReview,
  type RefundAssignmentChoice,
} from "@/lib/invoices/refund-assignments";
import { formatPounds, amountToWords } from "@/lib/invoices/money";
import { approveInvoiceRefund } from "./actions";
type Props = {
  choice: RefundAssignmentChoice;
  stamp: string;
  requestId: string;
  sourceStamp: string;
};
const money = (p: number) => `${formatPounds(p)} (${amountToWords(p)})`;
export default function RefundAssignmentReview(props: Props) {
  return <Review key={JSON.stringify(props)} {...props} />;
}
function Review({ choice, stamp, requestId, sourceStamp }: Props) {
  const [amount, setAmount] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  let review = null,
    problem = "";
  try {
    review = refundAssignmentReview(choice, amount);
  } catch (error) {
    problem = error instanceof Error ? error.message : "Check the assignment.";
  }
  return (
    <form
      action={approveInvoiceRefund}
      data-testid="refund-assignment-review"
      className="space-y-3"
    >
      <input type="hidden" name="sourceStamp" value={sourceStamp} />
      <input type="hidden" name="creditId" value={choice.credit_id} />
      <input type="hidden" name="allocationId" value={choice.allocation_id} />
      <input type="hidden" name="refundId" value={choice.refund_id} />
      <input type="hidden" name="stamp" value={stamp} />
      <input type="hidden" name="requestId" value={requestId} />
      <p>
        Invoice {choice.invoice_number} · credit {choice.credit_number}. This
        uses recorded cash returned against its original receipt allocation.
      </p>
      <label className="block">
        Amount to match in pounds
        <input
          data-testid="refund-assignment-amount"
          className="block rounded border p-2"
          name="amount"
          inputMode="decimal"
          value={amount}
          required
          onChange={(e) => {
            setAmount(e.target.value);
            setConfirmed(false);
          }}
        />
      </label>
      {review ? (
        <section
          data-testid="refund-assignment-effects"
          className="space-y-2 rounded border p-3"
          aria-label="Assignment effects"
        >
          <p>
            Invoice entitlement stays {money(review.before.entitlement)}. The
            original credit and receipt allocation remain in history.
          </p>
          <p>
            Match returned cash {money(review.amount)}. Unassigned refund
            afterwards: {money(review.refundRemaining)}.
          </p>
          <p>
            Retained cash {money(review.before.retained)} →{" "}
            {money(review.after.retained)}; outstanding{" "}
            {money(review.before.outstanding)} →{" "}
            {money(review.after.outstanding)}; cash to reconcile{" "}
            {money(review.before.refundDue)} → {money(review.after.refundDue)}.
          </p>
          <p>
            Recognised income/expense change: {money(0)}. The refund already has
            its accounting effect. No money moves. Pending reminders are
            discarded. Reverse this assignment before its receipt allocation,
            credit, refund group or source import.
          </p>
        </section>
      ) : (
        <p role="status">{problem}</p>
      )}
      <label className="block">
        Reason
        <input
          data-testid="refund-assignment-reason"
          name="reason"
          required
          maxLength={1000}
          className="block w-full rounded border p-2"
          onChange={() => setConfirmed(false)}
        />
      </label>
      <label className="block">
        <input
          data-testid="refund-assignment-confirm"
          name="humanConfirmed"
          type="checkbox"
          value="yes"
          checked={confirmed}
          required
          disabled={!review}
          onChange={(e) => setConfirmed(e.target.checked)}
        />{" "}
        I reviewed the recorded refund, original receipt, credit and exact
        balance changes.
      </label>
      <button
        data-testid="refund-assignment-submit"
        className="rounded border p-2"
        disabled={!review || !confirmed}
      >
        Approve refund assignment
      </button>
    </form>
  );
}

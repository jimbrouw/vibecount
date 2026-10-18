"use client";
import { useState } from "react";
import { invoiceBalance } from "@/lib/invoices/credits";
import { minorPence } from "@/lib/records/allocations";
import { formatPounds, amountToWords } from "@/lib/invoices/money";
import { reverseInvoiceRefund } from "./actions";
type Props = {
  id: string;
  amount: number | string;
  stamp: string;
  requestId: string;
  invoice: {
    invoice_pence: number | string;
    credited_pence: number | string;
    allocated_pence: number | string;
    returned_pence: number | string;
  };
};
export default function AssignmentReversal(props: Props) {
  return <Review key={JSON.stringify(props)} {...props} />;
}
function Review({ id, amount, stamp, requestId, invoice }: Props) {
  const [confirmed, setConfirmed] = useState(false),
    p = minorPence(amount),
    returns = minorPence(invoice.returned_pence),
    gross = minorPence(invoice.invoice_pence),
    credits = minorPence(invoice.credited_pence),
    receipts = minorPence(invoice.allocated_pence);
  const before = invoiceBalance(gross, credits, receipts, returns),
    after = invoiceBalance(gross, credits, receipts, returns - p);
  const money = (n: number) => `${formatPounds(n)} (${amountToWords(n)})`;
  return (
    <form
      action={reverseInvoiceRefund}
      className="space-y-3"
      data-testid={`refund-assignment-reversal-${id}`}
    >
      <input type="hidden" name="assignmentId" value={id} />
      <input type="hidden" name="stamp" value={stamp} />
      <input type="hidden" name="requestId" value={requestId} />
      <p>
        Unmatch {money(p)}. Retained cash {money(before.retained)} →{" "}
        {money(after.retained)}; outstanding {money(before.outstanding)} →{" "}
        {money(after.outstanding)}; cash to reconcile {money(before.refundDue)}{" "}
        → {money(after.refundDue)}. The original receipt, credit and refund stay
        approved. No income/expense posting or cash movement; pending reminders
        are discarded.
      </p>
      <label className="block">
        Reversal reason
        <input
          name="reason"
          data-testid="assignment-reversal-reason"
          required
          maxLength={1000}
          className="block w-full rounded border p-2"
          onChange={() => setConfirmed(false)}
        />
      </label>
      <label className="block">
        <input
          name="humanConfirmed"
          data-testid="assignment-reversal-confirm"
          value="yes"
          type="checkbox"
          required
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />{" "}
        I reviewed and confirm this assignment reversal.
      </label>
      <button
        data-testid="assignment-reversal-submit"
        className="rounded border p-2"
        disabled={!confirmed}
      >
        Reverse refund assignment
      </button>
    </form>
  );
}

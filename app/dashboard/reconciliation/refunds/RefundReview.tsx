"use client";
import { useState } from "react";
import { formatPounds, amountToWords } from "@/lib/invoices/money";
import { refundReview, type RefundChoice } from "@/lib/records/refunds";
import { approveRefund } from "./actions";
export default function RefundReview(props: {
  original: RefundChoice;
  refund: RefundChoice;
  requestId: string;
}) {
  return <Review key={JSON.stringify(props)} {...props} />;
}
function Review({
  original,
  refund,
  requestId,
}: {
  original: RefundChoice;
  refund: RefundChoice;
  requestId: string;
}) {
  const [confirmed, setConfirmed] = useState(false);
  let review;
  try {
    review = refundReview(original, refund);
  } catch (error) {
    return (
      <p role="alert">
        {error instanceof Error
          ? error.message
          : "Refund is unavailable for approval."}
      </p>
    );
  }
  const money = (p: number) => `${formatPounds(p)} (${amountToWords(p)})`;
  return (
    <form
      action={approveRefund}
      data-testid="refund-review"
      className="space-y-4 rounded-xl border p-4"
    >
      <input type="hidden" name="original" value={original.id} />
      <input type="hidden" name="refund" value={refund.id} />
      <input
        type="hidden"
        name="originalVersion"
        value={original.decision_version}
      />
      <input
        type="hidden"
        name="refundVersion"
        value={refund.decision_version}
      />
      <input type="hidden" name="stamp" value={original.refund_stamp} />
      <input type="hidden" name="requestId" value={requestId} />
      <h2 className="font-semibold">Review refund accounting</h2>
      <p>
        Original: {original.account_label} ending {original.account_mask} ·{" "}
        {original.transaction_date} · {original.description}.{" "}
        <a
          className="underline"
          href={`/dashboard/imports?import=${original.import_id}`}
        >
          Original source
        </a>
      </p>
      <p>
        Refund: {refund.account_label} ending {refund.account_mask} ·{" "}
        {refund.transaction_date} · {refund.description}.{" "}
        <a
          className="underline"
          href={`/dashboard/imports?import=${refund.import_id}`}
        >
          Refund source
        </a>
      </p>
      <p data-testid="refund-readback">
        Refunded cash: {money(review.cash)}. Reduce{" "}
        {review.type === "expense" ? "expenses" : "income"} by{" "}
        {money(review.reduction)} in the refund date&apos;s tax year, using{" "}
        {original.business_use_bps / 100}% business use from the original.
        Original payment and prior-year records stay intact. Remaining
        refundable cash: {money(review.remainingGross)}.
      </p>
      <p>
        Remove any previous interpretation of this refund observation: income{" "}
        {money(review.removedIncome)}, expenses {money(review.removedExpense)}.
        Earlier reductions on this original total {money(review.priorReduction)}
        .
      </p>
      {review.reduction === 0 && (
        <p>
          No business reduction rounds to a penny for this partial refund. The
          cash/source link is retained without a new approved posting.
        </p>
      )}
      {review.needsInvoiceCorrection && (
        <p role="status" data-testid="refund-invoice-correction">
          The original receipt has invoice allocations. This reduces recognised
          income only; invoice settlement history stays intact.
          Credit-note/correction review remains unresolved.
        </p>
      )}
      <label className="block">
        Evidence and reason
        <input
          name="reason"
          data-testid="refund-reason"
          required
          maxLength={1000}
          className="block w-full rounded border p-2"
          onChange={() => setConfirmed(false)}
        />
      </label>
      <label className="block">
        <input
          type="checkbox"
          data-testid="refund-confirm"
          name="humanConfirmed"
          value="yes"
          required
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />{" "}
        I checked both sources and the exact reduction above.
      </label>
      <button
        data-testid="refund-approve"
        disabled={!confirmed}
        className="rounded border p-2"
      >
        Approve refund reduction
      </button>
    </form>
  );
}

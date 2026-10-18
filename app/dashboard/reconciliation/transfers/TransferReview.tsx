"use client";
import { useState } from "react";
import { formatPounds, amountToWords } from "@/lib/invoices/money";
import {
  transferReview,
  type TransferChoice,
  type TransferKind,
} from "@/lib/records/transfers";
import { approveTransfer } from "./actions";
type Props = {
  outgoing: TransferChoice;
  incoming: TransferChoice;
  requestId: string;
};
export default function TransferReview(props: Props) {
  return <PairForm key={JSON.stringify(props)} {...props} />;
}
function PairForm({ outgoing, incoming, requestId }: Props) {
  const [kind, setKind] = useState<TransferKind>(
      incoming.account_type === "credit_card" ? "card_repayment" : "transfer",
    ),
    [confirmed, setConfirmed] = useState(false);
  let review: ReturnType<typeof transferReview> | null = null,
    error = "";
  try {
    review = transferReview(outgoing, incoming, kind);
  } catch (e) {
    error = e instanceof Error ? e.message : "Review both transactions.";
  }
  return (
    <form
      action={approveTransfer}
      data-testid="transfer-review-form"
      className="space-y-4"
    >
      <input type="hidden" name="outgoing" value={outgoing.id} />
      <input type="hidden" name="incoming" value={incoming.id} />
      <input
        type="hidden"
        name="outgoingVersion"
        value={outgoing.decision_version}
      />
      <input
        type="hidden"
        name="incomingVersion"
        value={incoming.decision_version}
      />
      <input type="hidden" name="requestId" value={requestId} />
      <label className="block" htmlFor="transfer-kind">
        Movement type
        <select
          id="transfer-kind"
          name="kind"
          value={kind}
          data-testid="transfer-kind"
          onChange={(e) => {
            setKind(e.target.value as TransferKind);
            setConfirmed(false);
          }}
          className="ml-2 rounded border p-2"
        >
          <option value="transfer">Bank-to-bank transfer</option>
          <option value="card_repayment">Bank-to-credit-card repayment</option>
        </select>
      </label>
      {error && (
        <p role="alert" data-testid="transfer-validation">
          {error}
        </p>
      )}
      {review && (
        <section
          className="rounded border bg-green-50 p-3"
          data-testid="transfer-readback"
          aria-label="Transfer read-back"
        >
          <p>
            Money out: {outgoing.account_label} ending {outgoing.account_mask},{" "}
            {outgoing.transaction_date}: {formatPounds(review.amount)} (
            {amountToWords(review.amount)}).
          </p>
          <p>
            Money in: {incoming.account_label} ending {incoming.account_mask},{" "}
            {incoming.transaction_date}: {formatPounds(review.amount)} (
            {amountToWords(review.amount)}).
          </p>
          <p>
            Remove currently approved income of{" "}
            {formatPounds(review.removedIncome)} (
            {amountToWords(review.removedIncome)}) and expenses of{" "}
            {formatPounds(review.removedExpense)} (
            {amountToWords(review.removedExpense)}). Both sides will be marked
            Transfer with £0.00 (zero pounds) income and £0.00 (zero pounds)
            expense effect.
          </p>
          {kind === "card_repayment" && (
            <p>
              This pairs the card repayment only. Purchases on that card retain
              their separate review decisions.
            </p>
          )}
        </section>
      )}
      <label className="block" htmlFor="transfer-reason">
        Reason and evidence for this pair
        <input
          id="transfer-reason"
          name="reason"
          required
          maxLength={1000}
          data-testid="transfer-reason"
          onChange={() => setConfirmed(false)}
          className="mt-1 block w-full rounded border p-2"
        />
      </label>
      <label className="flex gap-2">
        <input
          type="checkbox"
          required
          name="humanConfirmed"
          value="yes"
          checked={confirmed}
          disabled={!review}
          data-testid="transfer-confirm"
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I confirm these are movements between my own accounts/card and approve
        the effects above.
      </label>
      <button
        type="submit"
        disabled={!review || !confirmed}
        className="rounded bg-[#14532d] px-4 py-2 text-white disabled:opacity-50"
        data-testid="transfer-submit"
      >
        Approve pair
      </button>
    </form>
  );
}

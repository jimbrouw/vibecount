import Link from "next/link";
import { randomUUID } from "node:crypto";
import { formatPounds, amountToWords } from "@/lib/invoices/money";
import { minorPence } from "@/lib/records/allocations";
import { reverseTransfer } from "./actions";
type Relation<T> = T | T[] | null;
type Side = {
  transaction_date: string;
  description: string;
  import_id: string;
  financial_accounts: Relation<{ label: string; masked_identifier: string }>;
};
export type ActivePairSummary = {
  id: string;
  kind: string;
  amount_pence: number | string;
  outgoing: Relation<Side>;
  incoming: Relation<Side>;
};
const one = <T,>(value: Relation<T>) =>
  Array.isArray(value) ? (value[0] ?? null) : value;
export default function ActiveTransferPair({
  pair, nativeScopeAvailable,
}: {
  pair: ActivePairSummary; nativeScopeAvailable: boolean;
}) {
  const outgoing = one(pair.outgoing),
    incoming = one(pair.incoming),
    outAccount = outgoing && one(outgoing.financial_accounts),
    inAccount = incoming && one(incoming.financial_accounts);
  if (!outgoing || !incoming || !outAccount || !inAccount)
    return (
      <p role="alert">
        Complete pair evidence is unavailable. Reload before reversing this
        pair.
      </p>
    );
  return (
    <details
      className="rounded border p-3"
      data-testid={`transfer-pair-${pair.id}`}
    >
      <summary>
        {!nativeScopeAvailable ? "Retained native GBP pair" : pair.kind === "card_repayment" ? "Card repayment" : "Bank transfer"} ·{" "}
        {outAccount.label} to {inAccount.label} ·{" "}
        {formatPounds(minorPence(pair.amount_pence))}
      </summary>
      <p className="my-2">
        Money out: {outAccount.label} ending {outAccount.masked_identifier} ·{" "}
        {outgoing.transaction_date} · {outgoing.description}.{" "}
        <Link
          className="underline"
          data-testid={`transfer-out-source-${pair.id}`}
          href={`/dashboard/imports?import=${outgoing.import_id}`}
        >
          Review outgoing source
        </Link>
      </p>
      <p className="my-2">
        Money in: {inAccount.label} ending {inAccount.masked_identifier} ·{" "}
        {incoming.transaction_date} · {incoming.description}.{" "}
        <Link
          className="underline"
          data-testid={`transfer-in-source-${pair.id}`}
          href={`/dashboard/imports?import=${incoming.import_id}`}
        >
          Review incoming source
        </Link>
      </p>
      {!nativeScopeAvailable && <p role="status" data-testid={`transfer-reverse-withheld-${pair.id}`}>Native reversal controls are withheld because a connected source needs currency or representation review. Retained pair amounts and source history remain available.</p>}
      {nativeScopeAvailable && <form
        action={reverseTransfer}
        data-testid={`transfer-reverse-${pair.id}`}
        className="space-y-3"
      >
        <input type="hidden" name="pairId" value={pair.id} />
        <input type="hidden" name="requestId" value={randomUUID()} />
        <p>
          Reverse this {formatPounds(minorPence(pair.amount_pence))} (
          {amountToWords(minorPence(pair.amount_pence))}) pair between the
          accounts above. Both transactions will become Unknown with zero
          recognised amount until reviewed again. Previous income/expenses will
          not be restored.
        </p>
        <label className="block" htmlFor={`transfer-reverse-reason-${pair.id}`}>
          Reason
          <input
            id={`transfer-reverse-reason-${pair.id}`}
            name="reason"
            required
            maxLength={1000}
            className="ml-2 rounded border p-2"
            data-testid={`transfer-reverse-reason-${pair.id}`}
          />
        </label>
        <label className="flex gap-2">
          <input
            type="checkbox"
            name="humanConfirmed"
            value="yes"
            required
            data-testid={`transfer-reverse-confirm-${pair.id}`}
          />
          I confirm both sides above should return to unresolved review.
        </label>
        <button
          className="rounded border px-3 py-2"
          type="submit"
          data-testid={`transfer-reverse-submit-${pair.id}`}
        >
          Reverse pair
        </button>
      </form>}
    </details>
  );
}

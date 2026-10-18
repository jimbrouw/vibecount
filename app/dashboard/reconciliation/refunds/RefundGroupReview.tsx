"use client";
import { useState } from "react";
import { formatPounds, amountToWords } from "@/lib/invoices/money";
import { minorPence } from "@/lib/records/allocations";
import type { RefundChoice } from "@/lib/records/refunds";
import { reverseRefundGroup } from "./actions";
export type RefundMember = {
  id: string;
  original_transaction_id: string;
  amount_pence: number | string;
  recognized_pence: number | string;
  refund:
    | {
        transaction_date: string;
        description: string;
        import_id: string;
        financial_accounts:
          | { label: string; masked_identifier: string }
          | { label: string; masked_identifier: string }[]
          | null;
      }
    | {
        transaction_date: string;
        description: string;
        import_id: string;
        financial_accounts:
          | { label: string; masked_identifier: string }
          | { label: string; masked_identifier: string }[]
          | null;
      }[]
    | null;
};
const one = <T,>(v: T | T[] | null) => (Array.isArray(v) ? (v[0] ?? null) : v);
export default function RefundGroupReview(props: {
  original: RefundChoice;
  members: RefundMember[];
  requestId: string;
}) {
  return <Group key={JSON.stringify(props)} {...props} />;
}
function Group({
  original,
  members,
  requestId,
}: {
  original: RefundChoice;
  members: RefundMember[];
  requestId: string;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const money = (p: number) => `${formatPounds(p)} (${amountToWords(p)})`;
  if (
    members.length !== original.refund_count ||
    members.some((m) => {
      const tx = one(m.refund);
      return !tx || !one(tx.financial_accounts);
    })
  )
    return (
      <p role="alert">
        Complete refund-group evidence is unavailable. Reload before reversing.
      </p>
    );
  return (
    <form
      action={reverseRefundGroup}
      data-testid={`refund-group-reverse-${original.id}`}
      className="space-y-3"
    >
      <input type="hidden" name="original" value={original.id} />
      <input type="hidden" name="stamp" value={original.refund_stamp} />
      <input type="hidden" name="requestId" value={requestId} />
      <p>
        Any invoice refund assignments must be reversed first.{" "}
        <a
          className="underline"
          href="/dashboard/reconciliation/refund-assignments"
        >
          Review matched returned cash and its balance effects
        </a>
        .
      </p>
      <p>
        Reverse all {original.refund_count} links: cash{" "}
        {money(minorPence(original.refunded_pence))}; remove{" "}
        {original.record_type === "expense" ? "expense" : "income"} reductions
        of {money(minorPence(original.reduced_pence))}. Every refund below
        becomes Unknown, including other imports. The original payment stays
        approved.
      </p>
      <ul>
        {members.map((m) => {
          const tx = one(m.refund)!,
            a = one(tx.financial_accounts);
          return (
            <li key={m.id} className="my-2">
              {a?.label ?? "Account unavailable"} ending{" "}
              {a?.masked_identifier ?? "?"} · {tx.transaction_date} ·{" "}
              {tx.description} · cash {money(minorPence(m.amount_pence))};
              reduction {money(minorPence(m.recognized_pence))}.{" "}
              <a
                className="underline"
                href={`/dashboard/imports?import=${tx.import_id}`}
              >
                Refund source
              </a>
            </li>
          );
        })}
      </ul>
      <a
        className="underline"
        href={`/dashboard/imports?import=${original.import_id}`}
      >
        Original source
      </a>
      <label className="block">
        Reason
        <input
          data-testid="refund-group-reason"
          name="reason"
          required
          maxLength={1000}
          className="block rounded border p-2"
          onChange={() => setConfirmed(false)}
        />
      </label>
      <label className="block">
        <input
          data-testid="refund-group-confirm"
          name="humanConfirmed"
          type="checkbox"
          value="yes"
          required
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />{" "}
        I reviewed all listed refunds and confirm the group reversal.
      </label>
      <button
        data-testid="refund-group-submit"
        disabled={!confirmed}
        className="rounded border p-2"
      >
        Reverse all related refunds
      </button>
    </form>
  );
}

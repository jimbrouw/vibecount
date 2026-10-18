"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { creditReview, type CreditBalance } from "@/lib/invoices/credits";
import { decimalToPence } from "@/lib/money";
import { formatPounds, amountToWords } from "@/lib/invoices/money";

export type CreditParties = {
  sellerName: string;
  sellerAddress: string;
  clientName: string;
  clientAddress: string;
};
const money = (p: number) => `${formatPounds(p)} (${amountToWords(p)})`;
export default function CreditReview(props: {
  invoice: CreditBalance;
  parties: CreditParties;
  today: string;
  requestId: string;
}) {
  return <Review key={JSON.stringify(props)} {...props} />;
}
function Review({
  invoice,
  parties,
  today,
  requestId,
}: {
  invoice: CreditBalance;
  parties: CreditParties;
  today: string;
  requestId: string;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState(parties);
  const [confirmed, setConfirmed] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const retry = useRef({ key: "", id: requestId });
  let review = null,
    problem = "";
  try {
    review = creditReview(invoice, decimalToPence(amount) ?? 0, date, today);
  } catch (error) {
    problem = error instanceof Error ? error.message : "Check the credit.";
  }
  const valid =
    review &&
    reason.trim() &&
    details.sellerName.trim() &&
    details.clientName.trim() &&
    (review.known || unknown);
  return (
    <form
      data-testid="credit-review-form"
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!confirmed || !valid || busy) return;
        const payload = {
          invoiceId: invoice.id,
          stamp: invoice.balance_stamp,
          amount,
          creditDate: date,
          reason,
          ...details,
          unknownVatAcknowledged: unknown,
          humanConfirmed: true,
        };
        const key = JSON.stringify(payload);
        if (retry.current.key && retry.current.key !== key)
          retry.current.id = crypto.randomUUID();
        retry.current.key = key;
        setBusy(true);
        setMessage("");
        try {
          const response = await fetch("/api/reconciliation/credits", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, requestId: retry.current.id }),
          });
          if (!response.ok) {
            const result = await response.json();
            throw new Error(result.error || "Could not approve the credit.");
          }
          const blob = await response.blob();
          const url = URL.createObjectURL(blob),
            link = document.createElement("a");
          link.href = url;
          link.download = `credit-${retry.current.id}.pdf`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          setMessage(
            "Credit approved. Review the preserved draft PDF before sending. No cash refund was made.",
          );
          setConfirmed(false);
          router.refresh();
        } catch (error) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Credit response unavailable. Retry the unchanged review to recover its result.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset
        disabled={busy}
        className="space-y-3"
        onChange={() => {
          setConfirmed(false);
          setMessage("");
        }}
      >
        <legend className="text-lg font-semibold">
          Review credit for {invoice.number}
        </legend>
        <p>
          Current business and client details below are suggestions. Check them
          against the original supply. The original invoice VAT treatment is
          preserved.
        </p>
        {(
          [
            ["sellerName", "Supplier name"],
            ["sellerAddress", "Supplier address"],
            ["clientName", "Customer name"],
            ["clientAddress", "Customer address"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block">
            {label}
            <input
              className="block w-full rounded border p-2"
              data-testid={`credit-${key}`}
              required={key.endsWith("Name")}
              maxLength={key.endsWith("Name") ? 200 : 1000}
              value={details[key]}
              onChange={(e) =>
                setDetails({ ...details, [key]: e.target.value })
              }
            />
          </label>
        ))}
        <label className="block">
          Credit amount in pounds
          <input
            data-testid="credit-amount"
            className="block rounded border p-2"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="block">
          Credit date
          <input
            data-testid="credit-date"
            className="block rounded border p-2"
            type="date"
            min={invoice.invoice_date}
            max={today}
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="block">
          Reason for credit
          <textarea
            data-testid="credit-reason"
            className="block w-full rounded border p-2"
            required
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {!review && <p role="status">{problem}</p>}
        {review && (
          <section
            data-testid="credit-effects"
            aria-label="Credit effects"
            className="space-y-2 rounded border p-4"
          >
            <p>Total credit: {money(review.gross)}.</p>
            {review.known ? (
              <p>
                Net: {money(review.net!)}. VAT: {money(review.vat!)} at{" "}
                {(invoice.vat_rate_bps ?? 0) / 100}% from the original invoice.
              </p>
            ) : (
              <>
                <p>
                  Original net/VAT breakdown is unresolved. This is not a credit
                  note for VAT.
                </p>
                <label className="block">
                  <input
                    data-testid="credit-unknown-vat"
                    type="checkbox"
                    checked={unknown}
                    onChange={(e) => setUnknown(e.target.checked)}
                  />{" "}
                  I acknowledge this is a commercial credit only and VAT still
                  needs review.
                </label>
              </>
            )}
            <p>
              Invoice entitlement: {money(review.before.entitlement)} →{" "}
              {money(review.after.entitlement)}.
            </p>
            <p>
              Outstanding: {money(review.before.outstanding)} →{" "}
              {money(review.after.outstanding)}.
            </p>
            <p>
              Cash to reconcile after credit: {money(review.before.refundDue)} →{" "}
              {money(review.after.refundDue)}. Already matched returned cash is
              included. Unassigned refunds still need review; this is not a
              payment instruction.
            </p>
            <p>
              Recognised income/expense change: {money(0)}. No money moves. A
              bank refund is reviewed separately. Pending reminders are
              discarded and scheduling stops for fresh review.
            </p>
          </section>
        )}
      </fieldset>
      <label className="block">
        <input
          data-testid="credit-confirm"
          type="checkbox"
          checked={confirmed}
          disabled={!valid || busy}
          onChange={(e) => setConfirmed(e.target.checked)}
        />{" "}
        I reviewed the details, exact credit and balance changes and confirm
        this credit.
      </label>
      <button
        data-testid="credit-submit"
        className="rounded border p-2"
        disabled={!confirmed || !valid || busy}
      >
        {busy ? "Preserving credit…" : "Approve credit and download draft PDF"}
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}

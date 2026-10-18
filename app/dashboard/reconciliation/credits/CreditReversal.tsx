"use client";
import { useState } from "react";
import { invoiceBalance, type CreditBalance } from "@/lib/invoices/credits";
import { minorPence } from "@/lib/records/allocations";
import { formatPounds, amountToWords } from "@/lib/invoices/money";
import { reverseCredit } from "./actions";
type Props = {
  creditId: string;
  gross: number | string;
  invoice: CreditBalance;
  requestId: string;
};
export default function CreditReversal(props: Props) {
  return <Review key={JSON.stringify(props)} {...props} />;
}
function Review({ creditId, gross, invoice, requestId }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const before = invoiceBalance(
    minorPence(invoice.invoice_pence),
    minorPence(invoice.credited_pence),
    minorPence(invoice.allocated_pence),
    minorPence(invoice.returned_pence ?? 0),
  );
  const after = invoiceBalance(
    minorPence(invoice.invoice_pence),
    minorPence(invoice.credited_pence) - minorPence(gross),
    minorPence(invoice.allocated_pence),
    minorPence(invoice.returned_pence ?? 0),
  );
  const money = (p: number) => `${formatPounds(p)} (${amountToWords(p)})`;
  return (
    <form
      action={reverseCredit}
      data-testid={`credit-reversal-${creditId}`}
      className="space-y-3"
    >
      <input type="hidden" name="creditId" value={creditId} />
      <input type="hidden" name="stamp" value={invoice.balance_stamp} />
      <input type="hidden" name="requestId" value={requestId} />
      <p>
        Reverse credit of {money(minorPence(gross))}. Entitlement{" "}
        {money(before.entitlement)} → {money(after.entitlement)}; outstanding{" "}
        {money(before.outstanding)} → {money(after.outstanding)}; cash to
        reconcile {money(before.refundDue)} → {money(after.refundDue)}. No
        income/expense posting or cash movement. Credit evidence remains;
        pending reminders are discarded.
      </p>
      <label className="block">
        Reversal reason
        <input
          data-testid="credit-reversal-reason"
          name="reason"
          required
          maxLength={1000}
          className="block w-full rounded border p-2"
          onChange={() => setConfirmed(false)}
        />
      </label>
      <label className="block">
        <input
          data-testid="credit-reversal-confirm"
          name="humanConfirmed"
          value="yes"
          type="checkbox"
          required
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />{" "}
        I reviewed and confirm this reversal.
      </label>
      <button
        data-testid="credit-reversal-submit"
        className="rounded border p-2"
        disabled={!confirmed}
      >
        Reverse latest active credit
      </button>
    </form>
  );
}

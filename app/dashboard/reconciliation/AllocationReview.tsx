"use client";
import { useState } from "react";
import { allocationReview, minorPence, type InvoiceBalance, type ReceiptBalance, } from "@/lib/records/allocations";
import { formatPounds, amountToWords } from "@/lib/invoices/money";
import type { MatchProposal } from "@/lib/records/match-proposals";
import { approveAllocations } from "./actions";
type AllocationProps = {
    receipt: ReceiptBalance;
    invoices: InvoiceBalance[];
    requestId: string;
    proposals?: MatchProposal[];
};
export default function AllocationReview(props: AllocationProps) {
    // Navigation/refresh may reuse this component. Any changed snapshot requires fresh input and confirmation.
    return (<AllocationForm key={JSON.stringify([props.receipt, props.invoices, props.requestId, props.proposals])} {...props}/>);
}
function AllocationForm({ receipt, invoices, requestId, proposals = [], }: AllocationProps) {
    const [amounts, setAmounts] = useState<Record<string, string>>({});
    const [confirmed, setConfirmed] = useState(false);
    let review: ReturnType<typeof allocationReview> | null = null;
    let error = "";
    try {
        review = allocationReview(receipt, invoices, amounts);
    }
    catch (e) {
        error = e instanceof Error ? e.message : "Review the allocation amounts.";
    }
    return (<form action={approveAllocations} data-testid="allocation-review-form" className="space-y-4">
      <input type="hidden" name="transactionId" value={receipt.id}/>
      <input type="hidden" name="version" value={receipt.decision_version}/>
      <input type="hidden" name="expectedAllocated" value={receipt.allocated_pence}/>
      <input type="hidden" name="requestId" value={requestId}/>
      <input type="hidden" name="allocations" value={JSON.stringify(review?.rows.map(({ invoice_id, invoice_updated_at, amount_pence }) => ({
            invoice_id,
            invoice_updated_at,
            amount_pence,
        })) ?? [])}/>
      <p>
        Receipt: {formatPounds(minorPence(receipt.signed_amount_pence))} (
        {amountToWords(minorPence(receipt.signed_amount_pence))}). Already
        allocated: {formatPounds(minorPence(receipt.allocated_pence))}.
        Available to match:{" "}
        {formatPounds(minorPence(receipt.unallocated_pence))}.
      </p>
      <p className="text-sm">
        Matching uses the approved receipt already in your records. It adds no
        income. Leave an amount blank to skip that invoice.
      </p>
      {proposals.length > 0 && <section data-testid="allocation-proposals" aria-label="Suggested matches" className="space-y-3 rounded border p-3"><h3 className="font-semibold">Suggested matches — review required</h3><p>These are evidence rankings, not probabilities or approvals. Selecting one fills a draft and replaces the current draft amounts. It never submits a match.</p>{proposals.map(proposal => { const invoice = invoices.find(i => i.id === proposal.invoice_id); return invoice && <article key={proposal.invoice_id} data-testid={'match-proposal-' + proposal.invoice_id} className="rounded border p-3"><p>Invoice {invoice.number}: {formatPounds(proposal.amount_pence)} ({amountToWords(proposal.amount_pence)}) — {proposal.ambiguous ? 'Ambiguous alternatives' : proposal.strength === 'strong' ? 'Stronger matching evidence' : 'Manual review needed'}</p><p>Client: {invoice.client_name || 'Not recorded'} · invoice date: {invoice.invoice_date ?? 'Not recorded'}</p><ul>{[...proposal.reasons, ...proposal.warnings].map((reason, index) => <li key={index}>{reason}</li>)}</ul><button type="button" data-testid={'match-use-' + proposal.invoice_id} className="mt-2 rounded border px-3 py-2" onClick={() => { setAmounts({ [invoice.id]: `${Math.floor(proposal.amount_pence / 100)}.${String(proposal.amount_pence % 100).padStart(2, '0')}` }); setConfirmed(false); }}>Use suggestion as draft</button></article>; })}<p className="text-sm">Matching rules {proposals[0].rules_version}. Check the source reference, payer and current balances before confirming.</p></section>}
      <div className="space-y-3">
        {invoices.map((invoice) => (<label key={invoice.id} htmlFor={`allocate-${invoice.id}`} className="block rounded border p-3">
            Invoice {invoice.number} · outstanding{" "}
            {formatPounds(minorPence(invoice.outstanding_pence))}
            <input id={`allocate-${invoice.id}`} data-testid={`allocation-amount-${invoice.id}`} type="text" inputMode="decimal" className="mt-1 block rounded border p-2" aria-label={`Amount to allocate to invoice ${invoice.number} in pounds`} value={amounts[invoice.id] ?? ""} onChange={(e) => {
                setAmounts({ ...amounts, [invoice.id]: e.target.value });
                setConfirmed(false);
            }}/>
          </label>))}
      </div>
      {error && (<p role="status" data-testid="allocation-validation">
          {error}
        </p>)}
      {review && (<section data-testid="allocation-readback" aria-label="Allocation read-back" className="rounded border bg-green-50 p-3">
          <ul>
            {review.rows.map((row) => (<li key={row.invoice_id}>
                Invoice {row.number}: match {formatPounds(row.amount_pence)} (
                {amountToWords(row.amount_pence)}); outstanding afterwards{" "}
                {formatPounds(row.remaining_pence)} (
                {amountToWords(row.remaining_pence)}).
              </li>))}
          </ul>
          <p>
            Total match: {formatPounds(review.total)} (
            {amountToWords(review.total)}). Receipt still unallocated:{" "}
            {formatPounds(review.remaining)} ({amountToWords(review.remaining)}
            ).
          </p>
        </section>)}
      <label className="block" htmlFor="allocation-reason">
        Reason for this match
        <input id="allocation-reason" name="reason" required maxLength={1000} data-testid="allocation-reason" className="mt-1 block w-full rounded border p-2" onChange={() => setConfirmed(false)}/>
      </label>
      <label className="flex gap-2">
        <input type="checkbox" name="humanConfirmed" value="yes" required checked={confirmed} disabled={!review} data-testid="allocation-confirm" onChange={(e) => setConfirmed(e.target.checked)}/>
        I confirm these invoice matches and the remaining amounts above.
      </label>
      <button type="submit" disabled={!review || !confirmed} data-testid="allocation-submit" className="rounded bg-[#14532d] px-4 py-2 text-white disabled:opacity-50">
        Approve invoice matches
      </button>
    </form>);
}

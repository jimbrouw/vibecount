import BankSourceCoverage from '../BankSourceCoverage';
import { BankChoiceWithheld } from '../BankChoiceReadback';
import { fxAmountReadback } from '@/lib/fx/readback';
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatPounds, amountToWords } from "@/lib/invoices/money";
import { minorPence, } from "@/lib/records/allocations";
import { loadMatchData } from "@/lib/records/match-data";
import { proposeInvoiceMatches, receiptQueue, canMatchReceipt } from "@/lib/records/match-proposals";
import { getCurrentTaxYearStart, getTaxYearLabel } from "@/lib/records/tax-periods";
import AllocationReview from "./AllocationReview";
import { reverseAllocation } from "./actions";
export const metadata = { title: "Invoice reconciliation — VibeCount" };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export default async function ReconciliationPage({ searchParams, }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const db = await createClient();
    const { data: { user }, error: authError, } = await db.auth.getUser();
    if (authError || !user)
        redirect("/login");
    const params = await searchParams;
    const id = (key: string) => typeof params[key] === "string" && uuid.test(params[key])
        ? (params[key] as string).toLowerCase()
        : null;
    const selected = id("receipt"), invoiceAfter = id("invoiceAfter"), allocationAfter = id("allocationAfter");
    const enteredYear = Number(params.year), explicitYear = Number.isInteger(enteredYear) && enteredYear >= 2000 && enteredYear <= 2100;
    let year = explicitYear ? enteredYear : getCurrentTaxYearStart();
    let matchData: Awaited<ReturnType<typeof loadMatchData>> | null = null, readError = false;
    try {
        // Existing receipt links and post-approval redirects need to reopen the receipt's own year.
        if (selected && !explicitYear) {
            const chosen = await db.from('bank_transactions').select('transaction_date').eq('user_id', user.id).eq('id', selected).maybeSingle();
            if (chosen.error)
                throw new Error('Receipt year unavailable.');
            if (chosen.data) {
                const date = String(chosen.data.transaction_date);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
                    throw new Error('Invalid receipt date.');
                year = getCurrentTaxYearStart(new Date(date + 'T00:00:00Z'));
            }
        }
        matchData = await loadMatchData(db, user.id, year, selected ? { receipt: selected, after: allocationAfter } : undefined);
    }
    catch {
        readError = true;
    }
    const allocations = { data: matchData?.allocations ?? [] };
    const unavailable = readError;
    const historyView = params.view === 'history', queue = historyView ? (matchData?.receipts ?? []).map(receipt => ({ receipt, kind: 'history' })) : receiptQueue(matchData?.receipts ?? []), pageNumber = Math.max(0, Math.min(100000, Number.isSafeInteger(Number(params.page)) ? Number(params.page) : 0)), visibleReceipts = queue.slice(pageNumber * 50, pageNumber * 50 + 50);
    const allInvoices = matchData?.invoices ?? [], invoiceRows = allInvoices.filter(i => !invoiceAfter || i.id > invoiceAfter).slice(0, 50);
    const receipt = matchData?.receipts.find(r => r.id === selected) ?? null;
    const selectedSource = matchData?.bank_coverage.observations.find(r=>r.id===selected);
    const unsupportedSelection = selectedSource && selectedSource.representation !== 'native_gbp';
    const allProposals = receipt ? proposeInvoiceMatches(receipt, allInvoices) : [], proposals = allProposals.slice(0, 10);
    const proposalIds = new Set(proposals.map(p => p.invoice_id)), reviewInvoices = allInvoices.filter(i => i.currency === 'GBP' && minorPence(i.outstanding_pence) > 0 && (proposalIds.has(i.id) || invoiceRows.some(visible => visible.id === i.id)));
    const queryLink = (extra: Record<string, string>) => `/dashboard/reconciliation?${new URLSearchParams({ year: String(year), ...(historyView ? { view: 'history' } : {}), ...(selected ? { receipt: selected } : {}), ...extra })}`;
    return (<main className="mx-auto max-w-5xl space-y-6 p-5 text-[#17251d]">
      <header>
        <h1 className="text-2xl font-semibold">Invoice reconciliation</h1>
        <p className="mt-2">
          Match approved cash receipts to invoices. Partial payments and
          unallocated receipts stay visible; matching does not add income.
        </p>
        <p className="mt-2 text-sm">
          Legacy “paid” markers are assertions until supported by these
          allocations. Matching here uses stored gross GBP balances. Other currencies require separate FX review.
          Credits reduce entitlement; matched customer refunds reduce retained
          cash. Unsupported FX still needs review.
        </p>
      </header>
      {matchData && <BankSourceCoverage coverage={matchData.bank_coverage}/>}
      {unsupportedSelection && <BankChoiceWithheld sources={[selectedSource]} prefix="matching"/>}
      {selectedSource && !receipt && !unsupportedSelection && <p data-testid="matching-not-receipt">This source is not available as a positive native receipt for invoice matching.</p>}
      {unsupportedSelection && allocations.data.length>0 && <section data-testid="matching-withheld-history"><h2>Retained native match history</h2><p>These historical GBP relationship amounts do not establish current source cash. Native reversal controls are withheld.</p><ul>{allocations.data.map(a=><li key={a.id}>Invoice {a.invoice_number??a.invoice_id}: {fxAmountReadback(minorPence(a.amount_pence),'GBP')}</li>)}</ul></section>}
      <Link href="/dashboard/reconciliation/fx" data-testid="reconciliation-fx-matches-link" className="block underline">Review original-currency FX matches and retained lots</Link>
      <Link href="/dashboard/reconciliation/fx/evidence" data-testid="reconciliation-fx-evidence-link" className="block underline">Review invoice and FX conversion evidence facts</Link>
      <form className="flex gap-3"><label>Receipt tax-year start<input data-testid="matching-year" name="year" type="number" min="2000" max="2100" defaultValue={year} className="ml-2 w-24 rounded border p-2"/></label><button data-testid="matching-year-open" className="rounded border px-3">Open year</button></form>{matchData && <p data-testid="matching-coverage">Receipt queue: {getTaxYearLabel(year)}. Checked {matchData.receipts.length} native GBP year receipts and {allInvoices.length} finalised invoices across all years. Invoice matching does not change receipt tax timing.</p>}
      <Link href="/dashboard/reconciliation/duplicates" data-testid="reconciliation-duplicates-link" className="block underline">
        Review overlapping statement observations
      </Link>
      <Link href="/dashboard/reconciliation/refund-assignments" data-testid="reconciliation-refund-assignments-link" className="mr-4 underline">
        Match recorded customer refunds to credits
      </Link>
      <Link href="/dashboard/reconciliation/credits" data-testid="reconciliation-credits-link" className="mr-4 underline">
        Review invoice credits
      </Link>
      <Link href="/dashboard/reconciliation/refunds" data-testid="reconciliation-refunds-link" className="mr-4 underline">
        Review customer and supplier refunds
      </Link>
      <Link href="/dashboard/reconciliation/transfers" data-testid="reconciliation-transfers-link" className="inline-block underline">
        Review transfers and credit-card repayments
      </Link>
      {typeof params.error === "string" && (<p role="alert" data-testid="reconciliation-error">
          {params.error.slice(0, 300)}
        </p>)}
      {params.result === "allocated" && (<p role="status">
          Invoice matches approved. The receipt remains one income record.
        </p>)}
      {params.result === "reversed" && (<p role="status">
          Allocation reversed. Invoice outstanding is recalculated; the cash
          receipt remains in your records.
        </p>)}
      {unavailable ? (<p role="alert" data-testid="reconciliation-unavailable">
          Complete reconciliation data is unavailable. Reload before relying on
          these balances.
        </p>) : (<>
          <a href="/api/reconciliation/export" data-testid="reconciliation-export" className="inline-block font-semibold underline">
            Export draft reconciliation and balances
          </a>
          <p data-testid="reconciliation-export-scope">The export includes finalised invoice document values, native GBP and FX relationship history, original-unit balances and combined receipt cash. Document values and matching relationships are separate from income and tax calculations.</p>
          <section className="rounded-xl border bg-white p-4">
            <h2 className="text-lg font-semibold">{historyView ? 'Native GBP receipt history' : 'Material unmatched receipts'}</h2>
            <Link data-testid="receipt-queue-mode" className="underline" href={`/dashboard/reconciliation?year=${year}${historyView ? '' : '&view=history'}`}>{historyView ? 'Return to unmatched queue' : 'View native GBP receipt history, including exclusions and resolved matches'}</Link>
            <ul className="mt-3 space-y-3">
              {visibleReceipts.map(({ receipt: row, kind }) => (<li key={row.id}>
                  <Link href={queryLink({ receipt: row.id })} data-testid={`receipt-select-${row.id}`} className="underline">
                    {row.transaction_date} · {row.description} ·{" "}
                    {formatPounds(minorPence(row.signed_amount_pence))}
                  </Link>
                  <p className="text-sm">
                    {(row.active_refund_id || row.classification === 'Refund')
                    ? (row.active_refund_id ? 'Supplier refund — reduces expense; unavailable for invoice matching. Source cash: ' : 'Refund needs original-payment review; source cash: ')
                    : (row.active_transfer_id || row.classification === 'Transfer')
                        ? (row.active_transfer_id ? 'Paired transfer — excluded from income; unavailable for invoice matching. Source cash amount: ' : 'Transfer needs counterpart review; source cash: ')
                        : "Unallocated: "}
                    {formatPounds(minorPence(row.unallocated_pence))} ·{" "}
                    {row.classification} · {row.record_status ?? "Unresolved"} · {kind === 'identity' ? 'Resolve overlapping source identity first' : kind === 'transfer' ? 'Review transfer counterpart' : kind === 'refund' ? 'Review refund/original relationship' : kind === 'classification' ? 'Review source classification before matching' : kind === 'history' ? 'Historical source observation' : 'Approved income awaiting invoice review'}
                    {minorPence(row.refunded_pence ?? 0) > 0 && (<span className="block" data-testid={`receipt-refund-correction-${row.id}`}>
                        Recorded customer refund:{" "}
                        {formatPounds(minorPence(row.refunded_pence ?? 0))}. Original
                        receipt allocations remain historical; invoice
                        credit/correction review is unresolved.
                      </span>)}
                  </p>{['identity', 'transfer', 'refund'].includes(kind) && <Link data-testid={'receipt-relationship-' + row.id} href={kind === 'identity' ? '/dashboard/reconciliation/duplicates' : kind === 'transfer' ? '/dashboard/reconciliation/transfers' : '/dashboard/reconciliation/refunds'} className="underline">Open {kind === 'identity' ? 'source identity' : kind} review</Link>}
                </li>))}
            </ul>
            {!visibleReceipts.length && <p>No receipts on this page.</p>}
            {pageNumber > 0 && (<Link href={queryLink({ page: "0" })} className="mr-3 underline">
                First receipts
              </Link>)}
            {queue.length > (pageNumber + 1) * 50 && (<Link href={queryLink({ page: String(pageNumber + 1) })} data-testid="receipts-next" className="underline">
                More receipts
              </Link>)}
          </section>
          <section className="rounded-xl border bg-white p-4">
            <h2 className="text-lg font-semibold">Invoice balances</h2>
            <ul className="my-3 space-y-2">
              {invoiceRows.map((inv) => (<li key={inv.id}>
                  {inv.currency !== 'GBP' ? <>Invoice {inv.number}: {inv.currency} requires separate FX review; no GBP balance is inferred.</> : <>Invoice {inv.number}: invoiced{" "}
                  {formatPounds(minorPence(inv.invoice_pence))}, allocated{" "}
                  {formatPounds(minorPence(inv.allocated_pence))}, outstanding{" "}
                  {formatPounds(minorPence(inv.outstanding_pence))}. Credited{" "}
                  {formatPounds(minorPence(inv.credited_pence ?? 0))};
                  entitlement{" "}
                  {formatPounds(minorPence(inv.entitlement_pence ?? inv.invoice_pence))}
                  ; cash to reconcile{" "}
                  {formatPounds(minorPence(inv.refund_due_pence ?? 0))}. Matched
                  returns {formatPounds(minorPence(inv.returned_pence ?? 0))};
                  retained cash{" "}
                  {formatPounds(minorPence(inv.retained_cash_pence ?? inv.allocated_pence))}
                  .</>}
                </li>))}
            </ul>
            {invoiceAfter && (<Link href={queryLink({})} className="mr-3 underline">
                First invoices
              </Link>)}
            {allInvoices.filter(i => !invoiceAfter || i.id > invoiceAfter).length > 50 && (<Link href={queryLink({ invoiceAfter: invoiceRows[49].id })} data-testid="invoices-next" className="underline">
                More invoices
              </Link>)}
          </section>
          {selected && !receipt && <p role="alert">Receipt not found.</p>}
          {receipt && (<section className="space-y-4 rounded-xl border bg-white p-4">
              <h2 className="text-lg font-semibold">Review selected receipt</h2><p data-testid="matching-selected-source">{receipt.transaction_date} · {receipt.description}<br />Receipt reference: {receipt.reference || 'None recorded'}. Check the original evidence before using a suggested match.</p>
              <Link href={`/dashboard/imports?import=${receipt.import_id}`} className="underline">
                Review source and classification
              </Link>
              {minorPence(receipt.refunded_pence ?? 0) > 0 && (<p role="status">
                  This receipt has recorded refunds. Matching here preserves the
                  original receipt history and does not resolve invoice
                  credit/correction treatment. Review the refund evidence
                  separately.
                </p>)}
              {canMatchReceipt(receipt) ? (<AllocationReview receipt={receipt} invoices={reviewInvoices} proposals={proposals} requestId={randomUUID()}/>) : (<p>
                  This observation is not currently eligible for a new invoice match. Check its existing classification and source relationships; completed exclusions must remain excluded unless explicitly reviewed again.
                </p>)}
              {allProposals.length > 10 && <p>Showing 10 of {allProposals.length} candidate alternatives. Equal-evidence ambiguity was checked across the complete set; use invoice pages for other choices.</p>}
              {(matchData?.fx_allocations??[]).length>0&&<section data-testid="matching-fx-relationships" className="space-y-2 rounded border p-3"><h3 className="font-semibold">Separate FX relationships</h3><p>These matches use original invoice units and observed GBP cash. Receipt cash balances above include them. Use complete-lot review for reversal, including zero-cash portions.</p><ul>{matchData!.fx_allocations.map(a=><li key={a.id}>{fxAmountReadback(a.invoice_minor,a.invoice_currency)} original · {fxAmountReadback(a.amount_pence,'GBP')} cash · <Link data-testid={`matching-fx-lot-${a.id}`} className="underline" href={`/dashboard/reconciliation/fx/reversal?lot=${a.conversion_lot_id}`}>Review complete FX lot</Link></li>)}</ul></section>}
              <h3 className="font-semibold">Active native GBP invoice matches</h3>
              {allocations.data?.slice(0, 50).map((a) => (<details key={a.id} className="rounded border p-3">
                  <summary>
                    Invoice{" "}
                    {a.invoice_number ??
                        a.invoice_id}{" "}
                    · {formatPounds(minorPence(a.amount_pence))}
                  </summary>
                  <form action={reverseAllocation} className="mt-3 space-y-3" data-testid={`allocation-reverse-${a.id}`}>
                    <input type="hidden" name="allocationId" value={a.id}/>
                    <input type="hidden" name="requestId" value={randomUUID()}/>
                    <p>
                      Reverse this {formatPounds(minorPence(a.amount_pence))} (
                      {amountToWords(minorPence(a.amount_pence))}) match. It
                      releases this amount to unallocated receipt cash. Invoice
                      outstanding is recalculated using current credits and
                      returns; it may increase by less than the released match.
                      It will not remove receipt income. Reverse any linked
                      refund assignments first.
                    </p>
                    <Link href="/dashboard/reconciliation/refund-assignments" className="underline">
                      Review refund assignments before parent reversal
                    </Link>
                    <label className="block">
                      Reason
                      <input name="reason" required maxLength={1000} className="ml-2 rounded border p-2" data-testid={`allocation-reverse-reason-${a.id}`}/>
                    </label>
                    <label className="flex gap-2">
                      <input type="checkbox" name="humanConfirmed" value="yes" required data-testid={`allocation-reverse-confirm-${a.id}`}/>
                      I confirm this allocation reversal.
                    </label>
                    <button type="submit" className="rounded border px-4 py-2" data-testid={`allocation-reverse-submit-${a.id}`}>
                      Reverse allocation
                    </button>
                  </form>
                </details>))}
              {(allocations.data?.length ?? 0) > 50 && (<Link href={queryLink({
                        allocationAfter: allocations.data![49].id,
                    })} className="underline">
                  More active allocations
                </Link>)}
            </section>)}
        </>)}
    </main>);
}

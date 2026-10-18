'use client';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { formatPounds, signedAmountToWords } from '@/lib/invoices/money';
import type { ImportReversalReview as ReviewData } from '@/lib/records/import-reversal';
import { reverseReviewedImport } from './actions';
const money = (n: number | null) => n === null ? 'Unavailable until linked assignments are reversed' : `${formatPounds(n)} (${signedAmountToWords(n)})`;
function Submit({ enabled }: { enabled: boolean }) { const { pending } = useFormStatus(); return <button data-testid="import-reversal-submit" disabled={!enabled || pending} className="rounded border border-red-300 p-2">{pending ? 'Saving reviewed reversal…' : 'Confirm complete import reversal'}</button>; }
export default function ImportReversalReview(props: { review: ReviewData; requestId: string; sourceStamp: string }) { return <Review key={JSON.stringify(props)} {...props} />; }
function Review({ review: r, requestId, sourceStamp }: { review: ReviewData; requestId: string; sourceStamp: string }) {
    const [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false);
    const sourceLink = (source: { id: string; import_id: string }) => `/dashboard/imports?import=${source.import_id}&transaction=${source.id}#transaction-${source.id}`;
    return <form action={reverseReviewedImport} data-testid="import-reversal-review" className="space-y-5 rounded border p-4">
        <input type="hidden" name="sourceStamp" value={sourceStamp} /><input type="hidden" name="importId" value={r.import_id} /><input type="hidden" name="stamp" value={r.financial_stamp} /><input type="hidden" name="requestId" value={requestId} />
        <section data-testid="import-reversal-readback" className="space-y-3"><h2 className="text-xl font-semibold">Draft reversal read-back</h2>
            <p>Discard only the selected import. Preserve every original file, row and decision history. Other imports remain available.</p>
            <p>{r.target_sources.length} source observations belong to this import; {r.external_reset_sources.length} connected observations in other imports also return to Unknown. Reset {r.reset_ids.length} observations once each. Earlier approvals are not restored. Draft and review interpretations in the selected import are excluded too.</p>
            <p>Exclude {r.excluded_record_ids.length} approved accounting effects. Signed changes: income {money(r.income_delta_pence)}, expenses {money(r.expense_delta_pence)}, net profit {money(r.profit_delta_pence)}.</p>
            <p>Reverse {r.refund_closure.link_ids.length} refund portions across {r.refund_closure.refund_ids.length} refund cash observations. Observed refund cash, counted once: {money(r.refund_closure.observed_refund_cash_pence)}.</p>
            <p>Unpair {r.transfer_pairs.length} owned-account transfers, cash {money(r.transfer_cash_pence)}. These transfer relationships create no income or expense.</p>
            <p>Release {r.allocations.length} invoice matches totalling {money(r.released_allocation_pence)}. Invoice credits, other receipt allocations and actual returned cash remain intact.</p>
        </section>
        {r.blocked && <section role="alert" data-testid="import-reversal-blocked" className="space-y-2 rounded border p-3">
            {r.import_status === 'discarded' && <p>This import is already reversed. Reopen it from imports before reviewing any new decisions.</p>}
            {r.blocking_assignment_ids.length > 0 && <p>{r.blocking_assignment_ids.length} active invoice refund assignments block the entire reversal. <a data-testid="import-reversal-assignments" className="underline" href="/dashboard/reconciliation/refund-assignments">Review and reverse linked returned-cash assignments first</a>.</p>}
            {r.blocking_duplicate_ids.length > 0 && <p>{r.blocking_duplicate_ids.length} retained-source duplicate references block the entire reversal. <a data-testid="import-reversal-duplicates" className="underline" href="/dashboard/reconciliation/duplicates">Review and reverse identity references first</a>.</p>}
        </section>}
        <section><h3 className="font-semibold">Selected import sources</h3><ul className="space-y-2">{r.target_sources.map(s => <li key={s.id} data-testid={`import-reversal-target-${s.id}`}><a className="underline" href={sourceLink(s)}>Review source dated {s.transaction_date}</a> · {money(s.signed_amount_pence)} · {s.classification} → Unknown</li>)}</ul></section>
        {r.external_reset_sources.length > 0 && <section><h3 className="font-semibold">Connected sources in other imports</h3><ul className="space-y-2">{r.external_reset_sources.map(s => <li key={s.id} data-testid={`import-reversal-external-${s.id}`}><a className="underline" href={sourceLink(s)}>Review connected source dated {s.transaction_date}</a> · {money(s.signed_amount_pence)} · {s.classification} → Unknown. Its import is not discarded.</li>)}</ul></section>}
        {r.retained_original_sources.length > 0 && <p data-testid="import-reversal-retained">{r.retained_original_sources.length} original payments in other imports retain their classifications and accounting records.</p>}
        <details><summary>Every refund cash observation and portion</summary><ul>{r.refund_closure.refund_observations.map(o => <li key={o.id}>Refund cash {money(o.cash_pence)} · source {o.id}</li>)}</ul><ul>{r.refund_closure.portions.map(p => <li key={p.id}>Cash portion {money(p.cash_pence)}; remove {p.record_type} reduction {money(p.recognized_pence)} · original {p.original_id}</li>)}</ul></details>
        {r.invoices.length > 0 && <section><h3 className="font-semibold">Invoice balance changes</h3><ul className="space-y-3">{r.invoices.map(i => <li key={i.id} data-testid={`import-reversal-invoice-${i.id}`} className="rounded border p-3">
            <p>Invoice {i.id}: release {money(i.released_allocation_pence)}. Outstanding changes from {money(i.outstanding_before_pence)} to {money(i.outstanding_after_pence)}.</p>
            <p>Retained receipts: {money(i.retained_before_pence)} → {money(i.retained_after_pence)}. Refund due: {money(i.refund_due_before_pence)} → {money(i.refund_due_after_pence)}. Keep credits {money(i.credited_pence)} and returned cash {money(i.returned_pence)}.</p>
        </li>)}</ul></section>}
        <details><summary>Accounting records being excluded</summary><ul>{r.records_to_exclude.map(f => <li key={f.id}>{f.date} · {f.record_type} · signed effect {money(f.amount_pence * f.effect_sign)} · record {f.id}</li>)}</ul></details>
        <label className="block">Evidence and reason<textarea data-testid="import-reversal-reason" name="reason" value={reason} onChange={e => { setConfirmed(false); setReason(e.target.value); }} required maxLength={1000} className="block w-full rounded border p-2" /></label>
        <label className="block"><input type="checkbox" data-testid="import-reversal-confirm" name="humanConfirmed" value="yes" checked={confirmed} disabled={r.blocked || !reason.trim()} required onChange={e => setConfirmed(e.target.checked)} /> I reviewed every source, relationship, signed accounting effect and invoice balance above. Discard only the selected import.</label>
        <Submit enabled={!r.blocked && !!reason.trim() && confirmed} />
        <p>This updates reviewed accounting and matching records. It does not move money, send an invoice or submit anything to HMRC.</p>
    </form>;
}

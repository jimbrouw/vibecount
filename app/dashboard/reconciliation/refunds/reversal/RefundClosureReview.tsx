"use client";
import { useState } from 'react';
import { formatPounds, signedAmountToWords } from '@/lib/invoices/money';
import type { RefundReversalClosure } from '@/lib/records/refund-closure';
import { reverseRefundClosure } from './actions';

export default function RefundClosureReview(props: { review: RefundReversalClosure; requestId: string; sourceStamp: string }) {
    return <Review key={JSON.stringify(props)} {...props} />;
}
function Review({ review: r, requestId, sourceStamp }: { review: RefundReversalClosure; requestId: string; sourceStamp: string }) {
    const [confirmed, setConfirmed] = useState(false);
    const money = (p: number) => `${formatPounds(p)} (${signedAmountToWords(p)})`;
    if (!r.link_ids.length) return <p role="status">There are no active refund relationships to reverse.</p>;
    return <form action={reverseRefundClosure} data-testid="refund-closure-review" className="space-y-4 rounded border p-4">
        <input type="hidden" name="sourceStamp" value={sourceStamp} /><input type="hidden" name="kind" value={r.scope.kind} /><input type="hidden" name="source" value={r.scope.id} />
        <input type="hidden" name="stamp" value={r.financial_stamp} /><input type="hidden" name="requestId" value={requestId} />
        <h2 className="text-xl font-semibold">Review every related refund</h2>
        <p data-testid="refund-closure-readback">Reverse {r.link_ids.length} refund portions involving {r.original_ids.length} original payments and {r.refund_ids.length} refund cash observations across {r.import_ids.length} imports.
            Refund cash counted once: {money(r.observed_refund_cash_pence)}. Remove income reductions of {money(r.income_reduction_removed_pence)} and expense reductions of {money(r.expense_reduction_removed_pence)}.
            Net profit changes by {money(r.profit_delta_pence)}.</p>
        <p>Every listed refund observation becomes Unknown. Original payments stay unchanged. Previous classifications are not restored. This does not move money or reverse an import.</p>
        {r.scope.kind === 'import' && <p data-testid="refund-closure-import-scope">This review includes every refund relationship connected to the selected import, including refunds and originals in other imports. Discarding the import remains a separate review.</p>}
        {r.blocked && <p role="alert" data-testid="refund-closure-blocked">{r.blocking_assignment_ids.length} active invoice refund assignments block this entire reversal.
            {' '}<a className="underline" data-testid="refund-closure-assignments" href="/dashboard/reconciliation/refund-assignments">Review and reverse matched returned cash first</a>.</p>}
        <section aria-label="Refund cash observations"><h3 className="font-semibold">Refund cash, counted once</h3><ul className="space-y-2">
            {r.refund_observations.map(t => <li key={t.id} data-testid={`refund-closure-cash-${t.id}`}><span>Refund {t.id}: {money(t.cash_pence)}.</span>{' '}
                <a className="underline" data-testid={`refund-closure-source-${t.id}`} href={`/dashboard/imports?import=${t.import_id}`}>Review refund source</a></li>)}
        </ul></section>
        <details><summary>All {r.portions.length} portions and original payments</summary><ul className="space-y-3">
            {r.portions.map(l => <li key={l.id}>Original {l.original_id}; refund {l.refund_id}. Cash portion {money(l.cash_pence)}; remove {l.record_type} reduction {money(l.recognized_pence)}.</li>)}
        </ul></details>
        <details><summary>All {r.source_versions.length} affected source observations</summary><ul className="space-y-2">
            {r.source_versions.map(t => <li key={t.id}>{r.original_ids.includes(t.id) ? 'Original payment' : 'Refund cash'} {t.id}; reviewed version {t.decision_version}.{' '}
                <a className="underline" data-testid={`refund-closure-evidence-${t.id}`} href={`/dashboard/imports?import=${t.import_id}`}>Review source import</a></li>)}
        </ul></details>
        <label className="block">Reversal reason<input data-testid="refund-closure-reason" name="reason" required maxLength={1000} className="block w-full rounded border p-2" onChange={() => setConfirmed(false)} /></label>
        <label className="block"><input data-testid="refund-closure-confirm" name="humanConfirmed" type="checkbox" value="yes" required disabled={r.blocked} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{' '}
            I reviewed every affected source and the exact changes above and confirm reversal of all these refund relationships.</label>
        <button data-testid="refund-closure-submit" disabled={!confirmed || r.blocked} className="rounded border p-2">Reverse all listed refund relationships</button>
    </form>;
}

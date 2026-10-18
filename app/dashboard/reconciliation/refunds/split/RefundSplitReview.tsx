'use client';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { decimalToPence } from '@/lib/money';
import { formatPounds, signedAmountToWords } from '@/lib/invoices/money';
import { minorPence } from '@/lib/records/allocations';
import { refundSplitReview, type RefundSplitCatalog } from '@/lib/records/refund-splits';
import FxDependencyBlockers from '../../FxDependencyBlockers';
import { parseFxDependencies, requireDependencySources } from '@/lib/fx/dependencies';
import { approveRefundSplit } from './actions';
type Props = { catalog: RefundSplitCatalog; refundId: string; requestId: string; sourceStamp: string };
const money = (n: number) => `${formatPounds(n)} (${signedAmountToWords(n)})`;
function Submit({ enabled }: { enabled: boolean }) {
    const { pending } = useFormStatus();
    return <button data-testid="refund-split-submit" disabled={!enabled || pending} className="rounded border p-2">{pending ? 'Saving reviewed refund…' : 'Approve reviewed refund allocation'}</button>;
}
export default function RefundSplitReview(props: Props) { return <Review key={JSON.stringify(props)} {...props} />; }
function Review({ catalog, refundId, requestId, sourceStamp }: Props) {
    const [rows, setRows] = useState([{ key: 0, original: '', amount: '' }]), [nextKey, setNextKey] = useState(1);
    const [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false);
    const refund = catalog.transactions.find(t => t.id === refundId);
    if (!refund) return <p role="alert">Owned refund source unavailable.</p>;
    let dependencies = null;
    try {
        if (catalog.fx_dependencies) {
            dependencies = parseFxDependencies(catalog.owner_id, catalog.fx_dependencies);
            requireDependencySources(dependencies, catalog.transactions, catalog.stamp);
        }
    } catch { return <p role="alert">Complete refund dependencies unavailable. Reload before reviewing.</p>; }
    if (dependencies?.fx_blockers.some(b => b.receipt_id === refundId)) return <FxDependencyBlockers review={{ fx_blockers: dependencies.fx_blockers.filter(b => b.receipt_id === refundId) }} prefix="refund-split" operation="Refund allocation"/>;
    const blockedIds = new Set(dependencies?.fx_blockers.map(b => b.receipt_id) ?? []);
    const candidates = catalog.transactions.filter(t => t.id !== refundId && (minorPence(t.signed_amount_pence) > 0) !== (minorPence(refund.signed_amount_pence) > 0) &&
        t.record_status === 'approved' && t.effect_sign === 1 && t.category_valid && t.record_provenance_valid !== false && t.dedupe_status === 'clear' &&
        !t.active_transfer_id && !t.active_refund_id && ['review', 'committed'].includes(t.import_status) && ['Business', 'Mixed'].includes(t.classification) &&
        Math.abs(minorPence(t.signed_amount_pence)) > minorPence(t.refunded_pence));
    let preview: ReturnType<typeof refundSplitReview> | null = null, problem = '';
    try {
        preview = refundSplitReview(catalog.owner_id, { schema_version: 'refund-split-intent/1', refund_id: refund.id, refund_version: refund.decision_version, expected_stamp: catalog.stamp,
            allocations: rows.map(row => {
                const original = candidates.find(t => t.id === row.original);
                return { original_id: row.original, original_version: original?.decision_version, refund_stamp: original?.refund_stamp, amount_pence: decimalToPence(row.amount) };
            }), rationale: reason.trim() || 'Pending human source review', request_id: requestId }, catalog);
    } catch (error) { problem = error instanceof Error ? error.message : 'Review all refund portions.'; }
    const intent = preview && reason.trim() ? preview.intent : null;
    const change = (key: number, field: 'original' | 'amount', value: string) => { setConfirmed(false); setRows(rows.map(r => r.key === key ? { ...r, [field]: value } : r)); };
    return <form action={approveRefundSplit} data-testid="refund-split-review" className="space-y-5 rounded border p-4">
        <input type="hidden" name="sourceStamp" value={sourceStamp} /><input type="hidden" name="intent" value={intent ? JSON.stringify(intent) : ''} />
        <h2 className="text-xl font-semibold">Draft refund allocation</h2>
        <p data-testid="refund-split-cash">Recorded cash on {refund.transaction_date}: {money(Math.abs(minorPence(refund.signed_amount_pence)))}. This is one cash observation.</p>
        <a data-testid="refund-split-cash-source" className="underline" href={`/dashboard/imports?import=${refund.import_id}&transaction=${refund.id}#transaction-${refund.id}`}>Review the recorded refund source</a>
        <p>Use the source links to identify each payment. Source descriptions and bank details are omitted from this review.</p>
        {rows.map((row, index) => <fieldset key={row.key} data-testid={`refund-split-row-${index}`} className="space-y-2 rounded border p-3"><legend>Portion {index + 1}</legend>
            <label className="block">Original payment
                <select data-testid={`refund-split-original-${index}`} value={row.original} onChange={e => change(row.key, 'original', e.target.value)} required className="block w-full rounded border p-2">
                    <option value="">Choose an original payment</option>
                    {candidates.map(t => <option key={t.id} value={t.id} disabled={blockedIds.has(t.id)}>{blockedIds.has(t.id) ? 'Unavailable — linked FX · ' : ''}{t.transaction_date} · {formatPounds(minorPence(t.signed_amount_pence))} · {t.category_label || 'Original payment'} · source ending {t.source_row_id.slice(-6)}</option>)}
                </select>
            </label>
            <label className="block">Refund cash for this original (£)
                <input data-testid={`refund-split-amount-${index}`} type="text" inputMode="decimal" value={row.amount} onChange={e => change(row.key, 'amount', e.target.value)} required maxLength={16} className="block rounded border p-2" />
            </label>
            {rows.length > 1 && <button data-testid={`refund-split-remove-${index}`} type="button" className="underline" onClick={() => { setConfirmed(false); setRows(rows.filter(r => r.key !== row.key)); }}>Remove portion {index + 1}</button>}
        </fieldset>)}
        {!!dependencies?.fx_blockers.length && <details data-testid="refund-split-unavailable-originals"><summary>Original payments unavailable because of linked FX</summary><p>Other eligible originals remain available. Each listed source requires separate FX reversal before selection.</p><FxDependencyBlockers review={dependencies} prefix="refund-split-originals" operation="Selecting these original payments"/></details>}
        <button data-testid="refund-split-add" type="button" disabled={rows.length >= 100} className="rounded border p-2" onClick={() => { setConfirmed(false); setRows([...rows, { key: nextKey, original: '', amount: '' }]); setNextKey(nextKey + 1); }}>Add another original payment</button>
        {!preview && <p role="status" data-testid="refund-split-problem">{problem} Allocate every penny of the refund before approval.</p>}
        {preview && <section aria-label="Refund accounting read-back" data-testid="refund-split-readback" className="space-y-3">
            <h3 className="font-semibold">Review exact effects</h3>
            <p>Allocate {money(preview.result.allocated_cash_pence)} across {preview.result.portions.length} original payments. The cash above is counted once.</p>
            <p>Reduce income by {money(preview.result.income_reduction_pence)} and expenses by {money(preview.result.expense_reduction_pence)} on {preview.result.refund_date}.</p>
            <p>Exclude the earlier ordinary interpretation once: income {money(preview.result.removed_ordinary_income_pence)}, expenses {money(preview.result.removed_ordinary_expense_pence)}.</p>
            <p>Signed changes: income {money(preview.result.income_delta_pence)}, expenses {money(preview.result.expense_delta_pence)}, net profit {money(preview.result.profit_delta_pence)}.</p>
            <ul className="space-y-3">{preview.result.portions.map(p => <li key={p.original_id} data-testid={`refund-split-portion-${p.original_id}`} className="rounded border p-3">
                <p>Original dated {p.original_date}: cash portion {money(p.amount_pence)}; {p.business_use_bps / 100}% business use; reduce {p.record_type} by {money(p.recognized_pence)}.</p>
                <p>Earlier refunded cash {money(p.prior_refunded_pence)}, earlier reduction {money(p.prior_reduced_pence)}, remaining refundable cash {money(p.remaining_original_pence)}.</p>
                <p>Retain category {catalog.transactions.find(t => t.id === p.original_id)?.category_label || 'from the original payment'}; project {p.project_id ? catalog.transactions.find(t => t.id === p.original_id)?.project_label || 'from the original payment' : 'none'}. Original-year records stay intact.</p>
                <a data-testid={`refund-split-source-${p.original_id}`} className="underline" href={`/dashboard/imports?import=${p.original_import_id}&transaction=${p.original_id}#transaction-${p.original_id}`}>Review original payment dated {p.original_date}</a>
                <details><summary>Accounting source identifiers</summary><p>Source {p.original_source_row_id}; category {p.category_id}; project {p.project_id ?? 'none'}.</p></details>
                {p.recognized_pence === 0 && <p>The cash link is retained without a zero-value accounting record.</p>}
                {p.needs_invoice_correction && <p data-testid="refund-split-invoice-correction">This receipt has invoice allocations. Review its credit note and returned-cash assignment separately; this approval changes income only.</p>}
            </li>)}</ul>
            <p>The database rechecks related refund history and source capacity before saving. This records a reviewed accounting allocation. It does not move cash, send an invoice or submit tax information.</p>
        </section>}
        <label className="block">Evidence and reason
            <textarea data-testid="refund-split-reason" value={reason} onChange={e => { setConfirmed(false); setReason(e.target.value); }} required maxLength={1000} className="block w-full rounded border p-2" />
        </label>
        <label className="block"><input data-testid="refund-split-confirm" type="checkbox" name="humanConfirmed" value="yes" checked={confirmed} disabled={!intent} required onChange={e => setConfirmed(e.target.checked)} /> I checked every source, the complete cash allocation and each exact accounting effect.</label>
        <Submit enabled={!!intent && confirmed} />
    </form>;
}

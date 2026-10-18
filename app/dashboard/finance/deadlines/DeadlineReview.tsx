'use client';
import { useState } from 'react';
import { evaluateDeadlines, proposeDeadlines, type DeadlinePlan, type DeadlineCatalog, type DeadlineChoice, type DeadlineResult } from '@/lib/finance/deadlines/model';
import { reviewTaxDeadlines } from './actions';
import DeadlineFigures from './DeadlineFigures';
import { planMoney } from '../PlanFigures';
type Props = { initial: DeadlinePlan; catalog: DeadlineCatalog; today: string; expected: number; stamp: string; requestId: string; rulesHash: string };
const style = 'block w-full rounded border p-2';
export default function DeadlineReview(props: Props) { return <DeadlineForm key={JSON.stringify(props)} {...props}/>; }
function DeadlineForm({ initial, catalog, today, expected, stamp, requestId, rulesHash }: Props) {
    const [plan, setPlan] = useState(initial), [confirmed, setConfirmed] = useState(false), [reason, setReason] = useState('');
    function update(id: string, patch: Partial<DeadlineChoice>) { setConfirmed(false); setPlan(p => ({ ...p, entries: p.entries.map(e => e.id === id ? { ...e, ...patch } : e) })); }
    const proposals = proposeDeadlines(plan.tax_year_start, catalog);
    let result: DeadlineResult | null = null, error = '';
    try { result = evaluateDeadlines(plan, catalog, today); } catch { error = 'Review the chosen dates, evidence, applicability and acknowledgement before saving.'; }
    return <form action={reviewTaxDeadlines} data-testid="deadline-review-form" className="space-y-5">
        <input type="hidden" name="year" value={plan.tax_year_start}/><input type="hidden" name="expected" value={expected}/><input type="hidden" name="stamp" value={stamp}/><input type="hidden" name="requestId" value={requestId}/><input type="hidden" name="rulesHash" value={rulesHash}/><input type="hidden" name="plan" value={JSON.stringify(plan)}/><input type="hidden" name="preview" value={JSON.stringify(result)}/>
        <p>Review applicability and dates separately. Saving can retain unresolved items; only explicitly applicable, date-reviewed open items become in-app reminders. This creates £0.00 (zero pounds) of financial postings and sends no message.</p>
        {proposals.map(p => { const e = plan.entries.find(e => e.id === p.id)!; return <fieldset key={p.id} className="space-y-3 rounded border p-4"><legend className="font-semibold">{p.title}</legend>
            <p>General/source date: {p.proposed_due_date}. {p.source_kind === 'saved_commitment' ? `Reviewed commitment as of ${p.commitment_as_of}: ${p.amount_pence === null ? 'amount unknown' : planMoney(p.amount_pence)}. Change its amount/date in cash planning.` : 'No amount is provided by this calendar proposal.'}</p>
            <label>Does this task apply to you?<select data-testid={'deadline-applicability-' + p.id} className={style} value={e.applicability} onChange={v => update(p.id, { applicability: v.target.value as DeadlineChoice['applicability'], disposition: 'open' })}><option value="unknown">Unresolved</option><option value="applies">Applies — I reviewed my circumstances</option><option value="not_applicable">Does not apply — I reviewed my circumstances</option></select></label>
            <label>Reviewed date basis<select data-testid={'deadline-basis-' + p.id} className={style} value={e.date_basis} onChange={v => update(p.id, { date_basis: v.target.value as DeadlineChoice['date_basis'], notice_due_date: null, notice_document_id: null, disposition: 'open' })}><option value="unreviewed">Date not reviewed</option>{p.source_kind === 'saved_commitment' ? <option value="saved_obligation">Use the saved commitment date</option> : <><option value="standard">Ordinary date applies — no different personal notice</option><option value="notice">Use my evidenced personal notice date</option></>}</select></label>
            {e.date_basis === 'notice' && <><label>Personal notice due date<input data-testid={'deadline-notice-date-' + p.id} className={style} type="date" value={e.notice_due_date ?? ''} onChange={v => update(p.id, { notice_due_date: v.target.value || null, disposition: 'open' })}/></label><label>Owned notice evidence<select data-testid={'deadline-notice-document-' + p.id} className={style} value={e.notice_document_id ?? ''} onChange={v => update(p.id, { notice_document_id: v.target.value || null, disposition: 'open' })}><option value="">Choose the notice document</option>{catalog.documents.map(d => <option key={d.id} value={d.id}>Document {d.id} — SHA-256 {d.file_sha256}</option>)}</select></label></>}
            <label>Remind me before the reviewed date<select data-testid={'deadline-lead-' + p.id} className={style} value={e.lead_days} onChange={v => update(p.id, { lead_days: Number(v.target.value) as DeadlineChoice['lead_days'] })}>{[0, 7, 14, 30].map(n => <option key={n} value={n}>{n === 0 ? 'On the due date' : n + ' days before'}</option>)}</select></label>
            <label>Reminder handling<select data-testid={'deadline-disposition-' + p.id} className={style} value={e.disposition} disabled={e.applicability !== 'applies' || e.date_basis === 'unreviewed'} onChange={v => update(p.id, { disposition: v.target.value as DeadlineChoice['disposition'] })}><option value="open">Keep the reminder open</option><option value="acknowledged">I handled this reminder — does not record payment or filing</option></select></label>
        </fieldset>; })}
        {error && <p role="alert" data-testid="deadline-invalid">{error}</p>}{result && <DeadlineFigures result={result}/>}
        <fieldset className="space-y-3 rounded border p-4"><legend className="font-semibold">Review and save reminder settings</legend>
            <label>Reason for this review<textarea data-testid="deadline-reason" name="reason" className={style} required maxLength={1000} value={reason} onChange={e => { setReason(e.target.value); setConfirmed(false); }}/></label>
            <label><input data-testid="deadline-confirm" name="humanConfirmed" type="checkbox" value="yes" checked={confirmed} disabled={!result} onChange={e => setConfirmed(e.target.checked)}/> I reviewed the exact applicability, dates, evidence, figures and words, unresolved items and reminder handling. This confirms neither payment nor filing.</label>
            <button data-testid="deadline-save" disabled={!result || !confirmed || !reason.trim()} className="rounded border px-4 py-2 disabled:opacity-50">Save reviewed in-app reminder settings</button>
        </fieldset>
    </form>;
}

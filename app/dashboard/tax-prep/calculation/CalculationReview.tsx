'use client';
import { useState } from 'react';
import { scopeOptions, emptyScope, validateScope, type CalculationScope } from '@/lib/tax/scope';
import { decimalToPence } from '@/lib/money';
import { formatPounds, signedAmountToWords } from '@/lib/invoices/money';
import { reviewCalculation } from './actions';
const money = (n: number) => `${formatPounds(n)} (${signedAmountToWords(n)})`;
export const scopeLabels: Record<keyof typeof scopeOptions, string> = { assessment_adjustments: 'Coding-out, earlier-year adjustments, repayments and POA reduction claims', class4_status: 'Class 4 NI exemption status', class2_election: 'Voluntary Class 2 election', pension_scope: 'Pension eligibility and allowance review', net_pay_scope: 'Net-pay and salary-sacrifice relief', employment_scope: 'Distinct employments and cumulative totals', termination_scope: 'Termination pay and PAYE overlap', payments_scope: 'Distinct actual HMRC payment allocations', vehicle_scope: 'Vehicle costs, method history and capital claims', trade_treatment: 'Trading expense eligibility and adjustments', ni_adjustments: 'NI-specific profit adjustments', gift_aid_scope: 'Gift Aid eligibility and tax cover', cash_dates: 'Cash-basis receipt and payment dates' };
type Common = {
    year: number;
    request: string;
};
function ScopeReviewForm({ year, request, stamp, scope, documents }: {
    year: number;
    request: string;
    stamp: string;
    scope: CalculationScope | null;
    documents: {
        id: string;
        file_hash: string;
    }[];
}) {
    const [data, setData] = useState(scope?.data ?? emptyScope()), [state, setState] = useState(scope?.state ?? 'provisional'), [amount, setAmount] = useState(scope?.data.class2_amount_pence == null ? '' : (scope.data.class2_amount_pence / 100).toFixed(2)), [doc, setDoc] = useState(scope?.evidence_document_id ?? ''), [confirmed, setConfirmed] = useState(false);
    const parsed = { ...data, class2_amount_pence: amount.trim() ? decimalToPence(amount) : null };
    let valid = !(amount.trim() && parsed.class2_amount_pence === null);
    try {
        validateScope(parsed, state);
    }
    catch {
        valid = false;
    }
    return <form action={reviewCalculation} data-testid="tax-scope-form" className="space-y-4 rounded border p-4" onChange={e => {
            if ((e.target as unknown as HTMLInputElement).name !== 'humanConfirmed')
                setConfirmed(false);
        }}>
    <h2 className="text-xl font-semibold">Calculation scope review</h2><p>These answers explain what the estimate can cover. Unknown answers stay provisional. Confirm eligibility against your evidence; this does not approve a tax return.</p>
    {scope && !scope.is_current && <p role="alert" data-testid="tax-scope-stale">This scope review is stale. Recheck every answer against the changed tax facts and financial inputs.</p>}
    <input type="hidden" name="action" value="scope"/><input type="hidden" name="year" value={year}/><input type="hidden" name="requestId" value={request}/><input type="hidden" name="stamp" value={stamp}/><input type="hidden" name="expected" value={scope?.ordinal ?? 0}/><input type="hidden" name="scope" value={JSON.stringify(parsed)}/>
    {Object.entries(scopeOptions).map(([key, options]) => <label key={key} className="block">{scopeLabels[key as keyof typeof scopeOptions]}<select data-testid={'tax-scope-' + key} className="block w-full rounded border p-2" value={data[key as keyof typeof scopeOptions]} onChange={e => setData({ ...data, [key]: e.target.value })}>{options.map(option => <option value={option} key={option}>{option.replaceAll('_', ' ')}</option>)}</select></label>)}
    <label className="block">Voluntary Class 2 amount in pounds (blank means unknown)<input data-testid="tax-scope-class2-amount" className="block rounded border p-2" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}/></label>
    <p data-testid="tax-scope-amount-readback">{parsed.class2_amount_pence === null ? 'Amount unresolved' : money(parsed.class2_amount_pence)}</p>
    <label className="block">Evidence for voluntary Class 2<select name="document" data-testid="tax-scope-document" className="block rounded border p-2" value={doc} onChange={e => setDoc(e.target.value)}><option value="">No document selected</option>{documents.map(d => <option key={d.id} value={d.id}>Evidence {d.file_hash.slice(0, 12)}</option>)}</select></label>
    <label className="block">Review status<select name="state" data-testid="tax-scope-state" className="block rounded border p-2" value={state} onChange={e => setState(e.target.value as 'provisional' | 'reviewed')}><option value="provisional">Provisional</option><option value="reviewed">Reviewed</option></select></label>
    <ReviewGate confirmed={confirmed} setConfirmed={setConfirmed} label={`I reviewed these scope answers and evidence for ${year}/${String(year + 1).slice(-2)}.`}/>
    <button data-testid="tax-scope-save" disabled={!valid || !confirmed || (state === 'reviewed' && parsed.class2_election === 'verified_amount' && (parsed.class2_amount_pence ?? 0) > 0 && !doc)} className="rounded border px-4 py-2 disabled:opacity-50">Save scope revision</button>
  </form>;
}
function ReviewGate({ confirmed, setConfirmed, label }: {
    confirmed: boolean;
    setConfirmed: (v: boolean) => void;
    label: string;
}) { return <><label className="block">Review reason<input name="reason" data-testid="tax-calculation-reason" required maxLength={1000} className="block w-full rounded border p-2"/></label><label className="block"><input type="checkbox" name="humanConfirmed" value="yes" checked={confirmed} data-testid="tax-calculation-confirm" onChange={e => setConfirmed(e.target.checked)}/> {label}</label></>; }
function CaptureReviewForm({ year, request, inputHash, resultHash, rulesHash }: {
    inputHash: string;
    resultHash: string;
    rulesHash: string;
} & Common) {
    const [confirmed, setConfirmed] = useState(false);
    return <form action={reviewCalculation} data-testid="tax-capture-form" className="space-y-4 rounded border p-4" onChange={e => {
            if ((e.target as unknown as HTMLInputElement).name !== 'humanConfirmed')
                setConfirmed(false);
        }}><h2 className="text-xl font-semibold">Save this draft estimate</h2><p>Save the displayed figures, unresolved inputs, source references and rules as an immutable draft. A later change requires another snapshot. This does not submit anything to HMRC.</p><input type="hidden" name="action" value="capture"/>{Object.entries({ year, requestId: request, inputHash, resultHash, rulesHash }).map(([key, value]) => <input key={key} type="hidden" name={key} value={value}/>)}<ReviewGate confirmed={confirmed} setConfirmed={setConfirmed} label={`I reviewed the figures and unresolved inputs for ${year}/${String(year + 1).slice(-2)}. Save this draft only.`}/><button data-testid="tax-capture-save" disabled={!confirmed} className="rounded border px-4 py-2 disabled:opacity-50">Save draft calculation</button></form>;
}

export function ScopeReview(props: Parameters<typeof ScopeReviewForm>[0]) { return <ScopeReviewForm key={JSON.stringify(props)} {...props}/>; }
export function CaptureReview(props: Parameters<typeof CaptureReviewForm>[0]) { return <CaptureReviewForm key={JSON.stringify(props)} {...props}/>; }

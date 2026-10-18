'use client';
import { useState } from 'react';
import { decimalToPence } from '@/lib/money';
import { formatPounds, signedAmountToWords } from '@/lib/invoices/money';
import { reviewFilingPack } from './actions';
export type AnswerField = {
    key: string;
    label: string;
    type: 'select' | 'boolean' | 'money' | 'array';
    item?: string;
    options?: {
        value: string;
        label: string;
    }[];
};
type Common = {
    year: number;
    calculation: string;
    request: string;
    inputHash: string;
};
type StepProps = Common & {
    step: string;
    digest: string;
    data: Record<string, unknown>;
    fields: AnswerField[];
};
function StepForm({ year, calculation, request, inputHash, step, digest, data: initial, fields }: StepProps) {
    const [data, setData] = useState(initial), [confirmed, setConfirmed] = useState(false), [moneyText, setMoneyText] = useState<Record<string, string>>({});
    let valid = true;
    const value = (field: AnswerField) => field.item ? (data[field.key] as Record<string, unknown> ?? {})[field.item] : data[field.key];
    const set = (field: AnswerField, next: unknown) => { setConfirmed(false); if (field.type === 'array') {
        const ids = new Set(data[field.key] as string[] ?? []);
        if (next)
            ids.add(field.item!);
        else
            ids.delete(field.item!);
        setData({ ...data, [field.key]: [...ids].sort() });
    }
    else if (field.item && next === '') {
        const map = { ...(data[field.key] as Record<string, unknown>) };
        delete map[field.item];
        setData({ ...data, [field.key]: map });
    }
    else
        setData(field.item ? { ...data, [field.key]: { ...(data[field.key] as object), [field.item]: next } } : { ...data, [field.key]: next }); };
    for (const field of fields.filter(f => f.type === 'money')) {
        const text = moneyText[field.key + ':' + (field.item ?? '')];
        if (text?.trim() && decimalToPence(text) === null)
            valid = false;
    }
    return <form action={reviewFilingPack} data-testid="filing-step-form" className="space-y-4 rounded border p-4" onChange={e => { if ((e.target as unknown as HTMLInputElement).name !== 'humanConfirmed')
        setConfirmed(false); }}>
    {Object.entries({ year, calculation, requestId: request, inputHash, action: 'step', step, digest, answers: JSON.stringify(data) }).map(([name, value]) => <input type="hidden" key={name} name={name} value={String(value)}/>)}
    {fields.map(field => {
            const id = field.key + ':' + (field.item ?? ''), test = 'filing-answer-' + field.key + (field.item ? '-' + field.item : '');
            if (field.type === 'select')
                return <label className="block" key={id}>{field.label}<select data-testid={test} className="block w-full rounded border p-2" value={String(value(field) ?? (field.item ? '' : 'unknown'))} onChange={e => set(field, e.target.value)}>{field.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
            if (field.type === 'boolean' || field.type === 'array')
                return <label key={id} className="block"><input data-testid={test} type="checkbox" checked={field.type === 'array' ? (data[field.key] as string[] ?? []).includes(field.item!) : value(field) === true} onChange={e => set(field, e.target.checked)}/> {field.label}</label>;
            const amount = value(field) as number | null | undefined, text = moneyText[id] ?? (amount == null ? '' : (amount / 100).toFixed(2)), parsed = text.trim() ? decimalToPence(text) : null;
            return <label key={id} className="block">{field.label}<input data-testid={test} inputMode="decimal" className="block rounded border p-2" value={text} onChange={e => { setMoneyText({ ...moneyText, [id]: e.target.value }); set(field, e.target.value.trim() ? decimalToPence(e.target.value) : null); }}/><span data-testid={test + '-readback'}>{parsed === null ? 'Unresolved' : `${formatPounds(parsed)} (${signedAmountToWords(parsed)})`}</span></label>;
        })}
    <label className="block">Review reason<input required name="reason" data-testid="filing-review-reason" maxLength={1000} className="block w-full rounded border p-2"/></label><label className="block"><input type="checkbox" name="humanConfirmed" value="yes" checked={confirmed} data-testid="filing-review-confirm" onChange={e => setConfirmed(e.target.checked)}/> I reviewed this step, its sources, figures and unresolved items for {year}/{String(year + 1).slice(-2)}. This does not approve a tax return.</label><button data-testid="filing-step-save" className="rounded border px-4 py-2 disabled:opacity-50" disabled={!confirmed || !valid}>Save review and continue</button>
  </form>;
}
export function FilingStepForm(props: StepProps) { return <StepForm key={JSON.stringify(props)} {...props}/>; }
type CaptureProps = Common & {
    incompleteHash: string;
    attestedHash: string | null;
};
function CaptureForm({ year, calculation, request, inputHash, incompleteHash, attestedHash }: CaptureProps) { const [confirmed, setConfirmed] = useState(false), [attest, setAttest] = useState(false); return <form action={reviewFilingPack} data-testid="filing-capture-form" className="space-y-4 rounded border p-4" onChange={e => { if ((e.target as unknown as HTMLInputElement).name !== 'humanConfirmed')
    setConfirmed(false); }}>{Object.entries({ year, calculation, requestId: request, inputHash, action: 'capture', bundleHash: attest ? attestedHash ?? '' : incompleteHash }).map(([name, value]) => <input key={name} type="hidden" name={name} value={String(value)}/>)}<label className="block"><input type="checkbox" name="completenessAttested" value="yes" data-testid="filing-completeness" checked={attest} disabled={!attestedHash} onChange={e => { setAttest(e.target.checked); setConfirmed(false); }}/> To the best of my knowledge, the reviewed financial inputs and exceptions for {year}/{String(year + 1).slice(-2)} are complete. This is a draft review pack, not a completed HMRC return.</label>{!attestedHash && <p>Completeness cannot be attested while required inputs or current step reviews remain unresolved. You can preserve an incomplete draft.</p>}<label className="block">Pack review reason<input required name="reason" data-testid="filing-pack-reason" maxLength={1000} className="block w-full rounded border p-2"/></label><label className="block"><input type="checkbox" name="humanConfirmed" value="yes" data-testid="filing-pack-confirm" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/> I reviewed all seven outputs, their shared source set and any unresolved items. Save this draft only; do not submit anything.</label><button data-testid="filing-pack-save" disabled={!confirmed} className="rounded border px-4 py-2 disabled:opacity-50">Save all seven draft outputs</button></form>; }
export function FilingPackCapture(props: CaptureProps) { return <CaptureForm key={JSON.stringify(props)} {...props}/>; }

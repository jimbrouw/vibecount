'use client';
import { useState } from 'react';
import { decimalToPence } from '@/lib/money';
import { type Plan, type Asset, type Earmark, type Obligation } from '@/lib/finance/plan';
import type { PlanningCatalog } from '@/lib/finance/snapshot';
import { evaluateBankCoveredFinancePlan, type BankCoveredFinanceResult } from '@/lib/finance/coverage';
import type { InvoiceCurrencyCoverage as Coverage } from '@/lib/invoices/currency-coverage';
import InvoiceCurrencyCoverage from '../InvoiceCurrencyCoverage';
import BankSourceCoverage from '../BankSourceCoverage';
import type { BankSourceCoverage as BankCoverage } from '@/lib/records/bank-source-coverage';
import PlanFigures, { planMoney } from './PlanFigures';
import { reviewFinancePlan } from './actions';
const inputClass = 'block w-full rounded border p-2';
const pounds = (p: number | null) => p === null ? '' : `${p < 0 ? '-' : ''}${Math.floor(Math.abs(p) / 100)}.${String(Math.abs(p) % 100).padStart(2, '0')}`;
function MoneyInput({ id, label, value, onChange }: { id: string; label: string; value: number | null; onChange(value: number | null, valid: boolean): void }) {
    const [text, setText] = useState(pounds(value));
    const amount = text.trim() ? decimalToPence(text) : null, valid = !text.trim() || amount !== null;
    return <label className="block">{label} in pounds (blank means unknown)<input data-testid={id} className={inputClass} inputMode="decimal" value={text} aria-invalid={!valid} onChange={e => { setText(e.target.value); const n = e.target.value.trim() ? decimalToPence(e.target.value) : null; onChange(n, !e.target.value.trim() || n !== null); }}/><span className="block text-sm">{valid ? planMoney(amount) : 'Invalid amount — use pounds with at most two decimal places.'}</span></label>;
}
type Props = { owner: string; invoiceCoverage: Coverage; bankCoverage: BankCoverage; initial: Plan; catalog: PlanningCatalog; today: string; expected: number; stamp: string; requestId: string; rulesHash: string };
export default function FinanceReview(props: Props) {
    return <FinanceForm key={props.bankCoverage.stamp + ':' + props.invoiceCoverage.stamp + ':' + props.stamp + ':' + props.expected + ':' + props.today + ':' + props.requestId} {...props}/>;
}
function FinanceForm({ owner, invoiceCoverage, bankCoverage, initial, catalog, today, expected, stamp, requestId, rulesHash }: Props) {
    const [plan, setPlan] = useState(initial), [confirmed, setConfirmed] = useState(false), [invalid, setInvalid] = useState<Record<string, boolean>>({});
    const update = (next: Plan) => { setPlan(next); setConfirmed(false); };
    const mark = (id: string, valid: boolean) => setInvalid(old => ({ ...old, [id]: !valid }));
    const asset = (id: string, patch: Partial<Asset>) => update({ ...plan, assets: plan.assets.map(a => a.id === id ? { ...a, ...patch } : a) });
    const earmark = (id: string, patch: Partial<Earmark>) => update({ ...plan, earmarks: plan.earmarks.map(e => e.id === id ? { ...e, ...patch } : e) });
    const obligation = (id: string, patch: Partial<Obligation>) => update({ ...plan, obligations: plan.obligations.map(o => o.id === id ? { ...o, ...patch } : o) });
    const forecast = (patch: Partial<Plan['forecast']>) => update({ ...plan, forecast: { ...plan.forecast, ...patch } });
    let result: BankCoveredFinanceResult | null = null, error = '';
    try {
        result = evaluateBankCoveredFinancePlan(owner, plan, today, invoiceCoverage, bankCoverage);
        for (const a of plan.assets) if (a.account_id) {
            const account = catalog.accounts.find(c => c.id === a.account_id);
            if (!account || account.currency !== 'GBP' || !((a.kind === 'cash' && account.account_type === 'bank') || (a.kind === 'liability' && account.account_type === 'credit_card'))) throw new Error('Link GBP bank accounts to cash and card accounts to debt; pension/restricted assets need separate entries.');
        }
    } catch (e) { error = e instanceof Error ? e.message : 'Review the cash plan.'; }
    const valid = !error && !Object.values(invalid).some(Boolean);
    const boolField = (key: 'cash_complete' | 'unique_assets_checked' | 'commitments_complete' | 'cashflow_assumptions_checked', label: string) => <label className="block"><input type="checkbox" data-testid={'finance-' + key} checked={plan[key]} onChange={e => update({ ...plan, [key]: e.target.checked })}/> {label}</label>;
    return <form data-testid="finance-review-form" action={reviewFinancePlan} className="space-y-6" onChange={e => { if ((e.target as unknown as HTMLInputElement).name !== 'humanConfirmed') setConfirmed(false); }}>
        <input type="hidden" name="plan" value={JSON.stringify(plan)}/><input type="hidden" name="preview" value={JSON.stringify(result)}/><input type="hidden" name="expected" value={expected}/><input type="hidden" name="stamp" value={stamp}/><input type="hidden" name="rulesHash" value={rulesHash}/><input type="hidden" name="requestId" value={requestId}/>
        <p data-testid="finance-scenario-scope">This is a manually reviewed GBP scenario, separate from recognised ledger totals and FX valuation. Unsupported invoice or bank source coverage withholds conditional free cash and drawings even when the entered scenario is otherwise complete.</p>
        {result && <><InvoiceCurrencyCoverage value={invoiceCoverage} owner={owner} testIdPrefix="finance"/><BankSourceCoverage coverage={bankCoverage}/></>}
        <label className="block">Actual balance date<input data-testid="finance-as-of" className={inputClass} type="date" value={plan.as_of} onChange={e => update({ ...plan, as_of: e.target.value })}/></label>
        <fieldset className="space-y-4 rounded border p-4"><legend className="font-semibold">Physical balances — each asset once</legend><p>Enter actual balances, not account credit limits. Pots inside one account are earmarks below. Pension savings are inaccessible assets. A linked account/document identifies your source; it does not verify a transcribed balance.</p>
            {plan.assets.map(a => <fieldset key={a.id} className="space-y-3 border p-3"><legend>Asset {plan.assets.indexOf(a) + 1}</legend>
                <label>Short label, without account details<input data-testid={'finance-asset-label-' + a.id} className={inputClass} maxLength={120} value={a.label} onChange={e => asset(a.id, { label: e.target.value })}/></label>
                <label>Balance kind<select data-testid={'finance-asset-kind-' + a.id} className={inputClass} value={a.kind} onChange={e => asset(a.id, { kind: e.target.value as Asset['kind'] })}>{['cash', 'liability', 'pension', 'restricted'].map(k => <option key={k} value={k}>{k === 'liability' ? 'Existing debt (positive amount owed)' : k}</option>)}</select></label>
                <MoneyInput id={'finance-asset-amount-' + a.id} label="Actual balance" value={a.balance_pence} onChange={(v, ok) => { asset(a.id, { balance_pence: v }); mark(a.id, ok); }}/>
                <label>Linked account<select data-testid={'finance-asset-account-' + a.id} className={inputClass} value={a.account_id ?? ''} onChange={e => asset(a.id, { account_id: e.target.value || null })}><option value="">Manual balance — no linked account</option>{catalog.accounts.map(c => <option key={c.id} value={c.id}>{c.label} ••••{c.masked_identifier} ({c.account_type})</option>)}</select></label>
                <label>Supporting evidence<select data-testid={'finance-asset-document-' + a.id} className={inputClass} value={a.document_id ?? ''} onChange={e => asset(a.id, { document_id: e.target.value || null })}><option value="">Manual transcription — no document selected</option>{catalog.documents.map(d => <option key={d.id} value={d.id}>Evidence SHA-256 {d.file_sha256.slice(0, 12)} ({d.media_type})</option>)}</select></label>
                <button type="button" data-testid={'finance-asset-remove-' + a.id} onClick={() => { update({ ...plan, assets: plan.assets.filter(v => v.id !== a.id) }); mark(a.id, true); }}>Remove asset from this draft</button>
            </fieldset>)}
            <button type="button" data-testid="finance-add-asset" onClick={() => update({ ...plan, assets: [...plan.assets, { id: crypto.randomUUID(), label: '', kind: 'cash', balance_pence: null, account_id: null, document_id: null }] })}>Add physical balance</button>
        </fieldset>
        <fieldset className="space-y-4 rounded border p-4"><legend className="font-semibold">Earmarks inside existing cash</legend>
            {plan.earmarks.map(e => <fieldset className="space-y-3 border p-3" key={e.id}><legend>Cash earmark {plan.earmarks.indexOf(e) + 1}</legend>
                <label>Physical cash source<select data-testid={'finance-earmark-asset-' + e.id} className={inputClass} value={e.asset_id} onChange={v => earmark(e.id, { asset_id: v.target.value })}><option value="">Choose cash source</option>{plan.assets.filter(a => a.kind === 'cash').map(a => <option key={a.id} value={a.id}>{a.label || 'Unlabelled cash'}</option>)}</select></label>
                <label>Purpose<select data-testid={'finance-earmark-purpose-' + e.id} className={inputClass} value={e.purpose} onChange={v => earmark(e.id, { purpose: v.target.value as Earmark['purpose'], tax_year_start: null })}>{['tax_reserve', 'business_buffer', 'emergency_buffer'].map(p => <option key={p} value={p}>{p.replaceAll('_', ' ')}</option>)}</select></label>
                {e.purpose === 'tax_reserve' && <label>Tax-year start (blank means unresolved)<input data-testid={'finance-earmark-year-' + e.id} className={inputClass} type="number" min={2000} max={2100} value={e.tax_year_start ?? ''} onChange={v => earmark(e.id, { tax_year_start: v.target.value ? Number(v.target.value) : null })}/></label>}
                <MoneyInput id={'finance-earmark-amount-' + e.id} label="Cash earmarked" value={e.amount_pence} onChange={(v, ok) => { earmark(e.id, { amount_pence: v ?? 0 }); mark(e.id, ok && v !== null); }}/>
                <button type="button" data-testid={'finance-earmark-remove-' + e.id} onClick={() => { update({ ...plan, earmarks: plan.earmarks.filter(v => v.id !== e.id) }); mark(e.id, true); }}>Remove earmark</button>
            </fieldset>)}
            <button type="button" data-testid="finance-add-earmark" onClick={() => update({ ...plan, earmarks: [...plan.earmarks, { id: crypto.randomUUID(), asset_id: '', purpose: 'tax_reserve', tax_year_start: null, amount_pence: 0 }] })}>Add cash earmark</button>
        </fieldset>
        <fieldset className="space-y-4 rounded border p-4"><legend className="font-semibold">Remaining unpaid obligations</legend><p>Include prior/current-year HMRC demands and separate commitments. Enter only the unpaid amount. Do not repeat existing debt or monthly costs.</p>
            {plan.obligations.map(o => <fieldset key={o.id} className="space-y-3 border p-3"><legend>Obligation {plan.obligations.indexOf(o) + 1}</legend>
                <label>Short label<input data-testid={'finance-obligation-label-' + o.id} className={inputClass} value={o.label} maxLength={120} onChange={e => obligation(o.id, { label: e.target.value })}/></label>
                <label>Kind<select data-testid={'finance-obligation-kind-' + o.id} className={inputClass} value={o.kind} onChange={e => obligation(o.id, { kind: e.target.value as Obligation['kind'], tax_year_start: null })}><option value="tax">Tax demand</option><option value="other">Other unpaid commitment</option></select></label>
                {o.kind === 'tax' && <label>Tax-year start (blank means unknown)<input data-testid={'finance-obligation-year-' + o.id} className={inputClass} type="number" min={2000} max={2100} value={o.tax_year_start ?? ''} onChange={e => obligation(o.id, { tax_year_start: e.target.value ? Number(e.target.value) : null })}/></label>}
                <label>Due date<input data-testid={'finance-obligation-due-' + o.id} className={inputClass} type="date" value={o.due_date} onChange={e => obligation(o.id, { due_date: e.target.value })}/></label>
                <MoneyInput id={'finance-obligation-amount-' + o.id} label="Remaining unpaid amount" value={o.amount_pence} onChange={(v, ok) => { obligation(o.id, { amount_pence: v }); mark(o.id, ok); }}/>
                <button type="button" data-testid={'finance-obligation-remove-' + o.id} onClick={() => { update({ ...plan, obligations: plan.obligations.filter(v => v.id !== o.id) }); mark(o.id, true); }}>Remove obligation</button>
            </fieldset>)}
            <button type="button" data-testid="finance-add-obligation" onClick={() => update({ ...plan, obligations: [...plan.obligations, { id: crypto.randomUUID(), label: '', kind: 'tax', tax_year_start: null, due_date: '', amount_pence: null }] })}>Add unpaid obligation</button>
        </fieldset>
        <fieldset className="space-y-4 rounded border p-4"><legend className="font-semibold">Annual forecast assumptions</legend><p>Planning rules support 2026/27 only. Values below describe an annual scenario; they are not verified historic facts.</p>
            <label>Tax-year start<input data-testid="finance-forecast-year" className={inputClass} type="number" min={2000} max={2100} value={plan.forecast.tax_year_start} onChange={e => forecast({ tax_year_start: Number(e.target.value) })}/></label>
            <label>Jurisdiction<select data-testid="finance-jurisdiction" className={inputClass} value={plan.forecast.jurisdiction} onChange={e => forecast({ jurisdiction: e.target.value as Plan['forecast']['jurisdiction'] })}><option value="unknown">Unresolved</option><option value="england_wales_ni">England, Wales or Northern Ireland</option><option value="scotland">Scotland</option></select></label>
            {([['annual_turnover_pence', 'Annual turnover'], ['monthly_costs_pence', 'Monthly eligible business costs'], ['monthly_pension_pence', 'Monthly pension contribution'], ['tax_paid_pence', 'Actual payments already allocated to this tax year'], ['monthly_drawings_pence', 'Proposed monthly personal drawings'], ['daily_rate_pence', 'Billable daily rate']] as const).map(([key, label]) => <MoneyInput key={key} id={'finance-' + key} label={label} value={plan.forecast[key]} onChange={(v, ok) => { forecast({ [key]: v }); mark(key, ok); }}/>) }
            <label>Pension amount basis<select data-testid="finance-pension-basis" className={inputClass} value={plan.forecast.pension_basis} onChange={e => forecast({ pension_basis: e.target.value as Plan['forecast']['pension_basis'] })}><option value="unknown">Unresolved net/gross basis</option><option value="none">No contribution — enter zero</option><option value="net_ras">Net cash paid, relief at source</option><option value="gross_ras">Gross contribution, relief at source</option></select></label>
            <label>Billable days per year (blank means unknown)<input data-testid="finance-billable-days" className={inputClass} type="number" min={1} max={366} value={plan.forecast.billable_days_per_year ?? ''} onChange={e => forecast({ billable_days_per_year: e.target.value ? Number(e.target.value) : null })}/></label>
            <label>Low-profit voluntary Class 2 decision<select data-testid="finance-class2" className={inputClass} value={plan.forecast.class2_election} onChange={e => forecast({ class2_election: e.target.value as Plan['forecast']['class2_election'] })}><option value="unknown">Unresolved</option><option value="no_voluntary_charge">Reviewed: no voluntary Class 2 cash charge</option></select></label>
            {([['supported_tax_scope_checked', 'I checked full-year UK sole-trader cash basis, non-VAT, eligible costs, and no other income, loans, losses, special reliefs or NI exceptions.'], ['pension_eligibility_checked', 'I checked eligible registered relief-at-source contributions, under-75/relevant-earnings conditions and no unmodelled annual allowance or MPAA charge.'], ['tax_payments_checked', 'I checked payments already allocated to this year; reserves are not payment credits.']] as const).map(([key, label]) => <label className="block" key={key}><input data-testid={'finance-' + key} type="checkbox" checked={plan.forecast[key]} onChange={e => forecast({ [key]: e.target.checked })}/> {label}</label>)}
        </fieldset>
        <fieldset className="space-y-3 rounded border p-4"><legend className="font-semibold">Completeness and timing</legend>
            {boolField('cash_complete', 'All accessible cash and existing debts are included, or explicitly none.')}
            {boolField('unique_assets_checked', 'Each manual entry is a distinct physical asset; pots inside one account are not additional balances.')}
            {boolField('commitments_complete', 'I included remaining unpaid obligations, including prior/current-year HMRC demands, without duplicating debts or monthly costs.')}
            {boolField('cashflow_assumptions_checked', 'I checked future receipts, costs, pension and drawings on the fifth of each future month through 5 April; the actual balance already contains earlier movements.')}
        </fieldset>
        {!valid && <p role="alert" data-testid="finance-invalid">{error || 'Correct invalid monetary inputs before saving.'}</p>}
        {result && valid && <PlanFigures result={result}/>}
        <fieldset className="space-y-3 rounded border p-4"><legend className="font-semibold">Review and save a draft revision</legend><p>Saving preserves these inputs, assumptions and unresolved issues. It approves no financial record, tax return, payment or bank action.</p>
            <label>Reason for this revision<textarea name="reason" data-testid="finance-reason" className={inputClass} required maxLength={1000}/></label>
            <label><input name="humanConfirmed" data-testid="finance-confirm" type="checkbox" value="yes" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/> I reviewed the figures, words, sources, forecast assumptions and unresolved inputs shown above.</label>
            <button data-testid="finance-save" disabled={!valid || !confirmed} className="rounded border px-4 py-2 disabled:opacity-50">Save reviewed draft inputs</button>
        </fieldset>
    </form>;
}

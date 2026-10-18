import FilingFxProvenance from './FilingFxProvenance';
import BankAccountingCoverage from '../BankAccountingCoverage';
import BankSourceCoverage from '../../BankSourceCoverage';
import InvoiceCurrencyCoverage from '../../InvoiceCurrencyCoverage';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { getCurrentTaxYearStart, getTaxYearLabel } from '@/lib/records/tax-periods';
import { formatPounds, signedAmountToWords } from '@/lib/invoices/money';
import { loadFilingContext } from '@/lib/tax/filing-server';
import { buildFilingPack, filingSteps, verifyFilingPack, type FilingPackInput, type FilingStep, type SavedFilingPack } from '@/lib/tax/filing-pack';
import { canonicalJson, sha256 } from '@/lib/tax/snapshot';
import { factFields } from '@/lib/tax/facts';
import { formMapping2025 } from '@/lib/tax/form-mapping';
import { FilingStepForm, FilingPackCapture, type AnswerField } from './FilingReview';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const money = (pence: number | null) => pence === null ? 'Unresolved' : `${formatPounds(pence)} (${signedAmountToWords(pence)})`;
export default async function FilingPackPage({ searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const db = await createClient(), { data: { user }, error } = await db.auth.getUser();
    if (error || !user)
        redirect('/login');
    const params = await searchParams, n = Number(params.year), year = Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : getCurrentTaxYearStart() - 1;
    let context: Awaited<ReturnType<typeof loadFilingContext>> | null = null, saved: SavedFilingPack | null = null, unavailable = false, history: {
        id: string;
        created_at: string;
        review_status: string;
    }[] = [];
    try {
        let query = db.from('filing_packs').select('id,created_at,review_status').eq('user_id', user.id).eq('tax_year_start', year).order('id').limit(20);
        if (typeof params.after === 'string' && uuid.test(params.after))
            query = query.gt('id', params.after);
        const h = await query;
        if (h.error)
            throw new Error();
        history = h.data;
        if (typeof params.saved === 'string' && uuid.test(params.saved)) {
            const row = await db.from('filing_packs').select('*').eq('user_id', user.id).eq('tax_year_start', year).eq('id', params.saved).single();
            if (row.error || !row.data)
                throw new Error();
            saved = row.data as SavedFilingPack;
            verifyFilingPack(saved);
        }
        else {
            let calculation = typeof params.calculation === 'string' && uuid.test(params.calculation) ? params.calculation : null;
            if (!calculation) {
                const latest = await db.from('tax_calculations').select('id').eq('user_id', user.id).eq('tax_year_start', year).order('created_at', { ascending: false }).order('id').limit(1).maybeSingle();
                if (latest.error)
                    throw new Error();
                calculation = latest.data?.id ?? null;
            }
            if (calculation) {
                context = await loadFilingContext(db, user.id, calculation);
                if (context.input.tax_year_start !== year)
                    throw new Error();
            }
        }
    }
    catch {
        unavailable = true;
    }
    const selected = context && (params.step === 'export' ? 'export' : filingSteps.includes(params.step as FilingStep) ? params.step as FilingStep : context.model.steps.find(s => !s.review)?.id ?? 'export'), current = context?.model.steps.find(s => s.id === selected), request = randomUUID();
    let capture: {
        incompleteHash: string;
        attestedHash: string | null;
    } | null = null;
    try {
        if (context && context.input.calculation_is_current) {
            const incomplete = buildFilingPack(context.input, context.history, request, false);
            capture = { incompleteHash: sha256(canonicalJson(incomplete)), attestedHash: context.model.canAttest ? sha256(canonicalJson(buildFilingPack(context.input, context.history, request, true))) : null };
        }
    }
    catch {
        unavailable = true;
        capture = null;
    }
    return <main className="mx-auto max-w-5xl space-y-6 px-5 py-8"><h1 className="text-2xl font-semibold">Draft Self Assessment pack — {getTaxYearLabel(year)}</h1><p className="rounded border p-4 font-medium">Draft — not submitted to HMRC. This guided review prepares evidence and a worksheet. It is not filing software, MTD compliance or independent tax approval.</p><nav className="flex flex-wrap gap-4"><Link data-testid="filing-calculation-link" href={`/dashboard/tax-prep/calculation?year=${year}`}>Tax calculation</Link><Link data-testid="filing-facts-link" href={`/dashboard/tax-prep/facts?year=${year}`}>Tax facts and profile</Link><Link data-testid="filing-imports-link" href="/dashboard/imports">Source imports</Link></nav><form className="flex gap-3"><label>Tax-year start<input name="year" type="number" min="2000" max="2100" defaultValue={year} data-testid="filing-year" className="ml-2 w-24 rounded border p-2"/></label><button data-testid="filing-year-open" className="rounded border px-3">Open year</button></form>
    {params.error && <p role="alert">{String(params.error)}</p>}{params.result === 'review-saved' && <p role="status">Review saved. Previously reviewed steps stay current when their relevant inputs are unchanged.</p>}
    {unavailable ? <p role="alert" data-testid="filing-unavailable">The complete source set, saved pack or review history could not be verified. Reload before reviewing or exporting.</p> : saved ? <section data-testid="saved-filing-pack" className="space-y-4"><h2 className="text-xl font-semibold">Saved draft — {saved.created_at}</h2><p>{saved.bundle.review_status === 'draft_reviewed' ? 'Financial review completeness was attested.' : 'Incomplete draft; unresolved inputs or step reviews remain.'} The seven files retain the same original source set even after later changes.</p>{saved.input.schema_version !== 'filing-pack-input/1' ? <InvoiceCurrencyCoverage value={saved.input.invoice_coverage} owner={user.id}/> : <p>Historical pack inputs predate explicit invoice currency coverage.</p>}{saved.input.schema_version==='filing-pack-input/4'&&<BankSourceCoverage coverage={saved.input.bank_source_coverage}/>}{(saved.input.schema_version==='filing-pack-input/5'||saved.input.schema_version==='filing-pack-input/6')&&<BankAccountingCoverage input={saved.input.calculation.input} coverage={saved.input.bank_source_coverage} connected={saved.input.observations.filter(o=>o.import_status!=='discarded'||o.in_tax_year!==true).map(o=>o.id)}/>}<FilingFxProvenance input={saved.input}/><p>Source-set SHA-256: {saved.input_sha256}</p><p>{saved.bundle.blocking_issues.length} unresolved financial inputs/reviews.</p><ul>{saved.bundle.artifacts.map(a => <li key={a.name}><a data-testid={'filing-artifact-' + a.name} href={`/api/tax-prep/filing-pack/export?id=${saved.id}&artifact=${a.name}`}>{a.name === 'worksheet.html' ? 'Open printable worksheet' : a.name}</a> — {a.size_bytes} bytes; SHA-256 {a.sha256}</li>)}</ul><a data-testid="filing-manifest-link" href={`/api/tax-prep/filing-pack/export?id=${saved.id}`}>Download pack integrity manifest</a><p><Link data-testid="filing-current-review" href={`?year=${year}`}>Review the current year again</Link></p></section> : !context ? <p data-testid="filing-needs-calculation">Save a draft calculation for this year before starting the guided pack review.</p> : <>
      {context.input.schema_version !== 'filing-pack-input/1' && <InvoiceCurrencyCoverage value={context.input.invoice_coverage} owner={user.id}/>}
      {context.input.schema_version==='filing-pack-input/4'&&<BankSourceCoverage coverage={context.input.bank_source_coverage}/>}{(context.input.schema_version==='filing-pack-input/5'||context.input.schema_version==='filing-pack-input/6')&&<BankAccountingCoverage input={context.input.calculation.input} coverage={context.input.bank_source_coverage} connected={context.input.observations.filter(o=>o.import_status!=='discarded'||o.in_tax_year!==true).map(o=>o.id)}/>}<FilingFxProvenance input={context.input}/>
      {!context.input.calculation_is_current ? <p role="alert" data-testid="filing-stale-calculation">The saved calculation no longer matches current financial or tax inputs. Review and save a current calculation before reviewing this pack.</p> : <>
        <nav aria-label="Self Assessment review steps" className="flex flex-wrap gap-3">{context.model.steps.map(s => <Link key={s.id} data-testid={'filing-step-' + s.id} aria-current={selected === s.id ? 'step' : undefined} href={`?year=${year}&calculation=${context!.input.calculation.id}&step=${s.id}`}>{s.name} — {s.review ? 'reviewed' : 'needs review'}</Link>)}<Link data-testid="filing-step-export" href={`?year=${year}&calculation=${context.input.calculation.id}&step=export`}>Export</Link></nav>
        <p data-testid="filing-review-progress">{context.model.current.length} of 10 review steps current; {context.model.issues.filter(i => i.blocking).length} unresolved inputs or reviews. Reviewing a step does not silently resolve its missing tax facts.</p>
        {current ? <section className="space-y-4"><h2 className="text-xl font-semibold">{current.name}</h2><StepSummary input={context.input} step={current.id}/><FilingStepForm year={year} calculation={context.input.calculation.id} request={request} inputHash={context.model.inputHash} step={current.id} digest={current.digest} data={current.data} fields={answerFields(context.input, current.id)}/></section> : <section className="space-y-4"><h2 className="text-xl font-semibold">Review and export</h2><p>All seven outputs will share one frozen source set, calculation, tax rule version and annual mapping. Exact pence and paper-box rounding remain separate.</p><ul className="list-disc pl-6">{context.model.issues.map((i, index) => <li key={index}>{i.blocking ? 'Unresolved: ' : 'Note: '}{i.message} {i.source_ids.join(', ')}</li>)}</ul>{capture && <FilingPackCapture year={year} calculation={context.input.calculation.id} request={request} inputHash={context.model.inputHash} {...capture}/>}</section>}
        {selected !== 'export' && <details><summary>Current exceptions and review notes</summary><ul>{context.model.issues.map((i, index) => <li key={index}>{i.message} {i.source_ids.join(', ')}</li>)}</ul></details>}
      </>}
    </>}
    <section><h2 className="text-xl font-semibold">Saved pack history</h2><ul>{history.map(h => <li key={h.id}><Link data-testid={'filing-history-' + h.id} href={`?year=${year}&saved=${h.id}`}>{h.created_at} — {h.review_status === 'draft_reviewed' ? 'reviewed draft' : 'incomplete draft'}</Link></li>)}</ul>{history.length === 20 && <Link data-testid="filing-history-more" href={`?year=${year}&after=${history.at(-1)!.id}`}>More saved packs</Link>}</section>
  </main>;
}
function answerFields(input: FilingPackInput, step: FilingStep): AnswerField[] {
    if (step === 'profile')
        return [{ key: 'trade_form', type: 'select', label: 'Self-employment form after checking the annual notes', options: [{ value: 'unknown', label: 'Unresolved' }, { value: 'short', label: 'SA103S — short' }, { value: 'full', label: 'SA103F — full' }] }, { key: 'short_eligibility', type: 'select', label: 'Short-form eligibility review', options: [{ value: 'unknown', label: 'Unresolved' }, { value: 'full_year_simple', label: 'Full-year simple affairs; accounts end 31 March–5 April; annual notes checked' }, { value: 'requires_full', label: 'Full form or further eligibility review required' }] }];
    if (step === 'sources')
        return [{ key: 'all_sources_reviewed', type: 'boolean', label: 'I checked all relevant accounts, statement periods and supporting documents for this tax year. Missing sources have been recorded as unresolved.' }];
    if (step === 'income')
        return [{ key: 'all_receipts_are_turnover', type: 'boolean', label: 'The trading receipts in this ledger are turnover. Other business receipts/adjustments are separately recorded or remain unresolved.' }, ...input.receipt_balances.filter(r => r.in_tax_year === true && r.record_status === 'approved' && ['Business', 'Mixed'].includes(String(r.classification)) && Number(r.unallocated_pence) > 0 && input.observations.some(o => o.id === r.id && o.record_type === 'income')).map(r => ({ key: 'no_invoice_expected_ids', item: r.id, type: 'array' as const, label: `No invoice is expected for receipt ${r.id} dated ${r.transaction_date}, unallocated ${money(Number(r.unallocated_pence))}. I reviewed why this is legitimate trading income.` }))];
    if (step === 'expenses') {
        const categories = new Map(input.calculation.input.records.filter(r => r.record_type === 'expense' && r.category).map(r => [r.category!.id, r.category!]));
        return [...[...categories.values()].map(c => ({ key: 'category_boxes', item: c.id, type: 'select' as const, label: `Full-form category mapping, if using SA103F: ${c.name}`, options: [{ value: '', label: 'Unresolved / not needed for short form' }, ...Object.entries(formMapping2025.full_expenses).map(([value, label]) => ({ value, label: `Box ${value} — ${label}` }))] })), ...input.calculation.input.facts.filter(f => f.kind === 'trade_adjustment' && f.state === 'verified' && f.data.adjustment_type === 'capital_allowance').map(f => ({ key: 'capital_boxes', item: f.id, type: 'select' as const, label: `Capital allowance type for ${f.label}; check eligibility against original evidence`, options: [{ value: '', label: 'Unresolved' }, ...[...new Set([...formMapping2025.cash_basis_car_capital.short, ...formMapping2025.cash_basis_car_capital.full])].map(value => ({ value, label: 'Annual form box ' + value }))] }))];
    }
    if (step === 'other')
        return input.calculation.input.facts.filter(f => f.kind === 'termination' && f.state === 'verified').map(f => ({ key: 'termination_exempt_pence', item: f.id, type: 'money', label: `Evidenced exempt compensation component for ${f.label}, in pounds. Do not infer it from the total.` }));
    if (step === 'pension') {
        const fields: AnswerField[] = [];
        if (input.calculation.input.facts.some(f => f.kind === 'pension' && f.state === 'verified' && f.data.method === 'relief_at_source'))
            fields.push({ key: 'one_off_pension_gross_pence', type: 'money', label: 'Gross one-off pension contributions included in the annual RAS total, in pounds; enter zero if none.' });
        if (input.calculation.input.facts.some(f => f.kind === 'gift_aid' && f.state === 'verified'))
            fields.push({ key: 'one_off_gift_aid_net_pence', type: 'money', label: 'Actual net one-off Gift Aid donations included in the annual total, in pounds; enter zero if none.' });
        return fields;
    }
    return [];
}
function StepSummary({ input, step }: {
    input: FilingPackInput;
    step: FilingStep;
}) {
    const tax = input.calculation.input, kind = step === 'paye' ? ['employment'] : step === 'other' ? ['termination', 'other_income'] : step === 'pension' ? ['pension', 'gift_aid'] : step === 'expenses' ? ['vehicle', 'trade_adjustment'] : [];
    return <div data-testid={'filing-summary-' + step} className="space-y-3 rounded border p-4">
    {step === 'profile' && <><p>Tax year {getTaxYearLabel(input.tax_year_start)}; jurisdiction {tax.profile?.data.jurisdiction.replaceAll('_', ' ') ?? 'unresolved'}; accounting basis {tax.profile?.data.accounting_basis ?? 'unresolved'}; structure {tax.profile?.data.business_structure.replaceAll('_', ' ') ?? 'unresolved'}.</p><p>Turnover: {money(input.calculation.result.totals.ledger_income ?? null)}. The short-form limit alone does not establish eligibility.</p></>}
    {step === 'sources' && <><p>{input.imports.length} original imports; {input.documents.length} preserved documents; {input.observations.filter(o => o.in_tax_year).length} year observations plus {input.observations.filter(o => !o.in_tax_year).length} contextual observations. Originals remain private; this view shows normalized metadata.</p><ul>{input.imports.map(i => <li key={i.id}>Import {i.id}: SHA-256 {String(i.file_hash)}, coverage {String(i.coverage_start)} to {String(i.coverage_end)}; {String(i.status)}</li>)}</ul><p>Check original employment/settlement documents before confirming typed facts. Preserving an opaque file does not verify its contents.</p></>}
    {step === 'income' && <><p>Recognised trading income: {money(input.calculation.result.totals.ledger_income ?? null)}. Invoices and their settlements create no extra income here.</p><p>{input.receipt_balances.filter(r => r.in_tax_year === true && Number(r.unallocated_pence) > 0).length} receipts have unallocated cash; review applicable no-invoice declarations below or return to reconciliation.</p><Link data-testid="filing-income-reconcile" href={`/dashboard/reconciliation?year=${input.tax_year_start}`}>Open receipt reconciliation</Link></>}
    {step === 'expenses' && <><p>Candidate ledger expenses: {money(input.calculation.result.totals.ledger_expenses ?? null)}; adjusted trading profit: {money(input.calculation.result.totals.trade_profit ?? null)}. Existing mixed-use effects are not apportioned again.</p><Link data-testid="filing-expense-review" href={`/dashboard/review/memory?year=${input.tax_year_start}`}>Review expense exceptions and memory</Link><p>Only complete full-form category mappings if using SA103F. Never infer tax eligibility from the category name.</p></>}
    {kind.length > 0 && <ul>{tax.facts.filter(f => kind.includes(f.kind)).map(f => <li key={f.id} className="my-3"><strong>{f.label} — {f.state}</strong><ul>{factFields[f.kind].map(field => <li key={field.key}>{field.label}: {f.data[field.key] == null ? 'Unresolved' : ['money', 'signed_money'].includes(field.type) ? money(Number(f.data[field.key])) : String(f.data[field.key]).replaceAll('_', ' ')}</li>)}</ul><p>Revision {f.id}; sources {tax.sources.filter(s => s.revision_id === f.id).map(s => s.document_id ?? s.transaction_id ?? s.record_id).join(', ') || 'unresolved'}.</p></li>)}</ul>}
    {step === 'estimate' && <><p>Saved calculation {input.calculation.id}; {input.calculation.result.status}. Rule {input.calculation.ruleset_id}; engine {input.calculation.engine_version}.</p><ul>{['income_tax', 'class4', 'class2', 'tax_withheld', 'actual_tax_payments', 'net_balance', 'poa_each'].map(key => <li key={key}>{key.replaceAll('_', ' ')}: {money(input.calculation.result.totals[key] ?? null)}</li>)}</ul><Link data-testid="filing-estimate-detail" href={`/dashboard/tax-prep/calculation?year=${input.tax_year_start}&saved=${input.calculation.id}`}>Inspect saved calculation and rounding trace</Link></>}
    {(step === 'review' || step === 'exceptions') && <p>Inspect the current exception list below. Missing tax inputs and unsupported branches cannot be dismissed by reviewing this step. Final completeness remains disabled until all required inputs and current reviews are resolved.</p>}
    {['paye', 'other', 'pension'].includes(step) && <Link data-testid={'filing-facts-' + step} href={`/dashboard/tax-prep/facts?year=${input.tax_year_start}`}>Correct or complete source-linked tax facts</Link>}
  </div>;
}

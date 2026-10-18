import Link from 'next/link';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { readAllExportRows } from '@/lib/records/export-pages';
import { getCurrentTaxYearStart, getTaxYearLabel } from '@/lib/records/tax-periods';
import { formatPounds, signedAmountToWords } from '@/lib/invoices/money';
import { prepareCalculation, sha256, canonicalJson, verifySavedCalculation, type SavedCalculation } from '@/lib/tax/snapshot';
import type { CalculationInput, CalculationResult } from '@/lib/tax/calculation';
import { ScopeReview, CaptureReview } from './CalculationReview';
import InvoiceCurrencyCoverage from '../../InvoiceCurrencyCoverage';
import BankAccountingCoverage from '../BankAccountingCoverage';
import BankSourceCoverage from '../../BankSourceCoverage';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const money = (pence: number | null) => pence === null ? 'Unresolved' : `${formatPounds(pence)} (${signedAmountToWords(pence)})`;
export default async function CalculationPage({ searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const db = await createClient(), { data: { user }, error } = await db.auth.getUser();
    if (error || !user)
        redirect('/login');
    const params = await searchParams, candidate = Number(params.year), year = Number.isInteger(candidate) && candidate >= 2000 && candidate <= 2100 ? candidate : getCurrentTaxYearStart() - 1;
    let prepared: ReturnType<typeof prepareCalculation> | null = null, stamp = '', documents: {
        id: string;
        file_hash: string;
    }[] = [], history: {
        id: string;
        created_at: string;
        input_sha256: string;
        engine_version: string;
    }[] = [], saved: SavedCalculation | null = null, currentness = '';
    let unavailable = false;
    try {
        const taxStamp = await db.rpc('tax_review_stamp', { p_year: year });
        if (taxStamp.error || typeof taxStamp.data !== 'string')
            throw new Error('Scope stamp unavailable');
        stamp = taxStamp.data;
        const input = await db.rpc('read_tax_calculation_input', { p_year: year });
        if (input.error || !input.data || input.data.owner_id !== user.id || input.data.schema_version!=='tax-calculation-input/4')
            throw new Error('Inputs unavailable');
        prepared = prepareCalculation(input.data as CalculationInput);
        documents = await readAllExportRows(async (after) => {
            let q = db.from('evidence_documents').select('id,file_hash').eq('user_id', user.id).order('id').limit(500);
            if (after)
                q = q.gt('id', after);
            return await q;
        });
        const after = typeof params.after === 'string' && uuid.test(params.after) ? params.after : null;
        let q = db.from('tax_calculations').select('id,created_at,input_sha256,engine_version').eq('user_id', user.id).eq('tax_year_start', year).order('id').limit(20);
        if (after)
            q = q.gt('id', after);
        const h = await q;
        if (h.error)
            throw new Error('History unavailable');
        history = h.data;
        if (typeof params.saved === 'string' && uuid.test(params.saved)) {
            const r = await db.from('tax_calculations').select('*').eq('user_id', user.id).eq('tax_year_start', year).eq('id', params.saved).single();
            if (r.error || !r.data)
                throw new Error('Saved snapshot unavailable');
            const rules = await db.from('tax_rulesets').select('id,canonical_json,sha256').eq('id', r.data.ruleset_id).single();
            if (rules.error || !rules.data)
                throw new Error('Saved rules unavailable');
            saved = r.data as SavedCalculation;
            verifySavedCalculation(saved, rules.data);
            currentness = saved.input_sha256 === sha256(canonicalJson(input.data)) ? 'These saved inputs still match the current calculation inputs.' : 'Inputs have changed since this snapshot. Its saved figures remain historical; review a new draft for current figures.';
        }
        const afterStamp=await db.rpc('tax_review_stamp',{p_year:year});
        if(afterStamp.error||afterStamp.data!==stamp)throw new Error('Tax inputs changed while loading the review.');
        const afterInput = await db.rpc('read_tax_calculation_input', { p_year: year });
        if (afterInput.error || !afterInput.data || sha256(canonicalJson(afterInput.data)) !== prepared.inputHash) throw new Error('Invoice coverage or tax inputs changed while loading.');
    }
    catch {
        unavailable = true;
    }
    return <main className="mx-auto max-w-4xl space-y-6 px-5 py-8"><h1 className="text-2xl font-semibold">Draft tax calculation — {getTaxYearLabel(year)}</h1><p>Draft — not submitted to HMRC. This estimate needs reviewed sources and independent tax review. Missing inputs are unresolved, never assumed zero.</p>
    <nav className="flex flex-wrap gap-4"><Link data-testid="calculation-filing-pack-link" href={`/dashboard/tax-prep/filing-pack?year=${year}`}>Guided draft filing pack</Link><Link data-testid="calculation-facts-link" href={`/dashboard/tax-prep/facts?year=${year}`}>Review tax facts</Link><Link data-testid="calculation-ledger-link" href={`/dashboard/tax-prep?taxYearStart=${year}`}>Trading checklist</Link><Link data-testid="calculation-memory-link" href={`/dashboard/review/memory?year=${year}`}>Review expense exceptions</Link></nav>
    <form className="flex gap-3"><label>Tax-year start<input data-testid="calculation-year" className="ml-2 w-24 rounded border p-2" name="year" type="number" min="2000" max="2100" defaultValue={year}/></label><button data-testid="calculation-year-open" className="rounded border px-3">Open year</button></form>
    {params.error && <p role="alert">{String(params.error)}</p>}{params.result === 'scope-saved' && <p role="status">Scope revision saved. Review the refreshed calculation below.</p>}
    {unavailable ? <p role="alert" data-testid="calculation-unavailable">Complete calculation or history could not be verified. Reload before reviewing or saving figures.</p> : prepared && <>
      {saved && <section className="space-y-4 rounded border p-4" data-testid="saved-calculation"><h2 className="text-xl font-semibold">Saved draft — {saved.created_at}</h2><p>{currentness}</p>{saved.input.schema_version !== 'tax-calculation-input/1' ? <InvoiceCurrencyCoverage value={saved.input.invoice_coverage} owner={user.id}/> : <p>Historical inputs predate explicit invoice currency coverage.</p>}{saved.input.schema_version==='tax-calculation-input/3'&&<BankSourceCoverage coverage={saved.input.bank_source_coverage}/>}{saved.input.schema_version==='tax-calculation-input/4'&&<BankAccountingCoverage input={saved.input} coverage={saved.input.bank_source_coverage}/>}<CalculationFigures result={saved.result}/><Link data-testid="calculation-export" href={`/api/tax-prep/calculation/export?id=${saved.id}`}>Export saved inputs, rules and calculation trace</Link></section>}
      <section className="space-y-4" data-testid="current-calculation"><h2 className="text-xl font-semibold">Current draft preview</h2>{prepared.input.schema_version !== 'tax-calculation-input/1' && <InvoiceCurrencyCoverage value={prepared.input.invoice_coverage} owner={user.id}/>}{prepared.input.schema_version==='tax-calculation-input/3'&&<BankSourceCoverage coverage={prepared.input.bank_source_coverage}/>}{prepared.input.schema_version==='tax-calculation-input/4'&&<BankAccountingCoverage input={prepared.input} coverage={prepared.input.bank_source_coverage}/>}<CalculationFigures result={prepared.result}/></section>
      <details><summary>Rules and review sources</summary><p>Rules {prepared.rules.id}; engine {prepared.rules.engine_version}. Independent tax review pending. Annual Self Assessment form mapping is separate.</p><ul>{prepared.rules.sources.map(s => <li key={s.id}><a href={s.url}>{s.section}</a></li>)}</ul></details>
      {prepared.rules.tax_year_start === year ? <CaptureReview key={prepared.inputHash} year={year} request={randomUUID()} inputHash={prepared.inputHash} resultHash={prepared.resultHash} rulesHash={prepared.rulesHash}/> : <p role="alert">Saving a calculation requires a ruleset for this tax year. Its inputs remain available for review.</p>}
      <ScopeReview key={'scope-' + prepared.inputHash} year={year} request={randomUUID()} stamp={stamp} scope={prepared.input.scope} documents={documents}/>
      <section><h2 className="text-xl font-semibold">Saved draft history</h2><p>Snapshots preserve their original figures and cannot approve a tax return.</p><ul>{history.map(h => <li key={h.id}><Link data-testid={'calculation-history-' + h.id} href={`?year=${year}&saved=${h.id}`}>{h.created_at} — {h.engine_version}</Link></li>)}</ul>{history.length === 20 && <Link data-testid="calculation-history-more" href={`?year=${year}&after=${history.at(-1)!.id}`}>More saved snapshots</Link>}</section>
    </>}
  </main>;
}
function CalculationFigures({ result }: {
    result: CalculationResult;
}) { return <><p data-testid="calculation-status">{result.status === 'estimate' ? 'Estimate — supported inputs reviewed' : 'Incomplete — unresolved inputs remain'}</p><p>{result.caveat}</p><dl className="space-y-2">{[['income_tax', 'Income Tax'], ['class4', 'Class 4 NI'], ['class2', 'Class 2 cash charge'], ['tax_withheld', 'Income Tax withheld'], ['actual_tax_payments', 'Actual allocated payments'], ['net_balance', 'Balance after withholding and payments'], ['poa_each', 'Each following-year payment on account'], ['january_combined', 'January balance plus first following-year payment']].map(([id, label]) => <div key={id}><dt className="font-medium">{label}</dt><dd data-testid={'calculation-' + id}>{money(result.totals[id] ?? null)}</dd></div>)}</dl><p>Balancing date: {result.deadlines.balancing}. Following-year payment dates: {result.deadlines.first_poa} and {result.deadlines.second_poa}. Payment dates do not establish that a payment has been made.</p>{result.issues.length > 0 && <section aria-label="Unresolved inputs and review notes"><h3 className="font-semibold">Unresolved inputs and review notes</h3><ul className="list-disc pl-6">{result.issues.map((issue, i) => <li key={i}>{issue.message} {issue.source_ids.length > 0 && <span>Sources: {issue.source_ids.join(', ')}</span>}</li>)}</ul></section>}<details><summary>Calculation and rounding trace</summary><ol>{result.trace.map(line => <li key={line.id} className="my-3"><strong>{line.label}: {money(line.pence)}</strong><p>{line.formula}</p><p>Sources: {line.source_ids.join(', ') || 'Reviewed collection and rules'}; rules: {line.rule_refs.join(', ')}</p></li>)}</ol></details></>; }

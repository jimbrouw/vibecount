import Link from 'next/link';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { emptyFinancePlan, londonPlanningDate } from '@/lib/finance/defaults';
import { readFinanceReview, readFinanceContext, verifyPlanRevision, type PlanRevision } from '@/lib/finance/server';
import { canonicalJson, sha256 } from '@/lib/tax/snapshot';
import { planningRules2026 } from '@/lib/finance/rules';
import FinanceReview from './FinanceReview';
import PlanFigures from './PlanFigures';
import CashBucketsView from './CashBucketsView';
import { financeScenario } from '@/lib/finance/coverage';
import InvoiceCurrencyCoverage from '../InvoiceCurrencyCoverage';
import BankSourceCoverage from '../BankSourceCoverage';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const db = await createClient(), { data: { user }, error } = await db.auth.getUser();
    if (error || !user) redirect('/login');
    const params = await searchParams, today = londonPlanningDate();
    let review: Awaited<ReturnType<typeof readFinanceReview>> | null = null, latest: PlanRevision | null = null, saved: PlanRevision | null = null;
    let history: { id: string; ordinal: number; created_at: string; rationale: string }[] = [], unavailable = false;
    let unpaidInvoicesPence = 0;
    try {
        review = await readFinanceReview(db, user.id);
        const [current, unpaidRes] = await Promise.all([
            db.from('finance_plan_revisions').select('*').eq('user_id', user.id).order('ordinal', { ascending: false }).limit(1).maybeSingle(),
            db.from('invoice_payment_balances').select('outstanding_pence').eq('user_id', user.id).gt('outstanding_pence', 0),
        ]);
        if (current.error) throw new Error('Current plan unavailable.');
        unpaidInvoicesPence = (unpaidRes.data ?? []).reduce((sum, r) => sum + (Number(r.outstanding_pence) || 0), 0);
        latest = current.data as PlanRevision | null;
        if ((latest?.ordinal ?? 0) !== review.context.ordinal) throw new Error('Plan revision changed.');
        if (latest) verifyPlanRevision(latest, user.id);
        let q = db.from('finance_plan_revisions').select('id,ordinal,created_at,rationale').eq('user_id', user.id).order('ordinal', { ascending: false }).limit(20);
        const before = Number(params.before);
        if (Number.isSafeInteger(before) && before > 0) q = q.lt('ordinal', before);
        const h = await q;
        if (h.error) throw new Error('History unavailable.');
        history = h.data;
        if (typeof params.saved === 'string') {
            if (!uuid.test(params.saved)) throw new Error('Choose a saved plan.');
            const r = await db.from('finance_plan_revisions').select('*').eq('user_id', user.id).eq('id', params.saved).single();
            if (r.error || !r.data) throw new Error('Saved plan unavailable.');
            saved = r.data as PlanRevision; verifyPlanRevision(saved, user.id);
        }
        const check = await readFinanceContext(db, user.id);
        if (check.stamp !== review.context.stamp || canonicalJson(check) !== canonicalJson(review.context)) throw new Error('Planning sources changed.');
    } catch { unavailable = true; }
    return <main className="mx-auto max-w-5xl space-y-6 px-5 py-8"><h1 className="text-2xl font-semibold">Cash, reserves and forecast planning</h1>
        <p>Draft planning aid — not submitted to HMRC. Actual balances, receipts, trading profit and tax reserves mean different things. Pension assets are not accessible cash.</p>
        <nav className="flex flex-wrap gap-4"><Link data-testid="finance-invoices-link" href="/dashboard">Invoices and received cash</Link><Link data-testid="finance-records-link" href="/dashboard/records">Recognised records</Link><Link data-testid="finance-tax-link" href="/dashboard/tax-prep/calculation">Historic draft tax calculation</Link><Link data-testid="finance-imports-link" href="/dashboard/imports">Source imports</Link><Link data-testid="finance-deadlines-link" href="/dashboard/finance/deadlines">Review tax deadline reminders</Link><Link data-testid="finance-rollover-link" href="/dashboard/review/memory/rollover">Review annual merchant-rule proposals</Link></nav>
        {params.error && <p role="alert">{String(params.error)}</p>}
        {unavailable || !review ? <p role="alert" data-testid="finance-unavailable">Complete plan, source context or history could not be verified. No current figures are available. Reload before reviewing.</p> : <>
            <CashBucketsView
                actualCashPence={latest ? financeScenario(latest.result).actual_cash_pence : (saved ? financeScenario(saved.result).actual_cash_pence : null)}
                liabilitiesPence={latest ? financeScenario(latest.result).liabilities_pence : (saved ? financeScenario(saved.result).liabilities_pence : null)}
                actualTaxReservePence={latest ? financeScenario(latest.result).actual_tax_reserve_pence : (saved ? financeScenario(saved.result).actual_tax_reserve_pence : null)}
                requiredTaxProtectionPence={latest ? financeScenario(latest.result).required_tax_protection_pence : (saved ? financeScenario(saved.result).required_tax_protection_pence : null)}
                currentFreeCashPence={latest ? financeScenario(latest.result).current_free_cash_pence : (saved ? financeScenario(saved.result).current_free_cash_pence : null)}
                monthlyCostsPence={latest ? latest.input.plan.forecast.monthly_costs_pence : (saved ? saved.input.plan.forecast.monthly_costs_pence : null)}
                monthlyDrawingsPence={latest ? latest.input.plan.forecast.monthly_drawings_pence : (saved ? saved.input.plan.forecast.monthly_drawings_pence : null)}
                unpaidInvoicesPence={unpaidInvoicesPence}
            />
            {saved && <section className="space-y-4 rounded border p-4" data-testid="finance-saved"><h2 className="text-xl font-semibold">Historical saved draft revision {saved.ordinal}</h2><p>As of {saved.input.plan.as_of}; reviewed {saved.created_at}. These retained figures describe that revision. Refresh and review actual balances below before relying on current drawings.</p><p>{saved.rationale}</p>{saved.input.schema_version !== 'finance-plan-input/1' ? <InvoiceCurrencyCoverage value={saved.input.invoice_coverage} owner={user.id} testIdPrefix="finance"/> : <p>Historical snapshot predates explicit invoice currency coverage; its scenario is not a current drawings decision.</p>}{saved.input.schema_version === 'finance-plan-input/3' && <BankSourceCoverage coverage={saved.input.bank_source_coverage} idPrefix="finance-saved-bank"/>}<PlanFigures result={saved.result}/><Link data-testid="finance-export" href={'/api/finance/export?id=' + saved.id}>Export saved inputs, sources, rules and calculation trace</Link></section>}
            <section className="space-y-4"><h2 className="text-xl font-semibold">Current draft review</h2><p>{latest ? `Based on revision ${latest.ordinal}. Review balances and assumptions again; old dates are not silently changed.` : 'Enter your balances and assumptions. No example money or completeness answers are prefilled.'}</p><FinanceReview owner={user.id} invoiceCoverage={review.context.invoice_coverage} bankCoverage={review.context.bank_source_coverage} initial={latest?.input.plan ?? emptyFinancePlan(today)} catalog={review.catalog} today={today} expected={review.context.ordinal} stamp={review.context.stamp} requestId={randomUUID()} rulesHash={sha256(canonicalJson(planningRules2026))}/></section>
            <details><summary>Planning rule sources and limitations</summary><p>{planningRules2026.review_status.replaceAll('_', ' ')}. Source review {planningRules2026.source_reviewed_at}; {planningRules2026.engine_version}. This screen does not enable tax filing.</p><ul>{planningRules2026.sources.map(s => <li key={s.id}><a href={s.url} rel="noreferrer" target="_blank">{s.section}</a></li>)}</ul></details>
            <section><h2 className="text-xl font-semibold">Immutable draft history</h2><ul>{history.map(h => <li key={h.id}><Link data-testid={'finance-history-' + h.id} href={'/dashboard/finance?saved=' + h.id}>Revision {h.ordinal} — {h.created_at}</Link><p>{h.rationale}</p></li>)}</ul>{history.length === 0 && <p>No saved revisions in this page.</p>}{history.at(-1) && history.at(-1)!.ordinal > 1 && <Link data-testid="finance-history-earlier" href={'/dashboard/finance?before=' + history.at(-1)!.ordinal}>Earlier revisions</Link>}</section>
        </>}
    </main>;
}

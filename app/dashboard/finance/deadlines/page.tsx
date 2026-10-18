import Link from 'next/link';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { canonicalJson, sha256 } from '@/lib/tax/snapshot';
import { londonPlanningDate } from '@/lib/finance/defaults';
import { deadlineYear, emptyDeadlinePlan, type DeadlineCatalog } from '@/lib/finance/deadlines/model';
import { deadlineRules, DEADLINE_CAVEAT } from '@/lib/finance/deadlines/rules';
import { currentDeadlineReview, verifyDeadlineSnapshot } from '@/lib/finance/deadlines/snapshot';
import { assertDeadlineProvenance, readDeadlineReview, readDeadlineHistoricalSources, type DeadlineRevision } from '@/lib/finance/deadlines/server';
import { getTaxYearLabel, getCurrentTaxYearStart } from '@/lib/records/tax-periods';
import DeadlineReview from './DeadlineReview';
import DeadlineFigures from './DeadlineFigures';
export default async function DeadlinePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const db = await createClient(), { data: { user }, error } = await db.auth.getUser();
    if (error || !user) redirect('/login');
    const params = await searchParams, today = londonPlanningDate(); let year: number;
    try { if (params.year !== undefined && typeof params.year !== 'string') throw new Error(); year = deadlineYear(params.year === undefined ? getCurrentTaxYearStart(new Date(today + 'T12:00:00Z')) - 1 : Number(params.year)); } catch { return <main><h1>Tax deadline reminders</h1><p role="alert">Choose a supported year.</p><Link href="/dashboard/finance/deadlines?year=2025">Review 2025/26</Link><Link href="/dashboard/finance/deadlines?year=2026">Review 2026/27 proposals</Link></main>; }
    let review: Awaited<ReturnType<typeof readDeadlineReview>> | null = null, latest: DeadlineRevision | null = null, saved: DeadlineRevision | null = null, current: ReturnType<typeof currentDeadlineReview> | null = null;
    let savedSources: DeadlineCatalog | null = null, history: { id: string; ordinal: number; created_at: string; rationale: string }[] = [], unavailable = false;
    try {
        review = await readDeadlineReview(db, user.id, year);
        const r = await db.from('tax_deadline_revisions').select('*').eq('user_id', user.id).eq('tax_year_start', year).order('ordinal', { ascending: false }).limit(1).maybeSingle();
        if (r.error) throw new Error(); latest = r.data as DeadlineRevision | null;
        if ((latest?.ordinal ?? 0) !== review.context.ordinal) throw new Error('Review changed.');
        if (latest) { assertDeadlineProvenance(latest, user.id); current = currentDeadlineReview(latest, user.id, await readDeadlineHistoricalSources(db, user.id, latest), review.catalog, today); }
        let q = db.from('tax_deadline_revisions').select('id,ordinal,created_at,rationale').eq('user_id', user.id).eq('tax_year_start', year).order('ordinal', { ascending: false }).limit(20);
        const before = Number(params.before); if (Number.isSafeInteger(before) && before > 0) q = q.lt('ordinal', before);
        const h = await q; if (h.error) throw new Error(); history = h.data;
        if (params.saved !== undefined) {
            if (typeof params.saved !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(params.saved)) throw new Error();
            const s = await db.from('tax_deadline_revisions').select('*').eq('user_id', user.id).eq('tax_year_start', year).eq('id', params.saved).maybeSingle();
            if (s.error || !s.data) throw new Error(); saved = s.data as DeadlineRevision; assertDeadlineProvenance(saved, user.id);
            savedSources = await readDeadlineHistoricalSources(db, user.id, saved); verifyDeadlineSnapshot(saved, user.id, savedSources);
        }
        const after = await db.rpc('read_tax_deadline_context', { p_year: year }); if (after.error || after.data?.stamp !== review.context.stamp) throw new Error('Sources changed.');
    } catch { unavailable = true; }
    return <main className="mx-auto max-w-5xl space-y-6 p-5"><h1 className="text-2xl font-semibold">Reviewed tax deadline reminders</h1><p>{DEADLINE_CAVEAT}</p>
        <nav className="flex flex-wrap gap-4"><Link data-testid="deadline-cash-link" href="/dashboard/finance">Review cash commitments</Link><Link data-testid="deadline-tax-link" href="/dashboard/tax-prep">Tax preparation</Link><Link data-testid="deadline-year-2025" href="?year=2025">2025/26 reminders</Link><Link data-testid="deadline-year-2026" href="?year=2026">2026/27 planning proposals</Link></nav>
        <p>Selected liability year: {getTaxYearLabel(year)}. Reminders appear when you open this page. No background/email delivery is enabled.</p>
        {params.error && <p role="alert">{String(params.error).slice(0, 500)}</p>}
        {unavailable || !review ? <p role="alert" data-testid="deadline-unavailable">Complete current sources, reminder history or integrity could not be verified. Current reminders are unavailable. Reload before reviewing.</p> : <>
            <section data-testid="deadline-current" className="space-y-3"><h2 className="text-xl font-semibold">Current in-app reminders</h2>{!latest ? <p>No saved reminder review. Applicability and dates remain unresolved.</p> : current?.stale ? <p role="alert" data-testid="deadline-source-stale">{current.message} Active reminders are withheld. Review the new proposals below.</p> : current?.result ? <DeadlineFigures result={current.result}/> : <p>Current reminder state unavailable.</p>}</section>
            {saved && savedSources && <section data-testid="deadline-saved" className="space-y-3 rounded border p-4"><h2 className="text-xl font-semibold">Historical review revision {saved.ordinal}</h2><p>Saved {saved.created_at}; phases below were evaluated {saved.input.evaluated_on}. These are retained historical states, not current reminders.</p><p>{saved.rationale}</p><DeadlineFigures result={saved.result}/><Link data-testid="deadline-export" href={'/api/finance/deadlines/export?id=' + saved.id}>Export this immutable review and sources</Link></section>}
            <section><h2 className="text-xl font-semibold">Review reminder settings</h2>{current?.stale && <p>Changed sources reset proposals to unresolved. No earlier applicability or acknowledgement was silently carried forward.</p>}<DeadlineReview initial={latest && current && !current.stale ? latest.input.plan : emptyDeadlinePlan(year, review.catalog)} catalog={review.catalog} today={today} expected={review.context.ordinal} stamp={review.context.stamp} requestId={randomUUID()} rulesHash={sha256(canonicalJson(deadlineRules))}/></section>
            <details><summary>Deadline sources and review limits</summary><p>Source review {deadlineRules.source_reviewed_at}; engineering re-review by {deadlineRules.review_by}. {deadlineRules.review_status.replaceAll('_', ' ')}.</p><ul>{deadlineRules.sources.map(s => <li key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.section}</a></li>)}</ul></details>
            <section><h2 className="text-xl font-semibold">Immutable review history</h2><ul>{history.map(h => <li key={h.id}><Link data-testid={'deadline-history-' + h.id} href={`?year=${year}&saved=${h.id}`}>Revision {h.ordinal} — {h.created_at}</Link><p>{h.rationale}</p></li>)}</ul>{history.length === 0 && <p>No saved history in this page.</p>}{history.at(-1) && history.at(-1)!.ordinal > 1 && <Link data-testid="deadline-history-earlier" href={`?year=${year}&before=${history.at(-1)!.ordinal}`}>Earlier review history</Link>}</section>
        </>}
    </main>;
}

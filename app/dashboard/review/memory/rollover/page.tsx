import Link from 'next/link';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { readAllExportRows } from '@/lib/records/export-pages';
import { readFinancialStamp } from '@/lib/records/consistent-reconciliation';
import { getCurrentTaxYearStart, getTaxYearLabel } from '@/lib/records/tax-periods';
import { londonPlanningDate } from '@/lib/finance/defaults';
import { redactBankDetailsForPrompt } from '@/lib/ai/redaction';
import { proposeMerchantRollover, type RolloverRule, type RolloverLink } from '@/lib/records/merchant-rollover';
import type { MerchantChoice, MerchantCategory } from '@/lib/records/merchant-memory';
import { MerchantRuleReview } from '../MerchantReview';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export default async function RolloverPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const db = await createClient(), { data: { user }, error } = await db.auth.getUser();
    if (error || !user) redirect('/login');
    const params = await searchParams, candidate = Number(params.target), target = Number.isInteger(candidate) && candidate >= 2001 && candidate <= 2100 ? candidate : getCurrentTaxYearStart(new Date(londonPlanningDate() + 'T12:00:00Z'));
    const page = typeof params.page === 'string' && /^\d{1,6}$/.test(params.page) ? Math.max(1, Number(params.page)) : 1;
    let rules: RolloverRule[] = [], links: RolloverLink[] = [], accounts: { id: string; label: string; masked_identifier: string }[] = [], categories: MerchantCategory[] = [], stamp = '', selected: RolloverRule | undefined, seed: MerchantChoice | undefined, unavailable = false;
    try {
        stamp = await readFinancialStamp(() => db.rpc('reconciliation_export_stamp'));
        rules = await readAllExportRows<RolloverRule>(async after => {
            let q = db.from('current_merchant_rules').select('id,rule_id,ordinal,match_key,record_type,status,account_id,tax_year_start,effective_from,expires_on,priority,classification,business_use_bps,category_id,evidence_status,seed_transaction_id,category_valid').eq('user_id', user.id).order('id').limit(500);
            if (after) q = q.gt('id', after); return await q;
        });
        links = await readAllExportRows<RolloverLink>(async after => {
            let q = db.from('merchant_rule_rollovers').select('id,source_rule_id,source_version_id,target_rule_id,target_version_id,target_tax_year_start,rationale,author,request_id,created_at').eq('user_id', user.id).eq('target_tax_year_start', target).order('id').limit(500);
            if (after) q = q.gt('id', after); return await q;
        });
        categories = await readAllExportRows<MerchantCategory>(async after => { let q = db.from('record_categories').select('id,name,record_type').or(`user_id.eq.${user.id},and(user_id.is.null,is_default.eq.true)`).order('id').limit(500); if (after) q = q.gt('id', after); return await q; });
        accounts = await readAllExportRows(async after => { let q = db.from('financial_accounts').select('id,label,masked_identifier').eq('user_id', user.id).order('id').limit(500); if (after) q = q.gt('id', after); return await q; });
        accounts = accounts.map(a => ({ ...a, label: redactBankDetailsForPrompt(a.label) }));
        rules = rules.map(r => ({ ...r, match_key: redactBankDetailsForPrompt(r.match_key) }));
        if (typeof params.source === 'string') {
            if (!uuid.test(params.source)) throw new Error('Choose a source version.');
            selected = rules.find(r => r.id === params.source);
            if (!selected) throw new Error('Source version changed.');
            const s = await db.from('merchant_transaction_choices').select('*').eq('id', selected.seed_transaction_id).eq('user_id', user.id).maybeSingle();
            if (s.error || !s.data) throw new Error('Source unavailable.'); seed = s.data as MerchantChoice;
        }
        if (await readFinancialStamp(() => db.rpc('reconciliation_export_stamp')) !== stamp) throw new Error('Source/target context changed.');
    } catch { unavailable = true; }
    const candidates = rules.filter(r => r.tax_year_start === target - 1).sort((a, b) => a.match_key.localeCompare(b.match_key) || a.id.localeCompare(b.id));
    const proposal = selected ? proposeMerchantRollover(selected, target, rules, links) : null;
    return <main className="mx-auto max-w-5xl space-y-6 p-5"><h1 className="text-2xl font-semibold">Review annual merchant-rule rollover</h1><p>Proposals for {getTaxYearLabel(target)}. Prior-year rules, evidence and transaction approvals are not automatically carried forward. All-year rules already have their own scope and are not annual rollover candidates.</p>
        <nav className="flex flex-wrap gap-4"><Link data-testid="rollover-memory-link" href={`/dashboard/review/memory?year=${target}`}>Target-year expense review</Link><Link data-testid="rollover-prior-link" href={`/dashboard/review/memory?year=${target - 1}`}>Prior-year rules</Link><Link data-testid="rollover-finance-link" href="/dashboard/finance">Cash planning</Link><a data-testid="rollover-export-link" href="/api/review/memory/export">Export rules, decisions and rollover ancestry</a></nav>
        <form data-testid="rollover-year-form"><label>Target tax-year start<input data-testid="rollover-target-year" className="ml-2 rounded border p-2" name="target" type="number" min={2001} max={2100} defaultValue={target}/></label><button data-testid="rollover-open-year" className="ml-2 rounded border p-2">Open rollover proposals</button></form>
        {typeof params.error === 'string' && <p role="alert">{params.error.slice(0, 500)}</p>}
        {unavailable ? <p role="alert" data-testid="rollover-unavailable">Complete source/target rules, evidence or history could not be verified. Reload before reviewing.</p> : <>
            {typeof params.saved === 'string' && uuid.test(params.saved) && links.some(l => l.target_rule_id === params.saved) && <p role="status">Separate target-year rule saved. No transaction was approved. <Link data-testid="rollover-saved-rule" href={`/dashboard/review/memory?year=${target}&rule=${params.saved}`}>Review its latest revision or status</Link></p>}
            {proposal && <section className="space-y-3 rounded border p-4" data-testid="rollover-selected"><h2 className="text-xl font-semibold">Source: {proposal.source.match_key}</h2><p>Source family {proposal.source.rule_id}, revision {proposal.source.ordinal}; {proposal.source.effective_from} to {proposal.source.expires_on ?? 'no expiry'}; {proposal.source.classification} at {proposal.source.business_use_bps / 100}%.</p>
                <ul>{proposal.warnings.map(w => <li key={w}>{w}</li>)}</ul>
                <Link data-testid="rollover-source-edit" href={`/dashboard/review/memory?year=${target - 1}&rule=${proposal.source.rule_id}`}>Review the prior-year source rule</Link>
                {proposal.overlapping_rules.map(r => <p key={r.id}><Link data-testid={'rollover-overlap-' + r.id} href={`/dashboard/review/memory?year=${target}&rule=${r.rule_id}`}>Review overlapping rule {r.rule_id}</Link></p>)}
                {proposal.existing && <p><Link data-testid="rollover-existing-target" href={`/dashboard/review/memory?year=${target}&rule=${proposal.existing.target_rule_id}`}>Review the saved target rule instead</Link></p>}
                {proposal.blocked.length > 0 && <ul role="alert" data-testid="rollover-blocked">{proposal.blocked.map(b => <li key={b}>{b}</li>)}</ul>}
                {seed && (seed.import_status === 'discarded' || seed.dedupe_status !== 'clear') && <p role="alert">Source evidence needs identity/recovery review before rollover.</p>}
                {!proposal.blocked.length && seed && seed.import_status !== 'discarded' && seed.dedupe_status === 'clear' && <MerchantRuleReview seed={seed} rule={proposal.proposed} categories={categories} accounts={accounts} stamp={stamp} requestId={randomUUID()} reviewYear={target} rollover={{ sourceVersionId: proposal.source.id, targetYear: target, conflicts: proposal.overlapping_rules }}/>}
            </section>}
            <section><h2 className="text-xl font-semibold">Prior-year rules</h2><p>{candidates.length} current rule families scoped to {getTaxYearLabel(target - 1)}. Completed rollovers remain in history.</p>{candidates.slice((page - 1) * 20, page * 20).map(r => { const p = proposeMerchantRollover(r, target, rules, links); return <article className="my-3 rounded border p-3" key={r.id}><h3>{r.match_key} — {r.classification}</h3><p>{p.blocked.length ? p.blocked.join(' ') : 'Unreviewed new-year proposal; no rollover saved.'}</p><Link data-testid={'rollover-review-' + r.id} href={`?target=${target}&source=${r.id}`}>Review source and proposed scope</Link>{p.existing && <p><Link data-testid={'rollover-target-' + p.existing.id} href={`/dashboard/review/memory?year=${target}&rule=${p.existing.target_rule_id}`}>Review saved target rule</Link></p>}{p.overlapping_rules.map(other => <p key={other.id}><Link href={`/dashboard/review/memory?year=${target}&rule=${other.rule_id}`}>Review overlapping target rule</Link></p>)}</article>; })}{!candidates.length && <p>No prior-year scoped rule families. Create a reviewed merchant rule from an owned source first.</p>}
                <nav aria-label="Rollover proposal pages">{page > 1 && <Link data-testid="rollover-previous" href={`?target=${target}&page=${page - 1}`}>Previous proposals</Link>}{page * 20 < candidates.length && <Link data-testid="rollover-next" href={`?target=${target}&page=${page + 1}`}>More proposals</Link>}</nav>
            </section>
        </>}
    </main>;
}

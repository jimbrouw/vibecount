import type { DeadlineResult, DeadlinePhase } from '@/lib/finance/deadlines/model';
import { getTaxYearLabel } from '@/lib/records/tax-periods';
import { DEADLINE_CAVEAT } from '@/lib/finance/deadlines/rules';
import { planMoney } from '../PlanFigures';
const phases: Record<DeadlinePhase, string> = { unreviewed: 'Applicability unresolved', date_review_required: 'Review the applicable date', not_applicable: 'Reviewed as not applicable', acknowledged: 'Reminder handled — payment and filing status not established', scheduled: 'Scheduled in-app reminder', reminder_active: 'Reminder active', due_today: 'Task due today — check actual status', past_due: 'Reviewed date has passed — check actual status', rules_stale: 'Guidance needs renewed review', source_review_required: 'Source date needs review' };
export default function DeadlineFigures({ result }: { result: DeadlineResult }) {
    return <section data-testid="deadline-readback" className="space-y-3"><p>{DEADLINE_CAVEAT}</p><p>Evaluated {result.evaluated_on}; liability year {getTaxYearLabel(result.tax_year_start)}. {result.active_count} active reminder(s); {result.needs_review_count} item(s) need review. Payment and filing status remain unverified.</p>
        <ul>{result.warnings.map(w => <li key={w}>{w}</li>)}</ul>
        <ul className="space-y-3">{result.items.map(i => <li className="rounded border p-3" key={i.id} data-testid={'deadline-readback-' + i.id}><strong>{i.title}</strong><p>{phases[i.phase]}</p><p>Proposed/source date {i.proposed_due_date}; reviewed due date {i.due_date ?? 'unresolved'}; remind from {i.remind_from ?? 'not enabled'}.</p><p>{i.source_kind === 'general_calendar' ? 'General calendar proposal — no amount established.' : `Saved unpaid commitment as of ${i.commitment_as_of}: ${i.amount_pence === null ? 'amount unknown' : planMoney(i.amount_pence)}. Not a live HMRC balance.`}</p></li>)}</ul>
    </section>;
}

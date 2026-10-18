import { planningDate } from '../plan';
import { redactBankDetailsForPrompt } from '../../ai/redaction';
import { deadlineRules } from './rules';

export type PlanReference = { id: string; user_id: string; ordinal: number; as_of: string; input_sha256: string; result_sha256: string };
export type DeadlineObligation = { id: string; label: string; tax_year_start: number; due_date: string; amount_pence: number | null };
export type NoticeDocument = { id: string; user_id: string; file_sha256: string };
export type DeadlineCatalog = {
    owner_id: string; finance_plan: PlanReference | null; obligations: DeadlineObligation[];
    unassigned_tax_obligations: number; documents: NoticeDocument[];
};
export type DeadlineChoice = {
    id: string; applicability: 'unknown' | 'applies' | 'not_applicable'; disposition: 'open' | 'acknowledged';
    date_basis: 'unreviewed' | 'standard' | 'notice' | 'saved_obligation';
    notice_due_date: string | null; notice_document_id: string | null; lead_days: 0 | 7 | 14 | 30;
};
export type DeadlinePlan = { schema_version: 'tax-deadline-plan/1'; tax_year_start: number; entries: DeadlineChoice[] };
export type DeadlineProposal = {
    id: string; title: string; tax_year_start: number; source_kind: 'general_calendar' | 'saved_commitment';
    source_id: string; proposed_due_date: string; amount_pence: number | null; commitment_as_of: string | null; source_refs: string[];
};
export type DeadlinePhase = 'unreviewed' | 'date_review_required' | 'not_applicable' | 'acknowledged' | 'scheduled' | 'reminder_active' | 'due_today' | 'past_due' | 'rules_stale' | 'source_review_required';
export type DeadlineItem = DeadlineProposal & DeadlineChoice & { due_date: string | null; remind_from: string | null; phase: DeadlinePhase };
export type DeadlineResult = {
    engine_version: string; ruleset_id: string; evaluated_on: string; tax_year_start: number;
    status: 'review_required' | 'reviewed_reminders'; warnings: string[]; items: DeadlineItem[];
    active_count: number; needs_review_count: number;
};
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i, hash = /^[a-f0-9]{64}$/;
function object(value: unknown, keys: string[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
        throw new Error('Review a plain deadline object.');
    const v = value as Record<string, unknown>;
    if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) throw new Error('Review all deadline fields; unexpected fields are not retained.');
    return v;
}
function option<T extends string>(value: unknown, choices: readonly T[]): T {
    if (typeof value !== 'string' || !choices.includes(value as T)) throw new Error('Review the deadline choice.');
    return value as T;
}
function id(value: unknown, isUuid = false): string {
    if (typeof value !== 'string' || !(isUuid ? uuid : /^[a-zA-Z0-9_:-]{1,100}$/).test(value)) throw new Error('Review the deadline identity.');
    return value;
}
export function deadlineYear(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || !(deadlineRules.supported_years as readonly number[]).includes(value))
        throw new Error('Deadline rules are available only for reviewed supported years 2025/26 and 2026/27.');
    return value;
}
function array(value: unknown): unknown[] {
    if (!Array.isArray(value) || value.length > 107) throw new Error('Review the bounded deadline list.');
    return value;
}
/** Strip no fields silently at this boundary: retained sources must have an exact, safe shape. */
export function validateDeadlineCatalog(owner: string, year: number, value: unknown): DeadlineCatalog {
    id(owner, true); deadlineYear(year);
    const c = object(value, ['owner_id', 'finance_plan', 'obligations', 'unassigned_tax_obligations', 'documents']);
    if (c.owner_id !== owner) throw new Error('Deadline sources are not owned.');
    let finance: PlanReference | null = null;
    if (c.finance_plan !== null) {
        const p = object(c.finance_plan, ['id', 'user_id', 'ordinal', 'as_of', 'input_sha256', 'result_sha256']);
        if (p.user_id !== owner || !Number.isSafeInteger(p.ordinal) || (p.ordinal as number) < 1 || typeof p.input_sha256 !== 'string' || !hash.test(p.input_sha256) || typeof p.result_sha256 !== 'string' || !hash.test(p.result_sha256)) throw new Error('Review saved commitment provenance.');
        finance = { id: id(p.id, true), user_id: owner, ordinal: p.ordinal as number, as_of: planningDate(p.as_of), input_sha256: p.input_sha256, result_sha256: p.result_sha256 };
    }
    const obligations = array(c.obligations).map(value => {
        const o = object(value, ['id', 'label', 'tax_year_start', 'due_date', 'amount_pence']);
        if (!finance || o.tax_year_start !== year || typeof o.label !== 'string' || !o.label.trim() || o.label.length > 120 || /[\u0000-\u001f\u007f]/.test(o.label)) throw new Error('Review the owned, year-specific commitment.');
        if (o.amount_pence !== null && (!Number.isSafeInteger(o.amount_pence) || (o.amount_pence as number) < 0 || (o.amount_pence as number) > 999999999999)) throw new Error('Use exact unpaid pence or unknown.');
        const label = redactBankDetailsForPrompt(o.label.trim());
        if (label !== o.label) throw new Error('Remove private details from the commitment label before review.');
        return { id: id(o.id), label, tax_year_start: year, due_date: planningDate(o.due_date), amount_pence: o.amount_pence as number | null };
    }).sort((a, b) => a.id.localeCompare(b.id));
    if (new Set(obligations.map(o => o.id)).size !== obligations.length) throw new Error('Commitments must have unique identities.');
    if (!Number.isSafeInteger(c.unassigned_tax_obligations) || (c.unassigned_tax_obligations as number) < 0 || (c.unassigned_tax_obligations as number) > 100 || (!finance && c.unassigned_tax_obligations !== 0) || obligations.length + (c.unassigned_tax_obligations as number) > 100) throw new Error('Review unresolved commitment years.');
    // Document catalog size is independent of the bounded plan. Only selected evidence is frozen later.
    if (!Array.isArray(c.documents) || c.documents.length > 10000) throw new Error('Notice evidence catalog unavailable.');
    const documents = c.documents.map(value => {
        const d = object(value, ['id', 'user_id', 'file_sha256']);
        if (d.user_id !== owner || typeof d.file_sha256 !== 'string' || !hash.test(d.file_sha256)) throw new Error('Notice evidence is not owned or verified.');
        return { id: id(d.id, true), user_id: owner, file_sha256: d.file_sha256 };
    }).sort((a, b) => a.id.localeCompare(b.id));
    if (new Set(documents.map(d => d.id)).size !== documents.length) throw new Error('Notice evidence identities must be unique.');
    return { owner_id: owner, finance_plan: finance, obligations, unassigned_tax_obligations: c.unassigned_tax_obligations as number, documents };
}
export function proposeDeadlines(year: number, catalog: DeadlineCatalog): DeadlineProposal[] {
    deadlineYear(year);
    const calendar = deadlineRules.calendar.map(r => ({ id: 'calendar:' + r.id, title: r.title, tax_year_start: year, source_kind: 'general_calendar' as const, source_id: r.id,
        proposed_due_date: `${year + r.year_offset}-${r.month_day}`, amount_pence: null, commitment_as_of: null, source_refs: [r.source] }));
    return [...calendar, ...catalog.obligations.map(o => ({ id: 'commitment:' + o.id, title: o.label, tax_year_start: year, source_kind: 'saved_commitment' as const, source_id: o.id,
        proposed_due_date: o.due_date, amount_pence: o.amount_pence, commitment_as_of: catalog.finance_plan!.as_of, source_refs: ['saved_finance_plan'] }))];
}
export function emptyDeadlinePlan(year: number, catalog: DeadlineCatalog): DeadlinePlan {
    return { schema_version: 'tax-deadline-plan/1', tax_year_start: deadlineYear(year), entries: proposeDeadlines(year, catalog).map(p => ({ id: p.id, applicability: 'unknown', disposition: 'open', date_basis: 'unreviewed', notice_due_date: null, notice_document_id: null, lead_days: 14 })) };
}
export function validateDeadlinePlan(value: unknown, catalog: DeadlineCatalog): DeadlinePlan {
    const p = object(value, ['schema_version', 'tax_year_start', 'entries']), year = deadlineYear(p.tax_year_start);
    if (p.schema_version !== 'tax-deadline-plan/1') throw new Error('Unsupported deadline plan version.');
    const proposals = proposeDeadlines(year, catalog), byId = new Map(proposals.map(p => [p.id, p]));
    const entries = array(p.entries).map(value => {
        const e = object(value, ['id', 'applicability', 'disposition', 'date_basis', 'notice_due_date', 'notice_document_id', 'lead_days']);
        const identity = id(e.id), proposal = byId.get(identity);
        if (!proposal) throw new Error('A deadline source changed or is foreign.');
        const applicability = option(e.applicability, ['unknown', 'applies', 'not_applicable']), disposition = option(e.disposition, ['open', 'acknowledged']);
        const date_basis = option(e.date_basis, ['unreviewed', 'standard', 'notice', 'saved_obligation']);
        if (![0, 7, 14, 30].includes(e.lead_days as number) || typeof e.lead_days !== 'number') throw new Error('Choose a supported reminder lead time.');
        if (proposal.source_kind === 'saved_commitment' ? !['unreviewed', 'saved_obligation'].includes(date_basis) : date_basis === 'saved_obligation') throw new Error('Review the date at its original source.');
        let notice_due_date: string | null = null, notice_document_id: string | null = null;
        if (date_basis === 'notice') {
            notice_due_date = planningDate(e.notice_due_date); notice_document_id = id(e.notice_document_id, true);
            if (!catalog.documents.some(d => d.id === notice_document_id)) throw new Error('Choose owned notice evidence.');
        } else if (e.notice_due_date !== null || e.notice_document_id !== null) throw new Error('Remove unused notice details instead of retaining ambiguous dates.');
        if (disposition === 'acknowledged' && (applicability !== 'applies' || date_basis === 'unreviewed')) throw new Error('Review applicability and date before acknowledging this reminder.');
        return { id: identity, applicability, disposition, date_basis, notice_due_date, notice_document_id, lead_days: e.lead_days as DeadlineChoice['lead_days'] };
    });
    if (entries.length !== proposals.length || new Set(entries.map(e => e.id)).size !== proposals.length) throw new Error('Review every proposal once; exclusions remain in history.');
    // Stable canonical order independent of browser selection/order.
    entries.sort((a, b) => a.id.localeCompare(b.id));
    return { schema_version: 'tax-deadline-plan/1', tax_year_start: year, entries };
}
/** Date-only subtraction uses UTC days; London time is used only to select today's date. */
export function reminderDate(due: string, leadDays: DeadlineChoice['lead_days']): string {
    planningDate(due);
    if (![0, 7, 14, 30].includes(leadDays)) throw new Error('Review lead days.');
    return planningDate(new Date(Date.parse(due + 'T00:00:00Z') - leadDays * 86400000).toISOString().slice(0, 10));
}
export function evaluateDeadlines(value: unknown, catalog: DeadlineCatalog, today: string): DeadlineResult {
    planningDate(today);
    const plan = validateDeadlinePlan(value, catalog), safe = validateDeadlineCatalog(catalog.owner_id, plan.tax_year_start, catalog);
    const proposals = new Map(proposeDeadlines(plan.tax_year_start, safe).map(p => [p.id, p]));
    const staleRules = today > deadlineRules.review_by;
    const items: DeadlineItem[] = plan.entries.map(e => {
        const p = proposals.get(e.id)!;
        const due_date = e.date_basis === 'unreviewed' ? null : e.date_basis === 'notice' ? e.notice_due_date! : p.proposed_due_date;
        const remind_from = e.applicability === 'applies' && due_date ? reminderDate(due_date, e.lead_days) : null;
        const phase: DeadlinePhase = e.applicability === 'not_applicable' ? 'not_applicable' : e.applicability === 'unknown' ? 'unreviewed'
            : e.disposition === 'acknowledged' ? 'acknowledged' : staleRules ? 'rules_stale' : p.commitment_as_of !== null && p.commitment_as_of > today ? 'source_review_required' : !due_date ? 'date_review_required'
                : today > due_date ? 'past_due' : today === due_date ? 'due_today' : today >= remind_from! ? 'reminder_active' : 'scheduled';
        return { ...p, ...e, due_date, remind_from, phase };
    });
    const warnings = [
        'General payment dates and saved commitments can refer to the same event. They are reminders, never additive liabilities.',
        'Acknowledged means reminder handled, not paid, filed or submitted. Check payment arrival time separately.',
    ];
    if (plan.tax_year_start === 2026) warnings.push('2026/27 calendar dates are general recurring planning proposals; confirm your personal dates and current guidance.');
    if (!safe.finance_plan) warnings.push('No reviewed cash plan is linked. Payment amounts and the completeness of unpaid commitments are unknown.');
    else warnings.push(`Saved commitment amounts describe the reviewed cash plan as of ${safe.finance_plan.as_of}; they are not a live HMRC balance or evidence that a payment is still outstanding.`);
    if (safe.finance_plan && safe.finance_plan.as_of > today) warnings.push('The commitment source has a future as-of date. Review that date in cash planning before enabling its reminders.');
    if (safe.unassigned_tax_obligations) warnings.push(`${safe.unassigned_tax_obligations} saved tax commitment(s) have no tax-year allocation. Resolve them in cash planning; none was assigned to this year automatically.`);
    if (staleRules) warnings.push('Deadline guidance needs a new rules review. Active open reminders are withheld; saved history is retained.');
    const needs_review_count = items.filter(i => ['unreviewed', 'date_review_required', 'rules_stale', 'source_review_required'].includes(i.phase)).length;
    return { engine_version: deadlineRules.engine_version, ruleset_id: deadlineRules.id, evaluated_on: today, tax_year_start: plan.tax_year_start,
        status: needs_review_count || safe.unassigned_tax_obligations || staleRules ? 'review_required' : 'reviewed_reminders', warnings, items,
        active_count: items.filter(i => ['reminder_active', 'due_today', 'past_due'].includes(i.phase)).length, needs_review_count };
}

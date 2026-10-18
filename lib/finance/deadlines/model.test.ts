import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDeadlines, emptyDeadlinePlan, proposeDeadlines, reminderDate, validateDeadlineCatalog, type DeadlineCatalog, type DeadlineChoice } from './model';
import { londonPlanningDate } from '../defaults';

const owner = '10000000-0000-4000-8000-000000000001', other = '20000000-0000-4000-8000-000000000002';
const document = { id: '30000000-0000-4000-8000-000000000003', user_id: owner, file_sha256: 'a'.repeat(64) };
function catalog(): DeadlineCatalog { return { owner_id: owner, finance_plan: null, obligations: [], unassigned_tax_obligations: 0, documents: [document] }; }
function active(id = 'calendar:online', patch: Partial<DeadlineChoice> = {}) {
    const c = catalog(), p = emptyDeadlinePlan(2025, c);
    Object.assign(p.entries.find(e => e.id === id)!, { applicability: 'applies', date_basis: 'standard', ...patch });
    return { c, p };
}

test('annual deadline goldens distinguish filing, balancing and the liability year of POA', () => {
    const dates = (year: number) => Object.fromEntries(proposeDeadlines(year, catalog()).map(p => [p.source_id, p.proposed_due_date]));
    assert.deepEqual(dates(2025), { register: '2026-10-05', paper: '2026-10-31', online: '2027-01-31', tax_code: '2026-12-30', balancing: '2027-01-31', first_poa: '2026-01-31', second_poa: '2026-07-31' });
    assert.deepEqual(dates(2026), { register: '2027-10-05', paper: '2027-10-31', online: '2028-01-31', tax_code: '2027-12-30', balancing: '2028-01-31', first_poa: '2027-01-31', second_poa: '2027-07-31' });
    assert.ok(proposeDeadlines(2026, catalog()).every(p => p.tax_year_start === 2026 && p.amount_pence === null));
    for (const invalid of [2024, 2027, 2025.5, '2025', null, NaN]) assert.throws(() => emptyDeadlinePlan(invalid as number, catalog()));
});
test('an unreviewed proposal is never an active reminder, an unpaid demand or evidence of filing', () => {
    const c = catalog(), r = evaluateDeadlines(emptyDeadlinePlan(2025, c), c, '2027-02-01');
    assert.equal(r.active_count, 0); assert.equal(r.needs_review_count, 7); assert.equal(r.status, 'review_required');
    assert.ok(r.items.every(i => i.phase === 'unreviewed' && i.due_date === null && i.remind_from === null && i.amount_pence === null));
    assert.ok(r.warnings.some(w => w.includes('unknown')));
});
test('lead, due and past-due phases use date-only comparisons without advancing a weekend due date', () => {
    const { c, p } = active();
    const phase = (day: string) => evaluateDeadlines(p, c, day).items.find(i => i.id === 'calendar:online')!;
    assert.equal(phase('2027-01-16').phase, 'scheduled');
    assert.equal(phase('2027-01-17').phase, 'reminder_active');
    assert.equal(phase('2027-01-31').phase, 'due_today'); // Sunday: statutory date remains explicit.
    assert.equal(phase('2027-02-01').phase, 'past_due');
    assert.equal(phase('2027-01-31').due_date, '2027-01-31');
    assert.equal(reminderDate('2024-03-01', 14), '2024-02-16');
    assert.equal(reminderDate('2026-04-06', 7), '2026-03-30');
    assert.throws(() => reminderDate('2026-02-30', 7)); assert.throws(() => reminderDate('2026-10-05', 5 as 7));
});
test('London selects the civil day across BST midnight, the tax-year boundary and DST without changing dates', () => {
    assert.equal(londonPlanningDate(new Date('2026-04-05T22:59:59Z')), '2026-04-05');
    assert.equal(londonPlanningDate(new Date('2026-04-05T23:00:00Z')), '2026-04-06');
    assert.equal(londonPlanningDate(new Date('2026-03-29T00:59:59Z')), '2026-03-29');
    assert.equal(londonPlanningDate(new Date('2026-03-29T01:00:00Z')), '2026-03-29');
    assert.equal(londonPlanningDate(new Date('2026-10-25T01:30:00Z')), '2026-10-25');
    const { c, p } = active('calendar:paper');
    assert.equal(evaluateDeadlines(p, c, londonPlanningDate(new Date('2026-10-30T23:59:59Z'))).items.find(i => i.id === 'calendar:paper')!.phase, 'reminder_active');
    assert.equal(evaluateDeadlines(p, c, '2026-10-31').items.find(i => i.id === 'calendar:paper')!.phase, 'due_today');
});
test('applicability, reviewed dates and acknowledgement are independent explicit decisions', () => {
    const { c, p } = active('calendar:online', { date_basis: 'unreviewed' });
    const item = () => evaluateDeadlines(p, c, '2027-01-31').items.find(i => i.id === 'calendar:online')!;
    assert.equal(item().phase, 'date_review_required');
    Object.assign(p.entries.find(e => e.id === 'calendar:online')!, { disposition: 'acknowledged' });
    assert.throws(item);
    Object.assign(p.entries.find(e => e.id === 'calendar:online')!, { date_basis: 'standard' });
    assert.equal(item().phase, 'acknowledged'); assert.equal(evaluateDeadlines(p, c, '2027-01-31').active_count, 0);
    Object.assign(p.entries.find(e => e.id === 'calendar:online')!, { disposition: 'open', applicability: 'not_applicable' });
    assert.equal(item().phase, 'not_applicable');
    Object.assign(p.entries.find(e => e.id === 'calendar:online')!, { applicability: 'unknown' });
    assert.equal(item().phase, 'unreviewed');
});
test('a personal notice needs owned evidence and changes its own date, never the payment deadline', () => {
    const { c, p } = active('calendar:online', { date_basis: 'notice', notice_due_date: '2027-03-15', notice_document_id: document.id });
    const r = evaluateDeadlines(p, c, '2027-02-01'), online = r.items.find(i => i.id === 'calendar:online')!;
    assert.equal(online.proposed_due_date, '2027-01-31'); assert.equal(online.due_date, '2027-03-15'); assert.equal(online.phase, 'scheduled');
    assert.equal(r.items.find(i => i.id === 'calendar:balancing')!.proposed_due_date, '2027-01-31');
    assert.throws(() => evaluateDeadlines(p, { ...c, documents: [] }, '2027-02-01'));
    assert.throws(() => evaluateDeadlines(p, { ...c, documents: [{ ...document, user_id: other }] }, '2027-02-01'));
    Object.assign(p.entries.find(e => e.id === 'calendar:online')!, { date_basis: 'standard' });
    assert.throws(() => evaluateDeadlines(p, c, '2027-02-01')); // No hidden retained notice when selecting standard date.
});
test('saved unpaid commitments preserve unknown and zero, and cannot be rewritten via deadline controls', () => {
    const c: DeadlineCatalog = { ...catalog(), finance_plan: { id: document.id, user_id: owner, ordinal: 1, as_of: '2026-10-17', input_sha256: 'b'.repeat(64), result_sha256: 'c'.repeat(64) }, obligations: [
        { id: 'unknown', label: 'Check amount on statement', tax_year_start: 2025, due_date: '2027-01-31', amount_pence: null },
        { id: 'zero', label: 'Reviewed zero remaining', tax_year_start: 2025, due_date: '2027-01-31', amount_pence: 0 },
    ], unassigned_tax_obligations: 1 };
    const p = emptyDeadlinePlan(2025, c);
    for (const e of p.entries.filter(e => e.id.startsWith('commitment:'))) Object.assign(e, { applicability: 'applies', date_basis: 'saved_obligation' });
    const r = evaluateDeadlines(p, c, '2027-01-31');
    assert.equal(r.items.find(i => i.id === 'commitment:unknown')!.amount_pence, null);
    assert.equal(r.items.find(i => i.id === 'commitment:zero')!.amount_pence, 0);
    assert.equal(r.items.find(i => i.id === 'commitment:zero')!.phase, 'due_today');
    assert.equal(r.active_count, 2); assert.ok(r.warnings.some(w => w.startsWith('1 saved tax')));
    assert.equal(r.items.length, 9); // Unknown-year demand was not silently assigned.
    Object.assign(p.entries.find(e => e.id === 'commitment:zero')!, { date_basis: 'notice', notice_due_date: '2027-03-15', notice_document_id: document.id });
    assert.throws(() => evaluateDeadlines(p, c, '2027-01-31'));
});
test('expired rule review withholds current open reminders but retains acknowledged history', () => {
    const { c, p } = active();
    let r = evaluateDeadlines(p, c, '2027-04-06');
    assert.equal(r.active_count, 0); assert.equal(r.items.find(i => i.id === 'calendar:online')!.phase, 'rules_stale');
    assert.equal(evaluateDeadlines(p, c, '2027-04-05').items.find(i => i.id === 'calendar:online')!.phase, 'past_due');
    Object.assign(p.entries.find(e => e.id === 'calendar:online')!, { disposition: 'acknowledged' });
    r = evaluateDeadlines(p, c, '2027-04-06');
    assert.equal(r.items.find(i => i.id === 'calendar:online')!.phase, 'acknowledged'); assert.equal(r.status, 'review_required');
});
test('strict source and choice closure rejects forged fields, missing exclusions, duplicates and invalid money', () => {
    const { c, p } = active();
    assert.throws(() => evaluateDeadlines({ ...p, raw_path: 'PRIVATE' }, c, '2026-10-17'));
    assert.throws(() => evaluateDeadlines({ ...p, entries: p.entries.slice(1) }, c, '2026-10-17'));
    assert.throws(() => evaluateDeadlines({ ...p, entries: [...p.entries.slice(1), p.entries[1]] }, c, '2026-10-17'));
    assert.throws(() => evaluateDeadlines({ ...p, entries: [{ ...p.entries[0], amount_pence: 1 }, ...p.entries.slice(1)] }, c, '2026-10-17'));
    assert.throws(() => evaluateDeadlines(p, { ...c, owner_id: 'invalid' }, '2026-10-17'));
    assert.throws(() => validateDeadlineCatalog(owner, 2025, { ...c, documents: [{ ...document, storage_path: 'PRIVATE' }] }));
    assert.throws(() => validateDeadlineCatalog(owner, 2025, { ...c, finance_plan: { id: document.id, user_id: other, ordinal: 1, as_of: '2026-10-17', input_sha256: 'a'.repeat(64), result_sha256: 'b'.repeat(64) } }));
    const fc = { ...c, finance_plan: { id: document.id, user_id: owner, ordinal: 1, as_of: '2026-10-17', input_sha256: 'a'.repeat(64), result_sha256: 'b'.repeat(64) } };
    for (const amount_pence of [-1, 1.5, Infinity, 1e15, '100']) assert.throws(() => validateDeadlineCatalog(owner, 2025, { ...fc, obligations: [{ id: 'amount', label: 'Unpaid', tax_year_start: 2025, due_date: '2027-01-31', amount_pence }] }));
    assert.throws(() => validateDeadlineCatalog(owner, 2025, { ...fc, obligations: [{ id: 'foreign-year', label: 'Unpaid', tax_year_start: 2026, due_date: '2027-01-31', amount_pence: 100 }] }));
});
test('future-dated commitment evidence cannot activate a current reminder or erase its as-of date', () => {
    const c: DeadlineCatalog = { ...catalog(), finance_plan: { id: document.id, user_id: owner, ordinal: 1, as_of: '2027-02-01', input_sha256: 'b'.repeat(64), result_sha256: 'c'.repeat(64) }, obligations: [
        { id: 'future', label: 'Review source date', tax_year_start: 2025, due_date: '2027-01-31', amount_pence: 10000 },
    ] };
    const p = emptyDeadlinePlan(2025, c);
    Object.assign(p.entries.find(e => e.id === 'commitment:future')!, { applicability: 'applies', date_basis: 'saved_obligation' });
    const r = evaluateDeadlines(p, c, '2027-01-31'), item = r.items.find(i => i.id === 'commitment:future')!;
    assert.equal(item.phase, 'source_review_required'); assert.equal(item.commitment_as_of, '2027-02-01'); assert.equal(r.active_count, 0);
    assert.equal(evaluateDeadlines(p, c, '2027-02-01').items.find(i => i.id === 'commitment:future')!.phase, 'past_due');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { proposeMerchantRollover, type RolloverRule, type RolloverLink } from './merchant-rollover.ts';
function source(): RolloverRule {
    return { id: 'source-version', rule_id: 'source-family', ordinal: 2, match_key: 'synthetic squarespace', record_type: 'expense', status: 'active', account_id: null, tax_year_start: 2025,
        effective_from: '2025-04-06', expires_on: '2026-04-05', priority: 50, classification: 'Business', business_use_bps: 10000, category_id: 'software', evidence_status: 'provisional', seed_transaction_id: 'source-row', category_valid: true };
}
test('annual rollover proposes separate disabled scope and does not mutate or approve prior treatment', () => {
    const s = source(), before = structuredClone(s), p = proposeMerchantRollover(s, 2026, [s], []);
    assert.deepEqual(s, before); assert.equal(p.proposed.status, 'disabled'); assert.equal(p.proposed.ordinal, 0);
    assert.equal(p.proposed.tax_year_start, 2026); assert.equal(p.proposed.effective_from, '2026-04-06'); assert.equal(p.proposed.expires_on, '2027-04-05');
    assert.equal(p.proposed.account_id, null); assert.equal(p.proposed.evidence_status, 'provisional'); assert.equal(p.blocked.length, 0);
    assert.ok(p.warnings.some(w => w.includes('No transaction approval')));
    s.evidence_status = 'missing'; assert.equal(proposeMerchantRollover(s, 2026, [s], []).proposed.evidence_status, 'missing');
});
test('disabled/global/nonadjacent/stale-category rules are not silently renewed', () => {
    for (const change of [{ status: 'disabled' }, { tax_year_start: null }, { tax_year_start: 2024 }, { category_valid: false }]) {
        const s = { ...source(), ...change }; assert.ok(proposeMerchantRollover(s, 2026, [s], []).blocked.length > 0);
    }
    assert.throws(() => proposeMerchantRollover(source(), 2101, [], []), /supported/);
    const s = source(); s.effective_from = '2025-10-01'; s.expires_on = '2025-12-31';
    assert.ok(proposeMerchantRollover(s, 2026, [s], []).warnings.some(w => w.includes('full tax year')));
});
test('overlapping account/year/date scopes and completed ancestry remain explicit', () => {
    const s = source(), target: RolloverRule = { ...s, id: 'existing', rule_id: 'target', tax_year_start: 2026, effective_from: '2026-04-06', expires_on: '2027-04-05' };
    assert.equal(proposeMerchantRollover(s, 2026, [s, target], []).overlapping_rules.length, 1);
    target.account_id = 'another'; assert.equal(proposeMerchantRollover(s, 2026, [target], []).overlapping_rules.length, 1); // Global source intersects all accounts.
    s.account_id = 'one'; assert.equal(proposeMerchantRollover(s, 2026, [target], []).blocked.length, 0);
    target.account_id = null; target.tax_year_start = null;
    assert.equal(proposeMerchantRollover(s, 2026, [target], []).overlapping_rules.length, 1);
    target.status = 'disabled'; assert.equal(proposeMerchantRollover(s, 2026, [target], []).blocked.length, 0);
    const link: RolloverLink = { id: 'link', source_rule_id: s.rule_id, source_version_id: s.id, target_rule_id: 'target', target_version_id: 'target-v1', target_tax_year_start: 2026, rationale: 'Synthetic', author: 'owner', created_at: '2026-10-17', request_id: 'request' };
    assert.equal(proposeMerchantRollover(s, 2026, [s], [link]).existing?.id, 'link');
    assert.ok(proposeMerchantRollover(s, 2026, [s], [link]).blocked.length);
});

export type RolloverRule = {
    id: string; rule_id: string; ordinal: number; match_key: string; record_type: string; status: string;
    account_id: string | null; tax_year_start: number | null; effective_from: string; expires_on: string | null;
    priority: number; classification: string; business_use_bps: number; category_id: string | null;
    evidence_status: string; seed_transaction_id: string; category_valid: boolean;
};
export type RolloverLink = {
    id: string; source_rule_id: string; source_version_id: string; target_rule_id: string; target_version_id: string;
    target_tax_year_start: number; rationale: string; author: string; created_at: string; request_id: string;
};
/** A draft scope, never a transaction decision or an extension of the prior family. */
export function proposeMerchantRollover(source: RolloverRule, target: number, rules: RolloverRule[], links: RolloverLink[]) {
    if (!Number.isInteger(target) || target < 2001 || target > 2100) throw new Error('Choose a supported adjacent target tax year.');
    const blocked: string[] = [], warnings: string[] = [];
    if (source.tax_year_start !== target - 1 || source.status !== 'active') blocked.push('Only the latest active rule scoped to the immediately preceding tax year can roll over.');
    if (!source.category_valid) blocked.push('Source category meaning changed. Review the prior-year rule first.');
    const existing = links.find(l => l.source_rule_id === source.rule_id && l.target_tax_year_start === target);
    if (existing) blocked.push('This source already rolled over. Review its target-year rule instead.');
    const first = `${target}-04-06`, last = `${target + 1}-04-05`;
    const overlaps = rules.filter(r => r.status === 'active' && r.match_key === source.match_key && r.record_type === source.record_type &&
        (r.tax_year_start === null || r.tax_year_start === target) && (r.account_id === null || source.account_id === null || r.account_id === source.account_id) &&
        r.effective_from <= last && (r.expires_on === null || r.expires_on >= first));
    if (overlaps.length) warnings.push('An active target-year or all-year rule overlaps the default full-year window. Review that rule or narrow the new proposal to non-overlapping dates.');
    warnings.push('Prior-year treatment is a candidate only. Recheck eligibility, business use and the new date range. No transaction approval or linked evidence is carried forward.');
    if (source.effective_from !== `${target - 1}-04-06` || source.expires_on !== `${target}-04-05`) warnings.push('The prior rule did not cover exactly a full tax year. The proposed new full-year window needs explicit review.');
    const proposed: RolloverRule = { ...source, ordinal: 0, status: 'disabled', tax_year_start: target, effective_from: first, expires_on: last,
        evidence_status: source.evidence_status === 'missing' ? 'missing' : 'provisional' };
    return { source, target, proposed, blocked, warnings, existing: existing ?? null, overlapping_rules: overlaps };
}

export const scopeOptions = {
    class4_status: ['unknown', 'not_exempt', 'exempt'],
    class2_election: ['unknown', 'no_voluntary_charge', 'verified_amount'],
    pension_scope: ['unknown', 'none', 'eligible_registered_under75_no_unmodelled_charge', 'requires_review'],
    net_pay_scope: ['unknown', 'not_applicable', 'already_reflected_in_taxable_pay'],
    employment_scope: ['unknown', 'none', 'distinct_employments_cumulative_totals_checked'],
    termination_scope: ['unknown', 'none', 'separate_taxable_pay_and_withholding_checked'],
    payments_scope: ['unknown', 'none', 'distinct_identified_allocations_checked'],
    vehicle_scope: ['unknown', 'none', 'all_costs_method_history_and_capital_checked'],
    trade_treatment: ['unknown', 'reviewed_no_unmodelled_adjustments', 'requires_review'],
    ni_adjustments: ['unknown', 'none', 'requires_review'],
    gift_aid_scope: ['unknown', 'none', 'eligibility_and_tax_cover_checked'],
    assessment_adjustments: ['unknown', 'none', 'requires_review'],
    cash_dates: ['unknown', 'bank_posting_dates_reviewed', 'requires_review'],
} as const;
export type ScopeData = Record<keyof typeof scopeOptions, string> & {
    class2_amount_pence: number | null;
};
export type CalculationScope = {
    input_stamp: string;
    is_current: boolean;
    id: string;
    ordinal: number;
    state: 'provisional' | 'reviewed';
    data: ScopeData;
    evidence_document_id: string | null;
    document_snapshot: {
        id: string;
        file_sha256: string;
        media_type: string;
        size_bytes: number;
    } | null;
    rationale: string;
    author: string;
    created_at: string;
};
export function emptyScope(): ScopeData { return { ...Object.fromEntries(Object.keys(scopeOptions).map(k => [k, 'unknown'])), class2_amount_pence: null } as ScopeData; }
export function validateScope(value: unknown, state: string) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !['provisional', 'reviewed'].includes(state))
        throw new Error('Review calculation scope.');
    const d = value as ScopeData;
    if (Object.keys(d).length !== Object.keys(scopeOptions).length + 1 || Object.entries(scopeOptions).some(([k, opts]) => !(opts as readonly string[]).includes(d[k as keyof typeof scopeOptions])))
        throw new Error('Review every calculation-scope answer.');
    if (d.class2_amount_pence !== null && (!Number.isSafeInteger(d.class2_amount_pence) || d.class2_amount_pence < 0 || d.class2_amount_pence > 999999999999))
        throw new Error('Review the exact voluntary Class 2 amount.');
    if (state === 'reviewed' && (Object.values(d).includes('unknown') || (d.class2_election === 'verified_amount' && d.class2_amount_pence === null)))
        throw new Error('Unknown scope answers remain provisional.');
    if (d.class2_election === 'no_voluntary_charge' && d.class2_amount_pence !== 0)
        throw new Error('No voluntary charge requires an explicit zero.');
    return d;
}

/** Calendar proposals only. Applicability and personal HMRC notices require human review. */
export const deadlineRules = {
    id: 'uk-sa-deadlines-2025-27/1',
    engine_version: 'vibecount-tax-deadlines/1',
    source_reviewed_at: '2026-10-17',
    review_by: '2027-04-05',
    review_status: 'engineering_checked_independent_tax_review_pending',
    supported_years: [2025, 2026],
    // Offsets are from the start year of the liability year, not the assessment-source year.
    calendar: [
        { id: 'register', title: 'Check whether you must register for Self Assessment', year_offset: 1, month_day: '10-05', source: 'filing' },
        { id: 'paper', title: 'Paper Self Assessment return, if applicable', year_offset: 1, month_day: '10-31', source: 'filing' },
        { id: 'online', title: 'Online Self Assessment return, if applicable', year_offset: 2, month_day: '01-31', source: 'filing' },
        { id: 'tax_code', title: 'Online filing for tax-code collection, if eligible', year_offset: 1, month_day: '12-30', source: 'filing' },
        { id: 'balancing', title: 'Balancing payment for this tax year, if owed', year_offset: 2, month_day: '01-31', source: 'payment' },
        { id: 'first_poa', title: 'First payment on account TOWARDS this tax year, if required', year_offset: 1, month_day: '01-31', source: 'poa' },
        { id: 'second_poa', title: 'Second payment on account TOWARDS this tax year, if required', year_offset: 1, month_day: '07-31', source: 'poa' },
    ],
    sources: [
        { id: 'filing', url: 'https://www.gov.uk/self-assessment-tax-returns/deadlines', section: 'Ordinary filing, registration and tax-code collection dates; personal notice exceptions' },
        { id: 'poa', url: 'https://www.gov.uk/understand-self-assessment-bill/payments-on-account', section: 'Payments on account and balancing payments belong to distinct liability years' },
        { id: 'payment', url: 'https://www.gov.uk/pay-self-assessment-tax-bill', section: 'Payment receipt dates and method-dependent lead time' },
    ],
} as const;

export const DEADLINE_CAVEAT = 'Draft reminder aid — not submitted to HMRC. General dates do not establish your filing requirement, personal deadline or amount owed. Check HMRC notices and payment arrival time. Acknowledging a reminder does not mean a return was filed or tax was paid. Independent tax review is pending.';

import type { TaxRules } from '../tax/rules';

/** Planning only. Does not enable 2026/27 filing or change the historical calculator default. */
export const planningRules2026 = {
    id: 'uk-cash-planning-2026-27/1', version: '1', engine_version: 'vibecount-planning/1',
    tax_year_start: 2026, source_reviewed_at: '2026-10-17',
    review_status: 'engineering_checked_independent_tax_review_pending',
    allowance_pence: 1257000, allowance_taper_start_pence: 10000000,
    ewni_bands: [{ width_pence: 3770000, rate_bps: 2000 }, { width_pence: 8744000, rate_bps: 4000 }, { width_pence: null, rate_bps: 4500 }],
    scotland_bands: [{ width_pence: 396700, rate_bps: 1900 }, { width_pence: 1298900, rate_bps: 2000 }, { width_pence: 1413600, rate_bps: 2100 }, { width_pence: 3133800, rate_bps: 4200 }, { width_pence: 6271000, rate_bps: 4500 }, { width_pence: null, rate_bps: 4800 }],
    ni: { lower_pence: 1257000, upper_pence: 5027000, main_bps: 600, additional_bps: 200, class1_bps: 800, max_main_pence: 226200, class2_small_profit_pence: 710500, class2_weekly_pence: 365 },
    minimum_pension_earnings_pence: 360000, poa_minimum_pence: 100000, poa_relevant_ratio_bps: 2000,
    sources: [
        { id: 'income-tax', url: 'https://www.gov.uk/income-tax-rates', section: '2026/27 allowance, taper and EWNI rates' },
        { id: 'scottish-tax', url: 'https://www.gov.uk/scottish-income-tax', section: '2026/27 non-savings bands' },
        { id: 'self-employed-ni', url: 'https://www.gov.uk/self-employed-national-insurance-rates', section: '2026/27 Class 4 and Class 2 treatment' },
        { id: 'ni-parameters', url: 'https://www.gov.uk/government/publications/rates-and-allowances-national-insurance-contributions/rates-and-allowances-national-insurance-contributions', section: '2026/27 NI parameters; Class 1 interactions remain outside this forecast scope' },
        { id: 'pension-ras', url: 'https://www.gov.uk/hmrc-internal-manuals/pensions-tax-manual/ptm044220', section: 'Net/gross RAS contributions and relevant earnings' },
        { id: 'pension-bands', url: 'https://www.gov.uk/hmrc-internal-manuals/pensions-tax-manual/ptm056120', section: 'Gross RAS band extension' },
        { id: 'poa', url: 'https://www.gov.uk/understand-self-assessment-bill/payments-on-account', section: 'Prior-year basis and January/July dates' },
    ],
} as const satisfies Pick<TaxRules, 'id' | 'version' | 'engine_version' | 'tax_year_start' | 'source_reviewed_at' | 'review_status' | 'allowance_pence' | 'allowance_taper_start_pence' | 'ewni_bands' | 'scotland_bands' | 'ni' | 'minimum_pension_earnings_pence' | 'poa_minimum_pence' | 'poa_relevant_ratio_bps' | 'sources'>;

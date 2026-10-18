/** Engineering-checked parameters. Independent tax review is still required; never a filing certification. */
export const rules2025 = {
    id: 'uk-sole-trader-2025-26-v1', version: '1', engine_version: 'vibecount-tax/1', tax_year_start: 2025, source_reviewed_at: '2026-10-17', review_status: 'engineering_checked_independent_tax_review_pending',
    arithmetic: 'exact integer pence; employment and trade NI bases floor whole pounds; RAS/GiftAid and Class1 bases ceil whole pounds; tax components floor pennies. Draft estimate, not certified HMRC box mapping.',
    allowance_pence: 1257000, allowance_taper_start_pence: 10000000,
    ewni_bands: [{ width_pence: 3770000, rate_bps: 2000 }, { width_pence: 8744000, rate_bps: 4000 }, { width_pence: null, rate_bps: 4500 }],
    scotland_bands: [{ width_pence: 282700, rate_bps: 1900 }, { width_pence: 1209400, rate_bps: 2000 }, { width_pence: 1617100, rate_bps: 2100 }, { width_pence: 3133800, rate_bps: 4200 }, { width_pence: 6271000, rate_bps: 4500 }, { width_pence: null, rate_bps: 4800 }],
    ni: { lower_pence: 1257000, upper_pence: 5027000, main_bps: 600, additional_bps: 200, class1_bps: 800, max_main_pence: 226200, class2_small_profit_pence: 684500, class2_weekly_pence: 350 },
    minimum_pension_earnings_pence: 360000, poa_minimum_pence: 100000, poa_relevant_ratio_bps: 2000,
    mileage: { car_van_first_miles_hundredths: 1000000, car_van_first_pence_per_mile: 45, car_van_later_pence_per_mile: 25, motorcycle_pence_per_mile: 24 },
    sources: [
        { id: 'hmrc-calculation', url: 'https://assets.publishing.service.gov.uk/media/69c26e8dcfa346b9d4704b3f/Calculate_Tax_and_NIC_MTR_version_1.5.1a.odt', section: '2025/26 stages 1,4,6,8,11,12,14,16' },
        { id: 'hmrc-poa', url: 'https://assets.publishing.service.gov.uk/media/699315137149b335a315b487/Payments_on_Account__Stage_13__Tax_and_NIC_calculation_version_1.0.0a.odt', section: 'Stage 13' },
        { id: 'hmrc-scotland', url: 'https://www.gov.uk/scottish-income-tax/2025-to-2026-tax-year', section: '2025/26 non-savings rates' },
        { id: 'hmrc-pension', url: 'https://www.gov.uk/hmrc-internal-manuals/pensions-tax-manual/ptm056120', section: 'Band extension' },
        { id: 'hmrc-mileage', url: 'https://www.gov.uk/simpler-income-tax-simplified-expenses/vehicles', section: 'Sole-trader vehicle simplified expenses' },
        { id: 'hmrc-cash', url: 'https://www.gov.uk/simpler-income-tax-cash-basis/income-and-expenses-under-cash-basis', section: 'Receipt/payment timing' },
    ]
} as const;
/** Structural annual parameters; a new year must supply its own sourced values. */
export type TaxRules = {
    readonly id: string;
    readonly version: string;
    readonly engine_version: string;
    readonly tax_year_start: number;
    readonly source_reviewed_at: string;
    readonly review_status: string;
    readonly arithmetic: string;
    readonly allowance_pence: number;
    readonly allowance_taper_start_pence: number;
    readonly ewni_bands: readonly { readonly width_pence: number | null; readonly rate_bps: number }[];
    readonly scotland_bands: readonly { readonly width_pence: number | null; readonly rate_bps: number }[];
    readonly ni: { readonly lower_pence: number; readonly upper_pence: number; readonly main_bps: number; readonly additional_bps: number; readonly class1_bps: number; readonly max_main_pence: number; readonly class2_small_profit_pence: number; readonly class2_weekly_pence: number };
    readonly minimum_pension_earnings_pence: number;
    readonly poa_minimum_pence: number;
    readonly poa_relevant_ratio_bps: number;
    readonly mileage: { readonly car_van_first_miles_hundredths: number; readonly car_van_first_pence_per_mile: number; readonly car_van_later_pence_per_mile: number; readonly motorcycle_pence_per_mile: number };
    readonly sources: readonly { readonly id: string; readonly url: string; readonly section: string }[];
};

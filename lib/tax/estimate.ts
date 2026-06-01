// UK 2026/27 income tax and NI rates.
// Update annually: https://www.gov.uk/income-tax-rates and https://www.gov.uk/self-employed-national-insurance-rates
const PERSONAL_ALLOWANCE_PENCE = 12_570 * 100;
const BASIC_RATE_LIMIT_PENCE   = 50_270 * 100;
const BASIC_RATE    = 0.20;
const HIGHER_RATE   = 0.40;
// Class 4 NI: main rate cut from 9% to 6% from April 2024 (confirmed GOV.UK 2026/27)
const NI_LOWER_PROFITS_PENCE = 12_570 * 100; // Lower Profits Limit
const NI_UPPER_PROFITS_PENCE = 50_270 * 100; // Upper Profits Limit
const NI_MAIN_RATE      = 0.06; // 6% on profits between LPL and UPL
const NI_ADDITIONAL_RATE = 0.02; // 2% on profits above UPL
// Class 2 NI: no longer a mandatory charge (abolished April 2024)

export const TAX_ESTIMATE_DISCLAIMER =
  "Estimated using 2026/27 rates. Not a filing figure. " +
  "Verify with your accountant and GOV.UK before submitting your Self Assessment.";

export interface TaxEstimate {
  income_tax_pence: number;
  ni_class4_pence: number;
  total_estimated_tax_pence: number;
  disclaimer: string;
}

/**
 * Rough income tax + Class 4 NI estimate for a UK sole trader.
 * All amounts in pence. Returns zeroes for negative/zero profit.
 */
export function estimateIncomeTax(netProfitPence: number): TaxEstimate {
  if (netProfitPence <= 0) {
    return {
      income_tax_pence: 0,
      ni_class4_pence: 0,
      total_estimated_tax_pence: 0,
      disclaimer: TAX_ESTIMATE_DISCLAIMER,
    };
  }

  // Income tax
  let income_tax_pence = 0;
  if (netProfitPence > PERSONAL_ALLOWANCE_PENCE) {
    const taxable = netProfitPence - PERSONAL_ALLOWANCE_PENCE;
    const basicBand = Math.max(0, Math.min(taxable, BASIC_RATE_LIMIT_PENCE - PERSONAL_ALLOWANCE_PENCE));
    const higherBand = Math.max(0, taxable - (BASIC_RATE_LIMIT_PENCE - PERSONAL_ALLOWANCE_PENCE));
    income_tax_pence = Math.round(basicBand * BASIC_RATE + higherBand * HIGHER_RATE);
  }

  // Class 4 NI
  let ni_class4_pence = 0;
  if (netProfitPence > NI_LOWER_PROFITS_PENCE) {
    const mainBand = Math.min(
      netProfitPence - NI_LOWER_PROFITS_PENCE,
      NI_UPPER_PROFITS_PENCE - NI_LOWER_PROFITS_PENCE
    );
    const additionalBand = Math.max(0, netProfitPence - NI_UPPER_PROFITS_PENCE);
    ni_class4_pence = Math.round(mainBand * NI_MAIN_RATE + additionalBand * NI_ADDITIONAL_RATE);
  }

  return {
    income_tax_pence,
    ni_class4_pence,
    total_estimated_tax_pence: income_tax_pence + ni_class4_pence,
    disclaimer: TAX_ESTIMATE_DISCLAIMER,
  };
}

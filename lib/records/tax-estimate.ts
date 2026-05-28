export type TaxEstimate = {
  profitPence: number;
  taxableProfitPence: number;
  incomeTaxPence: number;
  class4NiPence: number;
  totalEstimatePence: number;
  paymentOnAccountPence: number;
  notes: string[];
};

const PERSONAL_ALLOWANCE_PENCE = 1_257_000;
const BASIC_RATE_LIMIT_AFTER_ALLOWANCE_PENCE = 3_770_000;
const HIGHER_RATE_LIMIT_AFTER_ALLOWANCE_PENCE = 12_514_000;
const CLASS_4_LOWER_PROFITS_LIMIT_PENCE = 1_257_000;
const CLASS_4_UPPER_PROFITS_LIMIT_PENCE = 5_027_000;

export function estimateSelfAssessmentTax(profitPence: number): TaxEstimate {
  const taxableProfitPence = Math.max(0, profitPence - PERSONAL_ALLOWANCE_PENCE);
  const incomeTaxPence =
    taxBand(taxableProfitPence, 0, BASIC_RATE_LIMIT_AFTER_ALLOWANCE_PENCE, 0.2) +
    taxBand(
      taxableProfitPence,
      BASIC_RATE_LIMIT_AFTER_ALLOWANCE_PENCE,
      HIGHER_RATE_LIMIT_AFTER_ALLOWANCE_PENCE,
      0.4
    ) +
    taxBand(taxableProfitPence, HIGHER_RATE_LIMIT_AFTER_ALLOWANCE_PENCE, Infinity, 0.45);

  const class4NiPence =
    taxBand(
      profitPence,
      CLASS_4_LOWER_PROFITS_LIMIT_PENCE,
      CLASS_4_UPPER_PROFITS_LIMIT_PENCE,
      0.06
    ) + taxBand(profitPence, CLASS_4_UPPER_PROFITS_LIMIT_PENCE, Infinity, 0.02);

  const totalEstimatePence = Math.round(incomeTaxPence + class4NiPence);

  return {
    profitPence,
    taxableProfitPence,
    incomeTaxPence: Math.round(incomeTaxPence),
    class4NiPence: Math.round(class4NiPence),
    totalEstimatePence,
    paymentOnAccountPence: Math.round(totalEstimatePence / 2),
    notes: [
      "Estimate uses England/Wales/Northern Ireland income tax bands and standard Personal Allowance.",
      "It does not include student loans, pension relief, payments on account already made, capital allowances, losses, other income, or Scottish tax bands.",
      "Class 4 National Insurance is estimated from self-employment profit only.",
    ],
  };
}

function taxBand(value: number, lower: number, upper: number, rate: number) {
  const taxableInBand = Math.max(0, Math.min(value, upper) - lower);
  return taxableInBand * rate;
}

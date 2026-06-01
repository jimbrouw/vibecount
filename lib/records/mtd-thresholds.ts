// MTD for Income Tax thresholds — verified against GOV.UK May 2026.
// Source: https://www.gov.uk/guidance/check-if-youre-eligible-for-making-tax-digital-for-income-tax
// Update this file when HMRC announces threshold changes.

interface ThresholdEntry {
  fromDate: Date;        // first day the threshold applies (inclusive)
  threshold_pence: number;
  label: string;
}

const THRESHOLDS: ThresholdEntry[] = [
  {
    fromDate: new Date("2026-04-06"),
    threshold_pence: 50_000 * 100,
    label: "£50,000",
  },
  {
    fromDate: new Date("2027-04-06"),
    threshold_pence: 30_000 * 100,
    label: "£30,000",
  },
  {
    fromDate: new Date("2028-04-06"),
    threshold_pence: 20_000 * 100,
    label: "£20,000",
  },
];

const MTD_DISCLAIMER =
  "Based on your records in VibeCount. " +
  "Check GOV.UK for current thresholds and ask your accountant about your MTD obligations. " +
  "VibeCount does not claim MTD recognition or HMRC compatibility.";

/** Returns the MTD threshold in pence applicable on the given date, or null if MTD does not yet apply. */
export function getMtdThreshold(date: Date): number | null {
  const applicable = [...THRESHOLDS]
    .reverse()
    .find((t) => date >= t.fromDate);
  return applicable?.threshold_pence ?? null;
}

/** Returns the human-readable label for the applicable threshold, with mandatory disclaimer. */
export function getMtdThresholdLabel(date: Date): string {
  const applicable = [...THRESHOLDS]
    .reverse()
    .find((t) => date >= t.fromDate);
  if (!applicable) {
    return `MTD for Income Tax does not yet apply. ${MTD_DISCLAIMER}`;
  }
  return `Current MTD threshold: ${applicable.label}. ${MTD_DISCLAIMER}`;
}

export { MTD_DISCLAIMER };

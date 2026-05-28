export type TaxQuarter = 1 | 2 | 3 | 4;

export type QuarterSummary = {
  taxYearStart: number;
  taxQuarter: TaxQuarter;
  label: string;
  period: string;
  incomePence: number;
  expensePence: number;
  netPence: number;
  incomeCount: number;
  expenseCount: number;
};

export const MTD_THRESHOLDS_PENCE = [5_000_000, 3_000_000, 2_000_000] as const;

const MONTH_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

export function getCurrentTaxYearStart(today = new Date()) {
  const year = today.getUTCFullYear();
  const taxYearStart = Date.UTC(year, 3, 6);

  return today.getTime() >= taxYearStart ? year : year - 1;
}

export function getTaxYearLabel(taxYearStart: number) {
  return `${taxYearStart}/${String(taxYearStart + 1).slice(2)}`;
}

export function getQuarterDates(taxYearStart: number, quarter: TaxQuarter) {
  const starts = [
    Date.UTC(taxYearStart, 3, 6),
    Date.UTC(taxYearStart, 6, 6),
    Date.UTC(taxYearStart, 9, 6),
    Date.UTC(taxYearStart + 1, 0, 6),
  ];

  const start = new Date(starts[quarter - 1]);
  const nextStart =
    quarter === 4
      ? new Date(Date.UTC(taxYearStart + 1, 3, 6))
      : new Date(starts[quarter]);
  const end = new Date(nextStart.getTime() - 24 * 60 * 60 * 1000);

  return { start, end };
}

export function getQuarterLabel(taxYearStart: number, quarter: TaxQuarter) {
  const { start, end } = getQuarterDates(taxYearStart, quarter);
  return `${MONTH_FORMATTER.format(start)} to ${MONTH_FORMATTER.format(end)}`;
}

export function moneyToPence(value: number | string | null | undefined) {
  return Math.round(Number(value ?? 0) * 100);
}

export function buildQuarterSummaries(
  taxYearStart: number,
  rows: {
    tax_quarter: number;
    income_total: number | string | null;
    expense_total: number | string | null;
    net_total: number | string | null;
    income_count: number | null;
    expense_count: number | null;
  }[]
): QuarterSummary[] {
  return ([1, 2, 3, 4] as const).map((taxQuarter) => {
    const row = rows.find((summary) => summary.tax_quarter === taxQuarter);

    return {
      taxYearStart,
      taxQuarter,
      label: `Quarter ${taxQuarter}`,
      period: getQuarterLabel(taxYearStart, taxQuarter),
      incomePence: moneyToPence(row?.income_total),
      expensePence: moneyToPence(row?.expense_total),
      netPence: moneyToPence(row?.net_total),
      incomeCount: row?.income_count ?? 0,
      expenseCount: row?.expense_count ?? 0,
    };
  });
}

export function getThresholdStatus(totalIncomePence: number) {
  const nextThreshold = MTD_THRESHOLDS_PENCE.find(
    (threshold) => totalIncomePence < threshold
  );

  return {
    totalIncomePence,
    nextThresholdPence: nextThreshold ?? MTD_THRESHOLDS_PENCE[0],
    highestReachedPence:
      [...MTD_THRESHOLDS_PENCE].reverse().find(
        (threshold) => totalIncomePence >= threshold
      ) ?? null,
  };
}

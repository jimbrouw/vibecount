// UK tax year: 6 April to 5 April the following year.
// HMRC quarters within a tax year:
//   Q1: 6 Apr – 5 Jul
//   Q2: 6 Jul – 5 Oct
//   Q3: 6 Oct – 5 Jan
//   Q4: 6 Jan – 5 Apr

export type TaxQuarter = 1 | 2 | 3 | 4;

export interface QuarterBoundary {
  quarter: TaxQuarter;
  start: Date; // inclusive
  end: Date;   // inclusive
  label: string;
}

/** Returns the calendar year in which the tax year starts (e.g. 2025 for 2025/26). */
export function ukTaxYearStart(date: Date): number {
  const m = date.getUTCMonth() + 1; // 1-indexed
  const d = date.getUTCDate();
  const y = date.getUTCFullYear();
  if (m > 4 || (m === 4 && d >= 6)) {
    return y;
  }
  return y - 1;
}

/** Formats a tax year start into "2025/26". */
export function formatTaxYear(yearStart: number): string {
  return `${yearStart}/${String(yearStart + 1).slice(2)}`;
}

/** Returns the 4 quarter boundaries for the given tax year start. */
export function quarterBoundaries(yearStart: number): QuarterBoundary[] {
  const y = yearStart;
  return [
    {
      quarter: 1,
      start: new Date(Date.UTC(y, 3, 6)),   // 6 Apr
      end:   new Date(Date.UTC(y, 6, 5)),   // 5 Jul
      label: `Q1 ${formatTaxYear(y)} (6 Apr – 5 Jul)`,
    },
    {
      quarter: 2,
      start: new Date(Date.UTC(y, 6, 6)),   // 6 Jul
      end:   new Date(Date.UTC(y, 9, 5)),   // 5 Oct
      label: `Q2 ${formatTaxYear(y)} (6 Jul – 5 Oct)`,
    },
    {
      quarter: 3,
      start: new Date(Date.UTC(y, 9, 6)),   // 6 Oct
      end:   new Date(Date.UTC(y + 1, 0, 5)), // 5 Jan
      label: `Q3 ${formatTaxYear(y)} (6 Oct – 5 Jan)`,
    },
    {
      quarter: 4,
      start: new Date(Date.UTC(y + 1, 0, 6)), // 6 Jan
      end:   new Date(Date.UTC(y + 1, 3, 5)), // 5 Apr
      label: `Q4 ${formatTaxYear(y)} (6 Jan – 5 Apr)`,
    },
  ];
}

/** Returns the HMRC quarter (1–4) for a given date within the specified tax year. */
export function classifyToQuarter(date: Date, yearStart: number): TaxQuarter {
  const boundaries = quarterBoundaries(yearStart);
  const ts = date.getTime();
  for (const b of boundaries) {
    if (ts >= b.start.getTime() && ts <= b.end.getTime()) {
      return b.quarter;
    }
  }
  // Fallback: recompute from the date's own tax year if it doesn't fall in yearStart's range
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  if (m > 4 || (m === 4 && d >= 6)) {
    if (m < 7 || (m === 7 && d < 6)) return 1;
    if (m < 10 || (m === 10 && d < 6)) return 2;
    return 3;
  }
  if (m < 1 || (m === 1 && d < 6)) return 3;
  return 4;
}

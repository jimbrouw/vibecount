import { readAllExportRows } from "./export-pages.ts";
import type { SelfAssessmentRecord } from "./self-assessment.ts";

type Page<T> = { data: T[] | null; error: unknown };
export type TaxPrepRecord = SelfAssessmentRecord & { id: string };
export type TaxPrepYear = { id: string; tax_year_start: number };

/** A failed page is unavailable data, never a zero-income checklist. */
export async function readTaxPrepData(
  records: (afterId: string | null) => PromiseLike<Page<TaxPrepRecord>>,
  years: (afterId: string | null) => PromiseLike<Page<TaxPrepYear>>,
): Promise<
  | { status: "ready"; records: TaxPrepRecord[]; years: TaxPrepYear[] }
  | { status: "unavailable" }
> {
  try {
    const [allRecords, allYears] = await Promise.all([
      readAllExportRows(records),
      readAllExportRows(years),
    ]);
    return { status: "ready", records: allRecords, years: allYears };
  } catch {
    return { status: "unavailable" };
  }
}

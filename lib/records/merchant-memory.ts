import { apportionPence, sumPence, decimalToPence } from "../money";
import { minorPence } from "./allocations";
import type { DuplicateChoice } from "./duplicates";
export type MerchantSuggestion = {
  id: string;
  rule_id: string;
  ordinal: number;
  classification: string;
  business_use_bps: number;
  category_id: string | null;
  category_snapshot: { name: string } | null;
  category_valid: boolean;
  priority: number;
  precedence_rank: number;
  evidence_status: string;
};
export type MerchantChoice = DuplicateChoice & {
  tax_year_start: number;
  merchant_key: string;
  rule_candidates: MerchantSuggestion[];
  top_rule_count: number;
  suggested_rule_version_id: string | null;
};
export type MerchantEntry = {
  transaction_id: string;
  version: number;
  origin: "rule" | "manual" | "override";
  rule_version_id: string | null;
  classification?: string;
  business_use_bps?: number;
  category_id?: string | null;
  evidence_status: "provisional" | "missing" | "linked";
  document_ids: string[];
};
export type MerchantCategory = {
  id: string;
  name: string;
  record_type: string;
};
export function percentToBasisPoints(value: string) {
  const n = decimalToPence(value);
  if (n === null || n < 0 || n > 10000)
    throw new Error(
      "Enter an exact percentage from 0 to 100 with up to two decimal places.",
    );
  return n;
}
export function merchantEntryEffect(
  tx: MerchantChoice,
  entry: MerchantEntry,
  categories: MerchantCategory[],
) {
  if(tx.currency!=='GBP'||tx.signed_amount_pence===null||
    (tx.original_signed_minor!==undefined&&tx.original_signed_minor!==null)||
    (tx.source_units_ruleset!==undefined&&tx.source_units_ruleset!==null))
    throw new Error('Native merchant review requires actual GBP source cash.');
  if (
    tx.id !== entry.transaction_id ||
    tx.decision_version !== entry.version ||
    tx.import_status === "discarded" ||
    tx.dedupe_status !== "clear" ||
    tx.has_financial_dependencies
  )
    throw new Error(
      "Resolve source identity or financial relationships and reload the exact reviewed version.",
    );
  if (tx.classification !== "Unknown" && entry.origin !== "override")
    throw new Error("Known treatment needs an explicit override.");
  const rule = tx.rule_candidates.find((r) => r.id === entry.rule_version_id);
  if (entry.rule_version_id && !rule)
    throw new Error("The reviewed rule is no longer applicable.");
  if (
    entry.origin === "rule" &&
    (!rule ||
      !rule.category_valid ||
      tx.top_rule_count !== 1 ||
      tx.suggested_rule_version_id !== rule.id ||
      tx.classification !== "Unknown")
  )
    throw new Error("Resolve competing or changed rules before using memory.");
  const target = entry.origin === "rule" ? rule! : entry;
  const cls = target.classification,
    bps = target.business_use_bps,
    category = target.category_id;
  if (!["Business", "Personal", "Mixed"].includes(cls ?? ""))
    throw new Error(
      "Leave Unknown unresolved; use transfer/refund review for relationships.",
    );
  const kind = minorPence(tx.signed_amount_pence) > 0 ? "income" : "expense";
  if (
    cls === "Personal"
      ? bps !== 0 || !!category
      : !Number.isInteger(bps) ||
        (cls === "Business"
          ? bps !== 10000
          : kind !== "expense" || bps! < 1 || bps! > 9999) ||
        !categories.some((c) => c.id === category && c.record_type === kind)
  )
    throw new Error("Review category and business-use percentage.");
  if (
    entry.document_ids.length > 10 ||
    new Set(entry.document_ids).size !== entry.document_ids.length ||
    (entry.evidence_status === "linked" && entry.document_ids.length === 0)
  )
    throw new Error("Review evidence documents and status.");
  const after =
    cls === "Personal"
      ? 0
      : apportionPence(Math.abs(minorPence(tx.signed_amount_pence)), bps!);
  if (cls !== "Personal" && after === 0)
    throw new Error("Business amount rounds to zero.");
  return {
    classification: cls!,
    bps: bps!,
    category: category ?? null,
    kind,
    beforeKind: tx.record_type,
    after,
    before: minorPence(tx.recognized_pence),
  };
}
export function merchantBatchEffects(
  rows: MerchantChoice[],
  entries: MerchantEntry[],
  categories: MerchantCategory[],
) {
  if (
    entries.length < 1 ||
    entries.length > 50 ||
    new Set(entries.map((e) => e.transaction_id)).size !== entries.length
  )
    throw new Error("Select 1 to 50 distinct reviewed rows.");
  const effects = entries.map((e) => {
    const tx = rows.find((r) => r.id === e.transaction_id);
    if (!tx) throw new Error("Reviewed source missing.");
    return merchantEntryEffect(tx, e, categories);
  });
  return {
    count: effects.length,
    incomeBefore: sumPence(
      effects.filter((e) => e.beforeKind === "income").map((e) => e.before),
    ),
    expenseBefore: sumPence(
      effects.filter((e) => e.beforeKind === "expense").map((e) => e.before),
    ),
    incomeAfter: sumPence(
      effects.filter((e) => e.kind === "income").map((e) => e.after),
    ),
    expenseAfter: sumPence(
      effects.filter((e) => e.kind === "expense").map((e) => e.after),
    ),
  };
}
/** Undo removes the current effects and leaves Unknown; it never restores an earlier approval. */
export function merchantUndoEffects(
  rows: MerchantChoice[],
  versions: { transaction_id: string; after_version: number }[],
) {
  if (
    !versions.length ||
    versions.length > 50 ||
    new Set(versions.map((v) => v.transaction_id)).size !== versions.length ||
    rows.length !== versions.length ||
    new Set(rows.map((r) => r.id)).size !== rows.length ||
    rows.some(
      (r) =>
        r.has_financial_dependencies ||
        r.import_status === "discarded" ||
        r.dedupe_status !== "clear" ||
        r.decision_version !==
          versions.find((v) => v.transaction_id === r.id)?.after_version,
    )
  )
    throw new Error(
      "A decision changed or supports another relationship. Review corrections individually.",
    );
  return {
    count: rows.length,
    incomeBefore: sumPence(
      rows
        .filter((r) => r.record_type === "income")
        .map((r) => minorPence(r.recognized_pence)),
    ),
    expenseBefore: sumPence(
      rows
        .filter((r) => r.record_type === "expense")
        .map((r) => minorPence(r.recognized_pence)),
    ),
  };
}
function roundedRatio(n: bigint, d: bigint) {
  const result = (n + d / BigInt(2)) / d;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(result);
}
/** Gross materiality is independent of triage score. Annualisation is an explicitly labelled scenario. */
export function buildMerchantQueue(rows: MerchantChoice[], year: number) {
  const groups = new Map<string, MerchantChoice[]>();
  for (const row of rows) {
    if (
      row.tax_year_start !== year ||
      row.import_status === "discarded" ||
      row.dedupe_status !== "clear" ||
      row.has_financial_dependencies
    )
      continue;
    const key =
      row.merchant_key +
      "|" +
      (minorPence(row.signed_amount_pence) > 0 ? "income" : "expense");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const daysInYear =
    (Date.UTC(year + 1, 3, 6) - Date.UTC(year, 3, 6)) / 86400000;
  return rows
    .filter(
      (r) =>
        r.tax_year_start === year &&
        r.import_status !== "discarded" &&
        (r.classification === "Unknown" ||
          r.dedupe_status === "needs_review" ||
          (["Transfer", "Refund"].includes(r.classification) &&
            !r.has_financial_dependencies)),
    )
    .map((row) => {
      const group =
        groups.get(
          row.merchant_key +
            "|" +
            (minorPence(row.signed_amount_pence) > 0 ? "income" : "expense"),
        ) ?? [];
      const observed = sumPence(
        group.map((r) => Math.abs(minorPence(r.signed_amount_pence))),
      );
      const daily = new Map<string, number[]>();
      for (const r of group)
        daily.set(r.transaction_date, [
          ...(daily.get(r.transaction_date) ?? []),
          Math.abs(minorPence(r.signed_amount_pence)),
        ]);
      const dates = [...daily.keys()].sort(),
        intervals = dates
          .slice(1)
          .map(
            (date, i) =>
              (Date.parse(date + "T00:00:00Z") -
                Date.parse(dates[i] + "T00:00:00Z")) /
              86400000,
          )
          .sort((a, b) => a - b);
      const doubleMedian = (values: number[]) => {
        const a = [...values].sort((x, y) => x - y),
          mid = Math.floor(a.length / 2);
        return a.length % 2
          ? BigInt(a[mid]) * BigInt(2)
          : BigInt(a[mid - 1]) + BigInt(a[mid]);
      };
      let annualized: number | null = null;
      if (intervals.length && doubleMedian(intervals) >= BigInt(14))
        annualized = roundedRatio(
          doubleMedian([...daily.values()].map((values) => sumPence(values))) *
            BigInt(daysInYear),
          doubleMedian(intervals),
        );
      const score =
        row.top_rule_count === 1 ? 95 : row.top_rule_count > 1 ? 40 : 0;
      return {
        row,
        observed,
        annualized,
        occurrences: group.length,
        dates: dates.length,
        score,
        priority: Math.max(
          Math.abs(minorPence(row.signed_amount_pence)),
          observed,
          annualized ?? 0,
        ),
      };
    })
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        b.score - a.score ||
        a.row.id.localeCompare(b.row.id),
    );
}

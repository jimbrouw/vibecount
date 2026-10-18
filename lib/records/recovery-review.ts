import { minorPence } from "./allocations";
import { currencyCode, FX_CURRENCIES, FX_CURRENCY_RULESET } from '../fx/currency';
export type RecoveryChoice = {
  id: string;
  kind: "source" | "document";
  state: string;
  file_hash: string;
  created_at: string;
  stamp: string;
  byte_count: number | null;
  object_count: number;
  parser: string | null;
  row_count: string | null;
  incoming_pence: string | null;
  outgoing_pence: string | null;
  coverage_start: string | null;
  coverage_end: string | null;
  account_label: string | null;
  account_mask: string | null;
  tax_year_start: string | null;
  purpose: string | null;
  destination_id: string | null;
  has_recovery_plan: boolean;
  plan_version?: string | null;
  account_currency?: string | null;
  original_currency?: string | null;
  currency_exponent?: string | null;
  ruleset_id?: string | null;
  incoming_original_minor?: string | null;
  outgoing_original_minor?: string | null;
};
export function recoveryReview(choice: RecoveryChoice) {
  if (choice.state !== "failed")
    throw new Error(
      "Only failed uploads can be recovered. Pending or uploaded operations may still be running.",
    );
  if (!choice.has_recovery_plan)
    throw new Error(
      "This earlier upload has no preserved review scope. Re-upload the exact original and review its mapping or document scope.",
    );
  if (!/^[a-f0-9]{64}$/.test(choice.file_hash))
    throw new Error("Source identity is unavailable.");
  if (choice.kind === "source") {
    if (choice.parser === 'mapped-csv/2') {
      const currency = currencyCode(choice.original_currency), count = Number(choice.row_count);
      const original = (value: string | null | undefined) => {
        if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,11})$/.test(value))
          throw new Error('Exact original-currency totals are unavailable.');
        return Number(value);
      };
      if (choice.plan_version !== '2' || currency === 'GBP' || choice.account_currency !== currency ||
          choice.currency_exponent !== String(FX_CURRENCIES[currency].exponent) || choice.ruleset_id !== FX_CURRENCY_RULESET ||
          !Number.isInteger(count) || count < 1 || count > 5000 || !choice.coverage_start || !choice.coverage_end ||
          choice.incoming_pence !== null || choice.outgoing_pence !== null)
        throw new Error('The confirmed original currency and mapping are unavailable.');
      return { count, incoming: original(choice.incoming_original_minor), outgoing: original(choice.outgoing_original_minor), currency };
    }
    const count = Number(choice.row_count),
      incoming = minorPence(choice.incoming_pence ?? ""),
      outgoing = minorPence(choice.outgoing_pence ?? "");
    if (
      choice.parser !== "mapped-csv/1" ||
      (choice.account_currency != null && choice.account_currency !== 'GBP') ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 5000 ||
      incoming < 0 ||
      outgoing < 0 ||
      !choice.coverage_start ||
      !choice.coverage_end
    )
      throw new Error(
        "The confirmed source mapping is unavailable. Re-upload for review.",
      );
    return { count, incoming, outgoing, currency: 'GBP' as const };
  }
  if (
    choice.parser !== "opaque-evidence/1" ||
    !Number.isInteger(choice.object_count) ||
    choice.object_count < 1 ||
    choice.object_count > 101 ||
    !choice.tax_year_start ||
    !["invoice", "receipt", "employment", "other"].includes(
      choice.purpose ?? "",
    )
  )
    throw new Error(
      "The confirmed document scope is unavailable. Re-upload for review.",
    );
  return { count: choice.object_count, incoming: 0, outgoing: 0, currency: 'GBP' as const };
}

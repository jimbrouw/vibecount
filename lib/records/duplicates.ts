import { minorPence } from "./allocations";
export type DuplicateChoice = {
  id: string;
  account_id: string;
  import_id: string;
  source_row_id: string;
  transaction_date: string;
  signed_amount_pence: number | string;
  currency: string;
  original_signed_minor?: number | string | null;
  source_units_ruleset?: string | null;
  description: string;
  reference: string;
  fingerprint: string;
  classification: string;
  decision_version: number;
  dedupe_status: string;
  active_duplicate_decision_id: string | null;
  account_label: string;
  account_mask: string;
  import_status: string;
  file_hash: string;
  parser_version: string;
  row_number: number;
  row_hash: string;
  record_type: string | null;
  record_status: string | null;
  recognized_pence: number | string;
  peer_count: number | string;
  incoming_duplicate_count: number | string;
  has_financial_dependencies: boolean;
};
export function duplicateReview(
  subject: DuplicateChoice,
  retained: DuplicateChoice | null,
  verdict: "duplicate" | "distinct" | "reverse",
) {
  if (
    subject.has_financial_dependencies ||
    Number(subject.incoming_duplicate_count) > 0
  )
    throw new Error(
      "Review and reverse dependent duplicate references, receipt allocations, transfers or refund groups first.",
    );
  if (verdict === "reverse") {
    if (!subject.active_duplicate_decision_id)
      throw new Error("Choose an active identity decision.");
  } else {
    if (subject.import_status === "discarded" || Number(subject.peer_count) < 1)
      throw new Error(
        "Reopen the import and review overlapping evidence first.",
      );
    if (subject.active_duplicate_decision_id)
      throw new Error(
        "Reverse the existing identity verdict before changing it.",
      );
    if (verdict === "duplicate") {
      if (
        !retained ||
        retained.id === subject.id ||
        retained.account_id !== subject.account_id ||
        retained.fingerprint !== subject.fingerprint ||
        retained.transaction_date !== subject.transaction_date ||
        minorPence(retained.signed_amount_pence) !==
          minorPence(subject.signed_amount_pence) ||
        retained.currency !== subject.currency ||
        retained.dedupe_status !== "clear" ||
        retained.import_status === "discarded"
      )
        throw new Error(
          "Choose a clear, active matching observation from this account.",
        );
    } else if (retained)
      throw new Error(
        "A separate real payment has no retained duplicate reference.",
      );
  }
  const effect = minorPence(subject.recognized_pence),
    remove = verdict !== "distinct";
  if (
    effect !== 0 &&
    !["income", "expense"].includes(subject.record_type ?? "")
  )
    throw new Error(
      "Current accounting effect is unavailable. Reload before reviewing.",
    );
  return {
    removedIncome: remove && subject.record_type === "income" ? effect : 0,
    removedExpense: remove && subject.record_type === "expense" ? effect : 0,
    preservedEffect: remove ? 0 : effect,
  };
}

import { createHash } from "node:crypto";
type Observation = {
  id: string;
  import_id: string;
  source_row_id: string;
  file_hash: string;
  row_number: number;
  row_hash: string;
  transaction_date: string;
  signed_amount_pence: string | number;
  currency: string;
  account_id: string;
  account_label: string;
  account_mask: string;
  decision_version: number;
  classification: string;
  dedupe_status: string;
  recognized_pence: string | number;
  record_type: string | null;
  import_status: string;
};
export type IdentityEvent = {
  id: string;
  decision_id: string;
  event_kind: string;
  transaction_id: string;
  verdict: string;
  rationale: string;
  subject_snapshot: Observation;
  retained_snapshot: Observation | null;
  cohort_snapshot: {
    id: string;
    import_id: string;
    source_row_id: string;
    file_hash: string;
    row_hash: string;
    decision_version: number;
    dedupe_status: string;
    import_status: string;
  }[];
  reviewed_stamp: string;
  author: string;
  created_at: string;
};
const hash = /^[a-f0-9]{64}$/;
function source(s: Observation) {
  if (
    !s ||
    !s.id ||
    !s.import_id ||
    !s.source_row_id ||
    !hash.test(s.file_hash) ||
    !hash.test(s.row_hash) ||
    !Number.isInteger(s.row_number) ||
    s.row_number < 2 ||
    s.currency !== "GBP"
  )
    throw new Error("Missing identity source provenance.");
  return {
    transaction_id: s.id,
    import_id: s.import_id,
    source_row_id: s.source_row_id,
    file_sha256: s.file_hash,
    row_number: s.row_number,
    row_sha256: s.row_hash,
    transaction_date: s.transaction_date,
    signed_amount_pence: String(s.signed_amount_pence),
    currency: s.currency,
    account_id: s.account_id,
    account_label: s.account_label,
    account_mask: s.account_mask,
    decision_version: s.decision_version,
    classification: s.classification,
    dedupe_status: s.dedupe_status,
    recognized_pence: String(s.recognized_pence),
    record_type: s.record_type,
    import_status: s.import_status,
  };
}
/** Explicit allowlist excludes raw source contents, storage coordinates and private extras. */
export function identityManifest(importId: string, events: IdentityEvent[]) {
  for (const e of events) {
    if (
      !["decision", "reversal"].includes(e.event_kind) ||
      !["duplicate", "distinct", "needs_review"].includes(e.verdict) ||
      !Array.isArray(e.cohort_snapshot) ||
      !e.cohort_snapshot.some((s) => s.id === e.transaction_id) ||
      (e.verdict === "duplicate" && !e.retained_snapshot)
    )
      throw new Error("Incomplete identity history.");
    for (const s of e.cohort_snapshot)
      if (
        !s.id ||
        !s.import_id ||
        !s.source_row_id ||
        !hash.test(s.file_hash) ||
        !hash.test(s.row_hash)
      )
        throw new Error("Missing reviewed cohort provenance.");
  }
  const snapshot = {
    import_id: importId,
    events: [...events]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => ({
        event_id: e.id,
        decision_id: e.decision_id,
        event_kind: e.event_kind,
        transaction_id: e.transaction_id,
        verdict: e.verdict,
        rationale: e.rationale,
        subject: source(e.subject_snapshot),
        retained: e.retained_snapshot ? source(e.retained_snapshot) : null,
        reviewed_cohort: e.cohort_snapshot.map((s) => ({
          transaction_id: s.id,
          import_id: s.import_id,
          source_row_id: s.source_row_id,
          file_sha256: s.file_hash,
          row_sha256: s.row_hash,
          decision_version: s.decision_version,
          dedupe_status: s.dedupe_status,
          import_status: s.import_status,
        })),
        reviewed_stamp: e.reviewed_stamp,
        author: e.author,
        created_at: e.created_at,
      })),
  };
  return {
    schema_version: "vibecount.identity-history/1",
    document_status: "Draft — not submitted to HMRC",
    scope:
      "Immutable identity decisions and reversals involving this import, including retained sources in other imports. Snapshot effects describe the reviewed state, not additional postings or current tax eligibility.",
    snapshot_sha256: createHash("sha256")
      .update(JSON.stringify(snapshot), "utf8")
      .digest("hex"),
    snapshot,
  };
}

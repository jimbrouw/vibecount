import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { duplicateReview, type DuplicateChoice } from "./duplicates.ts";
import { identityManifest } from "./duplicate-export.ts";
const subject: DuplicateChoice = {
  id: "subject",
  account_id: "account",
  import_id: "import",
  source_row_id: "row",
  transaction_date: "2026-04-05",
  signed_amount_pence: 150000,
  currency: "GBP",
  description: "Redacted receipt",
  reference: "safe",
  fingerprint: "f".repeat(64),
  classification: "Business",
  decision_version: 1,
  dedupe_status: "clear",
  active_duplicate_decision_id: null,
  account_label: "Synthetic bank",
  account_mask: "1234",
  import_status: "review",
  file_hash: "a".repeat(64),
  parser_version: "test",
  row_number: 2,
  row_hash: "b".repeat(64),
  record_type: "income",
  record_status: "approved",
  recognized_pence: 150000,
  peer_count: 1,
  incoming_duplicate_count: 0,
  has_financial_dependencies: false,
};
const retained = {
  ...subject,
  id: "retained",
  import_id: "older",
  source_row_id: "older-row",
  file_hash: "c".repeat(64),
  row_hash: "d".repeat(64),
};
test("duplicate review states exact effects and preserves separate approved payments", () => {
  assert.deepEqual(duplicateReview(subject, retained, "duplicate"), {
    removedIncome: 150000,
    removedExpense: 0,
    preservedEffect: 0,
  });
  assert.deepEqual(duplicateReview(subject, null, "distinct"), {
    removedIncome: 0,
    removedExpense: 0,
    preservedEffect: 150000,
  });
  assert.deepEqual(
    duplicateReview(
      {
        ...subject,
        record_type: "expense",
        recognized_pence: 18909,
        active_duplicate_decision_id: "d",
      },
      null,
      "reverse",
    ),
    { removedIncome: 0, removedExpense: 18909, preservedEffect: 0 },
  );
  for (const changed of [
    { ...subject, has_financial_dependencies: true },
    { ...subject, incoming_duplicate_count: 1 },
  ])
    assert.throws(
      () => duplicateReview(changed, retained, "duplicate"),
      /dependent/,
    );
  assert.throws(
    () =>
      duplicateReview(
        subject,
        { ...retained, dedupe_status: "needs_review" },
        "duplicate",
      ),
    /clear/,
  );
  assert.throws(
    () =>
      duplicateReview({ ...subject, record_type: null }, retained, "duplicate"),
    /unavailable/,
  );
  assert.throws(
    () =>
      duplicateReview(
        { ...subject, import_status: "discarded" },
        retained,
        "duplicate",
      ),
    /Reopen/,
  );
  assert.doesNotThrow(() =>
    duplicateReview(
      {
        ...subject,
        import_status: "discarded",
        active_duplicate_decision_id: "d",
      },
      null,
      "reverse",
    ),
  );
});
test("identity history exports both source chains, immutable reviewed cohort and reproducible safe digest", () => {
  const event = {
    id: "event",
    decision_id: "decision",
    event_kind: "decision",
    transaction_id: subject.id,
    verdict: "duplicate",
    rationale: "Checked both source statements",
    subject_snapshot: {
      ...subject,
      raw_encrypted: "FORBIDDEN",
      object_path: "FORBIDDEN",
      key_id: "FORBIDDEN",
    },
    retained_snapshot: retained,
    cohort_snapshot: [subject, retained],
    reviewed_stamp: "stamp",
    author: "owner",
    created_at: "2026-10-17T00:00:00Z",
  };
  const exportData = identityManifest("import", [event]);
  assert.doesNotMatch(
    JSON.stringify(exportData),
    /FORBIDDEN|raw_encrypted|object_path|key_id|description|reference/,
  );
  assert.equal(
    exportData.snapshot.events[0].subject.file_sha256,
    subject.file_hash,
  );
  assert.equal(
    exportData.snapshot.events[0].retained?.row_sha256,
    retained.row_hash,
  );
  assert.equal(exportData.snapshot.events[0].reviewed_cohort.length, 2);
  assert.throws(
    () => identityManifest("import", [{ ...event, retained_snapshot: null }]),
    /Incomplete/,
  );
  assert.throws(
    () =>
      identityManifest("import", [
        { ...event, subject_snapshot: { ...subject, row_hash: "" } },
      ]),
    /provenance/,
  );
  assert.equal(
    exportData.snapshot_sha256,
    createHash("sha256")
      .update(JSON.stringify(exportData.snapshot))
      .digest("hex"),
  );
});

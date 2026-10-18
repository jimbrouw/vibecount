import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  buildMerchantQueue,
  merchantBatchEffects,
  merchantUndoEffects,
  percentToBasisPoints,
  type MerchantChoice,
  type MerchantEntry,
} from "./merchant-memory.ts";
import { merchantManifest } from "./merchant-export.ts";
const row = (extra: Partial<MerchantChoice> = {}): MerchantChoice => ({
  id: "a",
  account_id: "bank",
  import_id: "import",
  source_row_id: "source-row",
  transaction_date: "2025-07-06",
  signed_amount_pence: -63029,
  currency: "GBP",
  description: "Synthetic repair",
  reference: "",
  fingerprint: "f".repeat(64),
  classification: "Unknown",
  decision_version: 0,
  dedupe_status: "clear",
  active_duplicate_decision_id: null,
  account_label: "Synthetic bank",
  account_mask: "1234",
  import_status: "review",
  file_hash: "a".repeat(64),
  parser_version: "test",
  row_number: 2,
  row_hash: "b".repeat(64),
  record_type: null,
  record_status: null,
  recognized_pence: 0,
  peer_count: 0,
  incoming_duplicate_count: 0,
  has_financial_dependencies: false,
  tax_year_start: 2025,
  merchant_key: "synthetic repair",
  rule_candidates: [],
  top_rule_count: 0,
  suggested_rule_version_id: null,
  ...extra,
});
const entry: MerchantEntry = {
  transaction_id: "a",
  version: 0,
  origin: "manual",
  rule_version_id: null,
  classification: "Mixed",
  business_use_bps: 3000,
  category_id: "travel",
  evidence_status: "provisional",
  document_ids: [],
};
const categories = [
  { id: "travel", name: "Travel costs", record_type: "expense" },
];
test("merchant review uses exact selected effects and preserves known treatment until explicit override", () => {
  assert.equal(percentToBasisPoints("30.01"), 3001);
  assert.throws(() => percentToBasisPoints("30.001"));
  assert.deepEqual(
    merchantBatchEffects([row(), row({ id: "b" })], [entry], categories),
    {
      count: 1,
      incomeBefore: 0,
      expenseBefore: 0,
      incomeAfter: 0,
      expenseAfter: 18909,
    },
  );
  assert.throws(
    () =>
      merchantBatchEffects(
        [row({ classification: "Personal" })],
        [entry],
        categories,
      ),
    /explicit override/,
  );
  assert.throws(
    () => merchantBatchEffects([row()], [entry, entry], categories),
    /distinct/,
  );
  assert.throws(
    () =>
      merchantBatchEffects(
        [row({ has_financial_dependencies: true })],
        [entry],
        categories,
      ),
    /relationships/,
  );
  assert.throws(
    () =>
      merchantBatchEffects(
        [row()],
        [{ ...entry, evidence_status: "linked" }],
        categories,
      ),
    /evidence/,
  );
  const before = row({
    classification: "Business",
    record_type: "expense",
    recognized_pence: 63029,
  });
  assert.equal(
    merchantBatchEffects(
      [before],
      [
        {
          ...entry,
          origin: "override",
          classification: "Personal",
          business_use_bps: 0,
          category_id: null,
        },
      ],
      categories,
    ).expenseBefore,
    63029,
  );
});
test("merchant undo reports current buckets and blocks changed source scope", () => {
  const source = row({
      classification: "Mixed",
      record_type: "expense",
      recognized_pence: 18909,
      decision_version: 1,
    }),
    versions = [{ transaction_id: "a", after_version: 1 }];
  assert.deepEqual(merchantUndoEffects([source], versions), {
    count: 1,
    incomeBefore: 0,
    expenseBefore: 18909,
  });
  assert.throws(
    () => merchantUndoEffects([{ ...source, decision_version: 2 }], versions),
    /changed/,
  );
  assert.throws(
    () =>
      merchantUndoEffects(
        [{ ...source, has_financial_dependencies: true }],
        versions,
      ),
    /relationship/,
  );
});
test("materiality surfaces unknown £700 independently of confidence and annualises only separated observed dates", () => {
  const software = [
    row({
      id: "s1",
      signed_amount_pence: -1200,
      transaction_date: "2025-07-01",
      merchant_key: "software",
      top_rule_count: 1,
    }),
    row({
      id: "s2",
      signed_amount_pence: -1200,
      transaction_date: "2025-08-01",
      merchant_key: "software",
      top_rule_count: 1,
    }),
  ];
  const queue = buildMerchantQueue(
    [
      ...software,
      row({ id: "hardware", signed_amount_pence: -70000 }),
      row({
        id: "holiday",
        signed_amount_pence: -46309,
        classification: "Personal",
      }),
      row({ id: "other-year", tax_year_start: 2026 }),
    ],
    2025,
  );
  assert.equal(queue[0].row.id, "hardware");
  assert.equal(queue[0].score, 0);
  assert.equal(queue[0].annualized, null);
  assert.equal(queue.find((q) => q.row.id === "s1")?.annualized, 14129);
  assert.equal(queue.length, 3);
  assert.ok(
    buildMerchantQueue(
      [row({ id: "same1" }), row({ id: "same2" })],
      2025,
    ).every((q) => q.annualized === null),
  );
  assert.equal(
    buildMerchantQueue([row({ dedupe_status: "needs_review" })], 2025)[0]
      .priority,
    63029,
  );
});
test("merchant export allowlists nested sources and records a reproducible draft snapshot hash", () => {
  const base = {
    rules: [],
    versions: [],
    batches: [],
    items: [
      {
        id: "item",
        transaction_id: "a",
        before_snapshot: {
          ...row(),
          object_path: "PRIVATE_PATH",
          raw_cells: "PRIVATE_RAW",
        },
        category_snapshot: {
          id: "travel",
          name: "Travel costs",
          record_type: "expense",
          private_key: "PRIVATE_KEY",
        },
      },
    ],
    evidence: [],
    reversals: [],
    undo: [],
  };
  const manifest = merchantManifest(base),
    serialized = JSON.stringify(manifest);
  assert.ok(!serialized.includes("PRIVATE_"));
  assert.equal(
    manifest.snapshot.decisions[0].before_source.row_sha256,
    "b".repeat(64),
  );
  assert.equal(
    manifest.snapshot_sha256,
    createHash("sha256")
      .update(JSON.stringify(manifest.snapshot))
      .digest("hex"),
  );
  assert.match(manifest.document_status, /not submitted/);
  assert.throws(
    () =>
      merchantManifest({
        ...base,
        items: [{ id: "missing", before_snapshot: {} }],
      }),
    /provenance/,
  );
});

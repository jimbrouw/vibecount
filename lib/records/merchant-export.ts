import { createHash } from "node:crypto";
import type { MerchantChoice } from "./merchant-memory";
type Row = Record<string, unknown> & { id: string };
const fields = (row: Row, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));
function source(value: unknown) {
  const row = value as MerchantChoice;
  if (
    !row?.id ||
    !/^[a-f0-9]{64}$/.test(row.file_hash) ||
    !/^[a-f0-9]{64}$/.test(row.row_hash) ||
    !Number.isInteger(row.row_number)
  )
    throw new Error("Source provenance unavailable.");
  return {
    transaction_id: row.id,
    import_id: row.import_id,
    source_row_id: row.source_row_id,
    file_sha256: row.file_hash,
    row_sha256: row.row_hash,
    row_number: row.row_number,
    account_id: row.account_id,
    account_label: row.account_label,
    account_mask: row.account_mask,
    transaction_date: row.transaction_date,
    signed_amount_pence: String(row.signed_amount_pence),
    currency: row.currency,
    decision_version: row.decision_version,
    classification: row.classification,
    recognized_pence: String(row.recognized_pence),
    record_type: row.record_type,
  };
}
export function merchantManifest(data: {
  rules: Row[];
  versions: Row[];
  batches: Row[];
  items: Row[];
  evidence: Row[];
  reversals: Row[];
  undo: Row[];
  rollovers?: Row[];
}) {
  const snapshot = {
    rollovers: (data.rollovers ?? []).map(r => fields(r, ["id", "source_rule_id", "source_version_id", "target_rule_id", "target_version_id", "target_tax_year_start", "reviewed_stamp", "rationale", "author", "request_id", "created_at"])),
    rules: data.rules.map((r) =>
      fields(r, [
        "id",
        "match_key",
        "record_type",
        "normalization_version",
        "created_at",
      ]),
    ),
    versions: data.versions.map((r) => ({
      ...fields(r, [
        "id",
        "rule_id",
        "ordinal",
        "status",
        "account_id",
        "tax_year_start",
        "effective_from",
        "expires_on",
        "priority",
        "classification",
        "business_use_bps",
        "category_id",
        "evidence_status",
        "seed_transaction_id",
        "rationale",
        "author",
        "request_id",
        "created_at",
      ]),
      category: category(r.category_snapshot),
      source: source(r.seed_snapshot),
    })),
    batches: data.batches.map((r) =>
      fields(r, [
        "id",
        "reviewed_stamp",
        "rationale",
        "author",
        "request_id",
        "created_at",
      ]),
    ),
    decisions: data.items.map((r) => ({
      ...fields(r, [
        "id",
        "batch_id",
        "transaction_id",
        "rule_version_id",
        "origin",
        "after_version",
        "classification",
        "business_use_bps",
        "category_id",
        "evidence_status",
        "recognized_pence",
        "rationale",
        "created_at",
      ]),
      category: category(r.category_snapshot),
      before_source: source(r.before_snapshot),
    })),
    evidence: data.evidence.map((r) => {
      const d = r.document_snapshot as Row;
      if (!d?.id || !/^[a-f0-9]{64}$/.test(String(d.file_sha256)))
        throw new Error("Document provenance unavailable.");
      return {
        ...fields(r, ["id", "item_id", "document_id"]),
        document: fields(d, ["id", "file_sha256", "media_type", "size_bytes"]),
      };
    }),
    reversals: data.reversals.map((r) =>
      fields(r, [
        "id",
        "batch_id",
        "reviewed_stamp",
        "rationale",
        "author",
        "request_id",
        "created_at",
      ]),
    ),
    undo: data.undo.map((r) => ({
      ...fields(r, [
        "id",
        "reversal_id",
        "item_id",
        "transaction_id",
        "after_version",
      ]),
      before_source: source(r.before_snapshot),
    })),
  };
  return {
    document_status: "Draft — not submitted to HMRC",
    schema_version: "merchant-memory/2",
    snapshot_sha256: createHash("sha256")
      .update(JSON.stringify(snapshot))
      .digest("hex"),
    snapshot,
  };
}
function category(value: unknown) {
  if (!value) return null;
  return fields(value as Row, ["id", "name", "record_type"]);
}

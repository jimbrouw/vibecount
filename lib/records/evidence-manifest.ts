import { createHash } from "node:crypto";
import { evidenceLedger, sourceRecordEffects, type SourceExportRow } from "./source-export.ts";

type SourceMetadata = {
  id: string;
  file_hash: string;
  parser_version: string;
  account_id: string;
  status: string;
  created_at: string;
  coverage_start: string | null;
  coverage_end: string | null;
};

/** Explicit allowlists keep raw cells, storage paths and credentials out of exports. */
export function evidenceManifest(
  source: SourceMetadata,
  account: { label: string; masked_identifier: string },
  rows: SourceExportRow[],
) {
  const totals = evidenceLedger(
    {
      ...source,
      account_label: account.label,
      account_mask: account.masked_identifier,
    },
    rows,
  );
  const transactions = [...rows]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((row) => {
      const evidence = Array.isArray(row.source_rows)
        ? row.source_rows[0]
        : row.source_rows;
      const effects = sourceRecordEffects(row);
      if (!evidence) throw new Error("Missing source-row provenance.");
      return {
        transaction_id: row.id,
        source_row_id: row.source_row_id,
        source_row_number: evidence.row_number,
        source_row_sha256: evidence.row_hash,
        transaction_date: row.transaction_date,
        tax_year_start: row.tax_year_start,
        signed_amount_pence: String(row.signed_amount_pence),
        currency: row.currency,
        classification: row.classification,
        business_use_basis_points: row.business_use_bps,
        decision_version: row.decision_version,
        active_transfer_pair_id: row.active_transfer_id ?? null,
        active_refund_id: row.active_refund_id ?? null,
        dedupe_status: row.dedupe_status,
        active_duplicate_decision_id: row.active_duplicate_decision_id ?? null,
        retained_duplicate_transaction_id:
          (Array.isArray(row.duplicate_decision)
            ? row.duplicate_decision[0]
            : row.duplicate_decision
          )?.retained_transaction_id ?? null,
        recognized_income_pence: String(effects.incomePence),
        recognized_expense_pence: String(effects.expensePence),
        recognized_profit_pence: String(effects.profitPence),
        financial_records: effects.records.map(r => ({ ...r, recognized_effect_pence: String(r.recognized_effect_pence) })),
        refund_portions: effects.refundPortions,
      };
    });
  const snapshot = {
    import_id: source.id,
    import_status: source.status,
    imported_at: source.created_at,
    parser_version: source.parser_version,
    file_sha256: source.file_hash,
    coverage: { start: source.coverage_start, end: source.coverage_end },
    account: {
      id: source.account_id,
      label: account.label,
      ending: account.masked_identifier,
    },
    transaction_count: transactions.length,
    recognized_income_pence: String(totals.incomePence),
    recognized_expense_pence: String(totals.expensePence),
    transactions,
  };
  return {
    schema_version: "vibecount.evidence-manifest/2",
    document_status: "Draft — not submitted to HMRC",
    scope:
      "Current import evidence and decisions; not a locked filing pack. Business treatment remains provisional for tax eligibility.",
    hash_definitions: {
      file_sha256:
        "SHA-256 of exact original uploaded bytes before encryption.",
      source_row_sha256:
        "SHA-256 of UTF-8 JSON.stringify(original cell array), preserving parsed cell order and contents.",
      snapshot_sha256:
        "SHA-256 of UTF-8 JSON.stringify(snapshot) as emitted, with transaction IDs sorted ascending. This checks integrity; it is not an authenticity signature.",
    },
    snapshot_sha256: createHash("sha256")
      .update(JSON.stringify(snapshot), "utf8")
      .digest("hex"),
    snapshot,
  };
}

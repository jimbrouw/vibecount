import { createHash } from "node:crypto";
import { validateFact, validateProfile, type FactKind } from "./facts";
type Row = Record<string, unknown> & { id: string };
const pick = (r: Row, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, r[k] ?? null]));
export function taxFactManifest(
  year: number,
  data: { profiles: Row[]; facts: Row[]; sources: Row[]; sections: Row[] },
) {
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100 ||
    data.profiles.some((r) => r.schema_version !== "tax-profile/1") ||
    data.facts.some((r) => r.schema_version !== "tax-facts/1")
  )
    throw new Error("Unsupported tax fact schema or year.");
  const snapshot = {
    tax_year_start: year,
    profiles: data.profiles.map((r) => ({
      ...pick(r, [
        "id",
        "profile_id",
        "ordinal",
        "schema_version",
        "state",
        "financial_stamp",
        "rationale",
        "author",
        "created_at",
        "request_id",
      ]),
      data: validateProfile(r.data, r.state === "reviewed"),
    })),
    facts: data.facts.map((r) => ({
      ...pick(r, [
        "id",
        "family_id",
        "ordinal",
        "schema_version",
        "kind",
        "label",
        "state",
        "rationale",
        "author",
        "created_at",
        "request_id",
      ]),
      data: validateFact(r.kind as FactKind, r.data, year, String(r.state)),
    })),
    sources: data.sources.map((r) => {
      const s = r.snapshot as Row;
      if (!s?.id) throw new Error("Fact source metadata unavailable.");
      if (r.document_id && !/^[a-f0-9]{64}$/.test(String(s.file_sha256)))
        throw new Error("Document hash unavailable.");
      if (
        r.transaction_id &&
        (!/^[a-f0-9]{64}$/.test(String(s.file_sha256)) ||
          !/^[a-f0-9]{64}$/.test(String(s.row_sha256)))
      )
        throw new Error("Bank source hashes unavailable.");
      return {
        ...pick(r, [
          "id",
          "revision_id",
          "document_id",
          "transaction_id",
          "record_id",
        ]),
        snapshot: pick(
          s,
          r.document_id
            ? ["id", "file_sha256", "media_type", "size_bytes"]
            : r.transaction_id
              ? [
                  "id",
                  "import_id",
                  "source_row_id",
                  "file_sha256",
                  "row_sha256",
                  "row_number",
                  "transaction_date",
                  "signed_amount_pence",
                  "currency",
                  "classification",
                  "decision_version",
                  "recognized_pence",
                  "account_label",
                  "account_mask",
                ]
              : [
                  "id",
                  "record_type",
                  "amount",
                  "effect_sign",
                  "record_date",
                  "tax_year_start",
                  "status",
                  "bank_transaction_id",
                ],
        ),
      };
    }),
    sections: data.sections.map((r) =>
      pick(r, [
        "id",
        "kind",
        "ordinal",
        "verdict",
        "fact_digest",
        "rationale",
        "author",
        "created_at",
        "request_id",
      ]),
    ),
  };
  return {
    document_status: "Draft — not submitted to HMRC",
    schema_version: "reviewed-tax-facts/1",
    caveat:
      "Typed facts and provenance only. This is not a tax calculation, tax advice, filing pack or approval of a deduction. Missing inputs are not zero.",
    snapshot_sha256: createHash("sha256")
      .update(JSON.stringify(snapshot))
      .digest("hex"),
    snapshot,
  };
}

import { createHash } from "node:crypto";

export type DocumentManifestItem = {
  id: string;
  ordinal: number;
  document_id: string;
  document:
    | { id: string; file_hash: string; media_type: string; size_bytes: number }
    | {
        id: string;
        file_hash: string;
        media_type: string;
        size_bytes: number;
      }[]
    | null;
};
export function documentManifest(
  batch: {
    id: string;
    root_document_id: string;
    tax_year_start: number;
    purpose: string;
    parser_version: string;
    created_at: string;
  },
  items: DocumentManifestItem[],
) {
  const evidence = [...items]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((item, i) => {
      const doc = Array.isArray(item.document)
        ? item.document[0]
        : item.document;
      if (
        !doc ||
        item.ordinal !== i ||
        doc.id !== item.document_id ||
        (i === 0 && doc.id !== batch.root_document_id)
      )
        throw new Error("Incomplete document provenance.");
      return {
        item_id: item.id,
        ordinal: item.ordinal,
        document_id: doc.id,
        file_sha256: doc.file_hash,
        media_type: doc.media_type,
        size_bytes: doc.size_bytes,
      };
    });
  if (!evidence.length) throw new Error("Incomplete document provenance.");
  const snapshot = {
    batch_id: batch.id,
    tax_year_start: batch.tax_year_start,
    purpose: batch.purpose,
    parser_version: batch.parser_version,
    preserved_at: batch.created_at,
    review_status: "Unresolved",
    root_document_id: batch.root_document_id,
    evidence,
  };
  return {
    schema_version: "vibecount.document-manifest/1",
    document_status: "Draft — not submitted to HMRC",
    scope:
      "Preserved opaque evidence. Signatures checked; structural readability and financial/tax facts have not been verified. Ordinal zero is the original upload; later ordinals retain archive occurrences, including repeated content.",
    hash_definitions: {
      file_sha256: "SHA-256 of original plaintext bytes before encryption.",
      snapshot_sha256:
        "SHA-256 of UTF-8 JSON.stringify(snapshot) as emitted. Integrity check, not an authenticity signature.",
    },
    snapshot_sha256: createHash("sha256")
      .update(JSON.stringify(snapshot))
      .digest("hex"),
    snapshot,
  };
}

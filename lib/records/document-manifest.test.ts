import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  documentManifest,
  type DocumentManifestItem,
} from "./document-manifest.ts";

const batch = {
  id: "batch",
  root_document_id: "archive",
  purpose: "invoice",
  tax_year_start: 2025,
  parser_version: "opaque-evidence/1",
  created_at: "2026-10-17T12:00:00Z",
  private_name: "PRIVATE",
};
const items: DocumentManifestItem[] = [
  {
    id: "item0",
    document_id: "archive",
    ordinal: 0,
    document: {
      id: "archive",
      file_hash: "a".repeat(64),
      media_type: "application/zip",
      size_bytes: 300,
    },
  },
  {
    id: "item1",
    document_id: "pdf",
    ordinal: 1,
    document: {
      id: "pdf",
      file_hash: "b".repeat(64),
      media_type: "application/pdf",
      size_bytes: 100,
    },
  },
  {
    id: "item2",
    document_id: "pdf",
    ordinal: 2,
    document: {
      id: "pdf",
      file_hash: "b".repeat(64),
      media_type: "application/pdf",
      size_bytes: 100,
    },
  },
];
test("document manifest retains archive member occurrences, safe hashes and reproducible digest", () => {
  const result = documentManifest(
    batch,
    [...items]
      .reverse()
      .map((item) => ({
        ...item,
        original_name_encrypted: "PRIVATE",
        object_path: "PRIVATE",
      })),
  );
  assert.equal(result.snapshot.evidence.length, 3);
  assert.equal(
    result.snapshot.evidence[1].document_id,
    result.snapshot.evidence[2].document_id,
  );
  assert.equal(result.snapshot.review_status, "Unresolved");
  assert.equal(
    result.snapshot_sha256,
    createHash("sha256").update(JSON.stringify(result.snapshot)).digest("hex"),
  );
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  assert.match(result.document_status, /Draft — not submitted to HMRC/);
});
test("document manifest rejects missing, discontinuous or mismatched evidence", () => {
  for (const rows of [
    [],
    items.slice(1),
    [items[0], items[2]],
    [{ ...items[0], document: null }],
    [{ ...items[0], document_id: "wrong" }],
  ])
    assert.throws(() => documentManifest(batch, rows), /provenance/);
});

# Private retained invoice byte checks

18 October 2026. Prerequisite for [canonical external capture](external-invoice-capture-design.md), not canonical capture itself. External invoice constraints remain closed. No financial record, invoice, settlement, valuation or provider connection is created by a check.

## Human review and private transport

The existing FX evidence form compares an unnamed local copy's hash and records human original-read attestation. Neither proves the retained encrypted object can be decrypted. A separate form on `/dashboard/reconciliation/fx/evidence` now lets a human select current verified invoice evidence and request a private stored-copy check. It shows original currency figures/words, date, exact evidence revision and stored hash. Changing the selected fact, reason or refreshed props resets confirmation. The submitted fields contain no bytes, filename, key or object path.

The action authenticates through cookies, validates bounded exact fields and derives owner. The server recovers exact retained requests before current catalog, keys or objects. Fresh checks select only current verified invoice-purpose evidence. A private service query selects that owner's document metadata; full identity/hash/media/size/path/key-ID validation precedes key loading or object download. Only the recorded retained key is used. A missing key never falls back to the active key.

The server downloads from private `document-evidence` Storage and checks the ciphertext blob's exact size before allocating its array buffer. The bucket's existing upload limit remains 3.1 MB; accepted plaintext is at most 3 MB. AES-GCM authenticates the owner/hash context, then exact plaintext length and SHA-256 must match the manifest. PDF/PNG/JPEG signatures must match the declared type. Plaintext and the temporary key copy are cleared after use. No raw source or signed URL is returned to the browser, telemetry or AI.

This verifies authenticated bytes and structural file signatures. It does not render a PDF/image, inspect its meaning, verify tax treatment or replace human review. It is not a general raw-source access endpoint or comprehensive evidence-lifecycle/access-audit implementation.

## Audit, currentness and recovery

Local forward migration `20261018220000_invoice_source_read_checks.sql` adds immutable owner-scoped check history and a service-only recorder. Existing facts, requests, snapshots and financial stamps are unchanged. No existing verification is backfilled with a byte-read claim.

Completed checks retain safe original metadata, exact fact revision and request/reason, outcome, author and time. Decryption/download/key/metadata failures can record `unavailable`; successful checks record `verified` only after trusted server byte verification and SQL current-source validation. SQL itself does not decrypt or possess keys. The service role is the trusted server boundary; authenticated and anonymous callers cannot mint checks or mutate history.

For fresh successful records, SQL requires the same owned invoice fact/source snapshot, latest verified human-reviewed state, current document and exact invoice-purpose registration selection. `SHARE NOWAIT` locks on facts, documents, registrations and Storage metadata prevent a concurrent source change from committing inside the final audit check. Both commit orders are tested for object deletion and registration changes. Superseded facts, missing objects and changed registration selection cannot authorize fresh success.

Exact retries recover before mutable checks. An old verified record remains a past success after source/key loss; it must never establish current availability for canonical capture. A new request is needed for another check. Changed requests reject. An uncertain/failed audit response never becomes a success or causes a competing failure write; reusing the exact request recovers a committed result if present. The page labels history as point-in-time and keeps it separate from current fact eligibility, with 20-row pages and a continuation link.

## Reproduction and remaining gates

Run `npx tsx scripts/demo-invoice-source-read.ts` for `/tmp/vibecount-invoice-source-read-demo`. Actual synthetic AES-GCM bytes and ordered predecessor/forward SQL produce safe success/recovery/failure metadata. The controlled fixture retains the catalog selected before source loss to reproduce disappearance between selection and download. It creates zero invoices and financial records, emits no raw bytes/paths/keys, and does not prove hosted Storage access or PDF rendering.

Focused tests exercise real cryptography, owner/context/hash/size/signature failures, unknown keys, path/metadata rejection before download, exact success/failure recovery, uncertain audit, action bounds/auth, immutable RLS/grants, source supersession/registration changes and independent-connection races. The browser fixture checks read-back and confirmation reset with inert actions. Full checkpoint verification is recorded in [implementation-progress.md](implementation-progress.md).

Before hosted rollout, inspect linked migrations, apply/rehearse the complete chain, test actual Storage/Auth/PostgREST grants, retained-key operations and load. Table-level locks may reject a check during an unrelated source write. Preserve checks and original evidence when withdrawing the UI; do not drop populated immutable history. Hosted object availability and coordinated database/object/key restore remain unproven.

Next: strict one-family canonical capture/correction, using a fresh owned server-read proof with positive external source revisions and direct-write/delete guards. All dimensioned FX settlements/reversals/exports, foreign accounts/fees/refunds, evidence retention/deletion/recovery, durable communication recovery, representative provider/hosted acceptance and independent tax/form review remain required. A read-check receipt alone cannot approve any financial action.

# Document evidence intake

Subsequent implementation: [evidence-recovery.md](evidence-recovery.md) adds preserved registration intent, failed-upload recovery, keyring support and separate name-key provenance. This document otherwise records the earlier intake slice; hosted deployment remains unverified.

Implemented locally at `/dashboard/imports`; not deployed or certified as an authenticated Supabase end-to-end workflow.

## Migration and storage

Apply `20261017120000_document_evidence.sql` after the two source-ledger migrations, following schema rehearsal and backup review. It adds service-only upload attempts, immutable document/batch/member provenance, append-only intake events and the private ciphertext-only `document-evidence` bucket. No authenticated object policies are defined for this bucket. Existing record attachments remain a separate legacy feature.

Reuse server-only `VIBECOUNT_SOURCE_ENCRYPTION_KEY` and `VIBECOUNT_SOURCE_KEY_ID` configuration. Content uses AES-256-GCM with owner/content-hash AAD; original filenames/member paths are separately encrypted with owner/root-hash/ordinal AAD. The browser receives safe type/size/hash metadata and generated member labels, never original filenames, content, ciphertext paths or keys. No AI service is called.

## Accepted inputs and limits

- Individual PDF, PNG or JPEG for invoice, receipt, employment or other evidence; maximum 3,000,000 bytes.
- Invoice ZIP containing only PDFs and optional directory entries; maximum 100 entries, 3,000,000 bytes compressed input, 3,000,000 bytes per expanded member, 10,000,000 bytes aggregate expansion and 100:1 per-member expansion ratio.
- The entire multipart request is bounded to 3,100,000 bytes before parsing, independently of `Content-Length`.

File signatures are checked against extensions. PDF/image structural readability, document authenticity and any financial/tax facts are **not** verified. Files remain opaque unresolved evidence. No PDF content is executed/rendered or sent to an LLM. OCR, extraction, document-fact review, source previews and linking to invoices/PAYE/expenses remain further work.

The archive reader uses bounded lazy member streams from [yauzl](https://github.com/thejoshwolfe/yauzl), verifies actual length and CRC, and never extracts to disk. Traversal, absolute/drive/backslash/control paths, normalized case-insensitive duplicate paths, symlinks/nonregular entries, encryption, unsupported methods/members, signature mismatches, CRC errors, truncation and expansion excess reject the complete intake. Ordinary unsupported files (including macOS metadata) are not silently skipped: remove them before retrying.

## Atomicity, dedupe and recovery

The whole archive validates before any upload. A service-only attempt records every planned encrypted object path. All uploads use fresh paths with overwrite disabled. Only after every object upload succeeds does the service-only registration procedure atomically create provenance and history. Registration creates zero `financial_records` and approves no facts.

Owner-wide locking serializes content dedupe across different archives. Content identity is `(owner, plaintext SHA-256)`; batch identity also includes purpose and tax year so the same evidence can support another context. Separate member rows preserve repeated archive occurrences even if they share content storage. Reimports record an event and reuse the canonical batch. Each attempt currently retains its encrypted object copies, including duplicates.

Storage and Postgres are separate systems. Partial uploads, failed registrations and uncertain responses retain ciphertext plus attempt metadata. Conditional failure updates never overwrite `linked` or `duplicate` state after a committed RPC with a lost response. Recovery must inspect the canonical batch, attempt state and planned objects before retrying, verify decryption/hash/size, and preserve the corresponding key ID. A full operational recovery tool, key rotation/re-encryption, retention/deletion and orphan-object cleanup are still outstanding; do not delete retained objects as an automatic error response.

## Review and export

The upload gate confirms purpose/year and preservation only. Every batch is visibly unresolved. It creates no receipt, deductible expense, paid invoice or verified employment fact. `/api/evidence/[batchId]/manifest` exports safe immutable provenance, file hashes and archive ordinals with an independently reproducible snapshot digest. It includes no raw names, contents or storage references and is labelled **Draft — not submitted to HMRC**. An integrity digest is not an authenticity signature or a reviewed filing pack.

## Proof and remaining limits

Synthetic readable PDFs and an invoice ZIP are in `fixtures/document-evidence/`; their README describes the demo. Unit tests validate actual fixtures plus malicious ZIPs, body limits, encryption and manifest privacy. Failure-injection tests cover attempt creation, partial upload, state update, registration failure and committed registration with a lost response. PostgreSQL migration/RLS tests prove atomic rollback, duplicate-member preservation, owner isolation, raw-column denial, immutability and zero accounting entries; native PostgreSQL independent connections prove concurrent same-file dedupe.

Browser component tests verify preservation confirmation, resetting after purpose/year changes, multipart values and unresolved success status using an inert mocked API. They do not replace actual Storage HTTP policy verification or a full authenticated browser/database upload. Those, operational recovery and source-fact review remain explicit release requirements.

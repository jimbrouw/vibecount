# Explicit-request evidence deletion

## Policy and existing architecture

The owner selected explicit user requests only. No retention timer or automatic deletion job is authorized by this policy. Engineering tests use disposable synthetic evidence only.

The application currently preserves original ciphertext in private Storage and additional ciphertext in database rows. Normalized transactions, approved financial records, classification decisions, reviewed tax/FX facts and saved calculations/packs retain source identities. Original hashes and decision history must remain auditable. Deleting an object alone does not implement this policy.

| Sensitive copy | Current location | Required handling |
| --- | --- | --- |
| Bank original and duplicate uploads | `record_source_files.object_path`, `source_upload_attempts.object_path`, `source-evidence` bucket | Include every owned same-content copy, even across accounts and unfinished attempts |
| Raw CSV cells | `source_rows.raw_encrypted` | Scrub only after a confirmed, fenced request; retain row number/hash and normalized ancestry |
| Document originals and archive copies | `evidence_documents.object_path`, every `document_upload_attempts.planned_objects` path | Follow shared content through all ZIP/batch/attempt relationships; remove the containing archive or explicitly retain the child |
| Original encrypted document names | `document_batch_items.original_name_encrypted` and `planned_objects[*].name_encrypted` | Scrub both copies, including duplicate attempts |
| Import names and recovery metadata | `record_imports.original_filename`, source recovery-plan filename, captured/exported snapshots | Disclose retained metadata; complete its treatment before enabling confirmation |
| Recorded key identifiers | source/document rows and `document_name_keys` | Retain provenance; never destroy a global key shared with unrelated evidence |

## Implemented discovery surface

Migration `20261020050000_evidence_deletion_preview.sql` adds an authenticated, owner-bound, read-only preview RPC. Imports links to `/dashboard/imports/deletion` for each source/document. The preview exposes counts, hashes, tax years and masked account labels; it does not expose ciphertext, object paths, key identifiers or plaintext document names.

Document scope follows the transitive closure of content shared by registered batches and all retained upload attempts. A pending archive containing a selected child is included, along with its other contents. Source scope includes the same original hash across the owner's accounts and duplicate/unregistered upload paths. Capacity or malformed connected-document metadata fails closed rather than silently truncating the inventory.

The inventory fingerprint changes with its private copy inventory. It is **not a financial dependency stamp and cannot authorize deletion**. The page explicitly has no confirmation or deletion action. Direct dependency counts and owner-wide saved-material counts are separate; the latter deliberately do not claim every saved bundle references the selected source. More complete JSON ancestry and mutable dependency-version checks are required before confirmation.

Local integration test: `npx tsx --test lib/database/evidence-deletion-preview.test.ts`. It creates two registered archives sharing a child and a third unfinished archive, proving closure over six content hashes, eight retained paths and thirteen encrypted-name copies. It also covers identical statement content across two accounts, orphan attempt paths, ownership/grants, missing-object inventory changes, privacy of the response and unchanged ciphertext/financial rows.

## Availability foundation implemented locally

Migration `20261020060000_evidence_availability_fence.sql` adds private immutable per-object deletion targets and an availability view. No application role can create a target, and no request or removal endpoint is enabled. Existing Storage-presence functions and their table freezes use that view. Original-download reads check availability before decrypting; their final audit insertion checks it again under a transaction lock. Upload registration rejects targeted content hashes, including replay of a previously registered document attempt.

Tests cover preserved ciphertext and history, ownership and grants, wrong target identity, a target appearing between download and audit, blocked re-registration/new upload attempts, and real PostgreSQL concurrency. The concurrent test proves both directions: a target waits for an existing availability freeze or download audit to commit, and a later download audit waits for an in-flight target then rejects it. Storage row readers force target insertion to fail closed until released.

This is **not the complete deletion safety gate**. Migration 95 adds target-aware native tax-fact, tax-scope, merchant-evidence and financial-approval validation (details below). Complete indirect dependency coverage, saved-pack freshness and recovery replay outcomes still need review before requests are enabled. Actual removal, ciphertext scrubbing, scope confirmation and restore suppression remain unimplemented.

Verification: 36 focused checks passed across original-access, deletion-preview/availability, native PostgreSQL concurrency, evidence recovery, bank valuation/coverage, dimensioned source registration and tax-calculation tests. The concurrency test initially expected immediate rejection where PostgreSQL correctly waits on the target-table lock; it now observes the lock wait and verifies the result after commit. TypeScript, targeted lint and whitespace checks passed. All tests use disposable databases; no hosted migration or deletion was performed.

## Approval and current-tax safeguards

Migration `20261020070000_evidence_approval_fence.sql` blocks new tax sources/scopes and merchant evidence linked to targeted originals. Approved financial record writes check the bank/import source and refund origin. A private owner-scoped reference query also follows current merchant evidence and record/import ancestry. Authenticated callers can only query their own reference status.

Current tax-source status becomes unresolved after targeting, and a current tax scope supported by a targeted document becomes stale. The current calculation projection carries those existing blocking fields; historical input projections, saved calculations and immutable fact/source snapshots are unchanged. Withdrawal and exclusion remain permitted. This migration does not create deletion requests or grant permission to create targets.

Verification: 39 focused tests passed covering deletion approval, native PostgreSQL concurrency, merchant memory, tax facts, snapshot capture and deterministic tax calculation. The new fixture proves current-source invalidation, rejection of new reviews, owner isolation, preserved source history, allowed withdrawal/exclusion, and blocked direct import-backed financial approval. The PostgreSQL test proves approval-before-target and target-before-approval ordering using independent connections. TypeScript and targeted lint passed. Complete indirect FX/invoice/refund dependency coverage and saved-pack availability remain release gates; these focused tests do not claim that entire gate is complete.

## Recovery and planning safeguards

Migration 96 checks the owned upload attempt against targeted content before recovery commit, including exact request replay. The server adapter checks before replay, download and archive-member upload, and again before returning a concurrent recovered result. Historical recovery audit rows remain intact. Eight focused recovery tests passed, including a genuine successful recovery followed by targeting and rejected replay.

Migration 97 removes targeted documents from current cash-plan/deadline catalogs and their context stamps. New captures validate against the same retained-document view; the deadline freeze locks its backing targets as well as document metadata. Historical catalogs and exact snapshot retries retain their original behavior. The public current catalog explicitly filters by authenticated owner and exposes only safe metadata. Twenty-five focused database/route tests passed, including targeted-source rejection, owner isolation, catalog changes and historical retry/export behavior. TypeScript and targeted lint passed.

Checking availability before a Storage upload does not make the remote upload atomic with a later target commit. Migration 99 adds durable admission for the controlled upload paths (below). Unknown-outcome reconciliation and rollout quiescence remain operational gates; SQL registration rejection alone does not prove physical erasure. Migration 98 now covers filing-only document availability (below). The remaining in-flight upload gap is not masked by enabling requests prematurely.

## Filing-only source completeness

Migration 98 introduces `filing-pack-input/6` and `draft-filing-pack/7`. Every current filing document carries a required boolean `source_available`, based on owned Storage presence and deletion targets. This includes year-batch-only documents that are not linked to a current tax fact. Their availability changes the sources review digest and blocks completeness attestation even after re-review. A current calculation can remain current when only unrelated supporting documents become unavailable; its amounts are not silently changed.

The capture RPC independently blocks completeness for unavailable documents under the existing evidence freeze. The evidence manifest retains the reviewed availability fields, and saved-pack verification checks those fields against its frozen input. Earlier input/bundle versions remain verifiable; exact old capture retries return the retained pack. Current page and server handling accept the new contract.

Focused checks passed for malformed/missing availability, unavailable evidence, stale source reviews, manifest tampering, direct SQL completeness forgery, owner isolation, unchanged calculation figures, and predecessor pack replay. The database test uses a real registered year-batch document without a tax-fact link. No deletion or hosted migration is enabled by this change.

## Durable upload coordination

Migration 99 adds immutable upload operations and acknowledgements. Source upload, document upload and recovery of archive members all obtain single-use admission before Storage I/O. Admission validates the owned attempt, planned path and retained content; completion is recorded only after a successful provider acknowledgement and a metadata-presence check. Lost responses, crashes and failed completion recording leave an unresolved operation. Replaying admission never authorizes a second send.

Target insertion rejects unresolved operations for the same owner/bucket/content hash, including different duplicate paths. Database locks serialize admission against target creation. Completion is idempotent, but neither the adapter nor database silently expires an unresolved operation. The deletion preview reports unresolved operations and includes their history in its inventory fingerprint without exposing operation paths or ciphertext.

Twenty-five focused tests passed, including independent PostgreSQL connections in both race directions, same-content duplicate paths, owner/grant boundaries, strict begin/completion responses, no send after failed admission, no provider retry after lost completion, preview status and retained recovery behavior. TypeScript, targeted lint and whitespace checks passed. All operations in these tests use disposable data.

Before rollout, stop and drain pre-migration upload/recovery workers; an already running old worker has no operation record. Operator recovery for unknown outcomes still needs a separately verified quiescence/reconciliation procedure. The presence of a Storage object alone is insufficient to release an uncertain operation. No automatic expiry or user-facing bypass is implemented. Deletion requests and erasure remain disabled until scope confirmation, ciphertext scrubbing, removal outcomes and restore suppression are complete.

## Private confirmed-request boundary

Migration 100 adds immutable deletion requests and a private request writer. No application role can call that writer. The current preview obtains `review_evidence_deletion`, which adds a retained-material disclosure and a dependency fingerprint while explicitly reporting `confirmation_enabled: false`.

The fingerprint conservatively covers all owned public-table rows, owner settings and declared shared rules/default records. It chains hashes without returning source fields. Other owners' private records do not participate. Unknown ownership mappings fail closed. This intentionally invalidates review for any owned-state change, including a financial amount changing while direct-link counts remain constant. Interactive review is bounded to 20,000 rows per table and 20 MB of serialized dependency state.

The private writer requires exact inventory and dependency fingerprints, disclosure version, reason, request ID and explicit confirmation. It acquires the existing owner reconciliation lock and short SHARE/NOWAIT freezes on public tables and Storage metadata, recomputes both fingerprints, rejects unresolved uploads and records the request plus all scoped targets atomically. These rare global freezes can fail while another owner is writing; the caller must reload/retry. Exact request replay returns its original identity; changed or foreign-owner replay fails. No ciphertext or Storage object is erased by this function.

Four focused tests passed: shared archive expansion, all-account source scope, stale dependency edits, owner isolation, denied application calls, unresolved-upload rejection, late-failure rollback, immutable request replay and real PostgreSQL direct-writer concurrency. TypeScript, targeted lint and whitespace checks passed. The request calls were made only as database owner inside disposable synthetic tests. The public page continues to provide no confirmation control.

## Private ciphertext scrubbing

Migration 101 adds a private scrub operation for an existing owned, confirmed request. It clears only scoped raw source ciphertext, document batch filename ciphertext and upload-plan filename ciphertext. All other fields, normalized financial records and historical approvals remain intact. An immutable count audit is written in the same transaction; audit failure rolls back the removal. Exact retries return the original audit. Application roles cannot call the operation.

The affected immutable guards permit only the exact confirmed ciphertext-to-NULL transition. New evidence must still contain ciphertext, and targeted imports/documents reject new ciphertext copies. Preview counts now describe remaining ciphertext. Eleven focused database checks passed, including shared archive scope, owner isolation, unrelated evidence preservation, audit rollback, rehydration rejection, registration/recovery regressions and native PostgreSQL concurrency. This is a local synthetic verification; no real evidence was removed.

Storage erasure, per-object outcomes and independently retained restore suppression remain unfinished. Public confirmation remains disabled. The policy remains explicit user requests only; no scheduled deletion is introduced.

## Private per-object removal protocol

Migration 102 adds immutable removal attempts and outcomes. Admission requires an owned target and completed ciphertext scrub; it is single-use and blocks overlapping pending attempts or an already verified-absent target. Failed/unknown outcomes permit a new attempt without overwriting prior history. The outcome writer independently rejects absence while Storage metadata remains. All functions and tables remain inaccessible to application roles.

`lib/records/evidence-removal.ts` implements admission → one provider removal → provider absence verification → durable outcome. Lost responses remain unknown; failed outcome recording leaves the attempt pending and never repeats the remote call. The provider adapter must independently verify absence, not merely inspect database metadata. No route, application credentials or production Storage adapter is connected. Nine focused tests passed, including SQL owner/grant checks, immutable retries, metadata-presence rejection, concurrency and worker uncertainty.

## Restore suppression implementation boundary

Extend the existing disposable restore rehearsal with a versioned deletion manifest containing exact confirmed requests and targets, excluding old scrub/removal success audits. Bind it to a deployment and an independently supplied expected digest/checkpoint; a digest inside the same manifest cannot establish freshness or completeness. Persist the manifest outside the database/object backup rollback domain before enabling completed deletion.

Restore must remain externally quarantined while current migrations and deletion intent are replayed. Re-run scrubbing against restored ciphertext and verify targeted objects absent, unrelated originals decryptable, approvals unchanged and source access/recovery denied. Never replay old completion audits as proof of fresh scrubbing. Missing provenance, unresolved old uploads, manifest conflicts or an unavailable independent checkpoint must keep readiness false. Do not bypass existing triggers or invent provider completions to force readiness. Hosted ledger durability and quarantine remain operational acceptance requirements.

## Execution sequence and remaining gates

Migration 103 and `lib/records/deletion-manifest.ts` implement the first offline replay boundary. A consistent-transaction export includes confirmed requests and targets only; verification requires an independently supplied deployment, checkpoint and SHA-256 digest. Replay runs inside a caller-owned transaction and invokes a private SQL function that preserves exact identities, rejects conflicting restored rows, keeps provenance/upload guards active, and performs fresh ciphertext scrubbing. It never imports old scrub/removal success audits and always returns `ready: false`.

The full disposable database test takes a backup before source/document deletion requests, exports subsequent intent, restores the old backup, proves originals were initially available, replays intent and proves both become unavailable. It verifies raw/name/plan ciphertext removal, unrelated ciphertext and financial history preservation, exact replay, whole-transaction rollback on injected scrub failure, application-role denial, and rejection of modified/truncated/wrong-deployment/stale-checkpoint manifests. The request and restore suites passed together; TypeScript and targeted lint passed. Restored Storage metadata deliberately remains to prove replay cannot claim erasure. Independent manifest persistence, physical restored-object removal, complete readiness verification and hosted quarantine remain unfinished.

1. Finish precise dependencies and retention disclosure. Resolve source links in tax facts, merchant evidence, FX valuations/conversions, settlement/refund/credit ancestry, native/external invoice source reads, saved calculations/packs, finance/deadline plans, exports and filenames retained in snapshots. Show all archive-expanded content before confirmation. Preserve historical exclusions and approvals; do not silently recalculate or accept financial facts.
2. Add immutable requests and per-object outcomes, an exact scope/version confirmation and tombstones. Recompute the preview plus dependency versions under locks at confirmation. The owner chooses the displayed scope and explicitly acknowledges retained normalized records, audit history, downloaded files and backup treatment. No scheduled deletion.
3. Make availability tombstone-aware before enabling any removal. Current reads that directly inspect `storage.objects` include `bank_source_coverage_for_owner`, `native_bank_source_context`, `bank_valuation_economic_source`, `bank_valuation_review_stamp`, `fx_document_source`, `fx_evidence_review_stamp` and `fx_financial_stamp_addendum`. Also fence native tax-document eligibility, current snapshot capture, original-download access audits, source/document registration and recovery. Structural provenance functions must remain distinguishable from current source availability.
4. Participate in existing concurrency controls. Acquire the reconciliation owner lock and compatible table/row locks. Add tombstones to `freeze_bank_valuation_inputs`, `freeze_tax_pack_inputs` and the FX/invoice capture freeze paths, or prove an equivalent protocol. Existing paths cannot be protected solely by introducing an advisory lock they do not acquire. Confirmation must serialize against new registrations, recovery, source downloads and financial approval.
5. Commit tombstones and narrowly authorized ciphertext scrubbing before remote Storage removal. Replace only the necessary immutable-field guards with exact ciphertext-to-NULL rules backed by a confirmed request; preserve all other columns. Never disable immutable triggers broadly. A failed remote deletion leaves the source unavailable and the job retryable; completion requires verified absence and persisted per-object outcomes, not merely a successful HTTP response.
6. Preserve deletion suppression during restore. A backup restored before the deletion request must not expose recovered originals. Operational restore needs a separately retained deletion ledger and replay/suppression boundary. Active-store deletion does not erase previous downloads or external backups; do not claim otherwise.

## Acceptance gate

The offline suppression verifier now checks the restored request/target inventory against the independently expected manifest digest, requires scrub and per-object absence outcomes, and rejects remaining Storage metadata, unresolved uploads or raw/name ciphertext. It then independently rechecks every provider object. Its report establishes only `suppressionVerified`; `hostedReady` remains false because externally enforced quarantine, backup integrity and ledger durability are separate gates.

The restore integration test now connects the real private SQL removal protocol to a separate synthetic object store containing encrypted fixture bytes. Provider failure keeps verification incomplete; retry removes only confirmed objects; unrelated ciphertext and financial history remain exact. Reintroducing an object after a durable absence outcome is detected by the fresh provider check. This test uses no hosted provider or real evidence.

- Canceling a preview/request before confirmation makes no data changes.
- A stale or foreign-owner confirmation makes no deletion request or remote call.
- Shared archives/attempts cannot leave undisclosed surviving copies.
- Confirmed tombstones prevent approval, download and re-registration/recovery even while remote deletion fails.
- A concurrent approval either commits before the reviewed deletion boundary or fails on unavailable evidence; it cannot approve evidence after that boundary unnoticed.
- Retried removal is idempotent and preserves exact request identity; lost provider responses do not produce false completion.
- Every ciphertext copy in the confirmed scope is gone before completion, while normalized financial history and unrelated ciphertext remain unchanged.
- Restoring an old backup applies deletion suppression before access is enabled.

This work is not an account-erasure feature and establishes no legal retention period. No real source, document, key or financial record has been deleted.

Earlier verification for the discovery surface: both focused SQL and server-rendered page tests passed; TypeScript, targeted lint, production build and whitespace checks passed. At that checkpoint the SQL test loaded 93 migrations; availability verification now loads 94. No full regression rerun was needed for this read-only addition after the preceding reminder release gate. Logs are `/tmp/vibecount-deletion-preview-checks.log` and `/tmp/vibecount-deletion-preview-build.log`.

Combined verification through migration 98: all 807 tests passed, along with targeted lint and a clean production build. This verifies the local availability foundation, not completed deletion execution or hosted acceptance.

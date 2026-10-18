# Evidence recovery and key rotation

17 October 2026. Local M1 operational slice. Not deployed; the full handover remains active.

## What works

`/dashboard/imports/recovery` lists owner-scoped safe upload status and recovery confirmations with pagination. Failed uploads with a preserved confirmed scope can be retried after explicit figures/words read-back, reason and confirmation. Pending/uploaded operations remain unavailable for recovery because their original worker may still be running. Age alone is not evidence that a worker stopped.

Recovery approves **£0 (zero pounds)** of new income or expenses. Newly staged observations remain Unknown. A concurrent or already-existing import may be reused; its prior classification/postings remain intact. Document facts remain unverified. Recovery never restores financial approvals, sends messages, connects accounts or submits anything.

Original upload paths now retain immutable registration intent before uploading:

- CSV: confirmed mapping, parser, redacted filename, row count, date range and exact observed incoming/outgoing totals. Only known mapping fields/indices survive; no arbitrary browser JSON is stored.
- Documents: tax year, purpose and parser, plus the existing encrypted-name/object manifest.

Legacy attempts without that intent require fresh re-upload/review; no mapping, tax year or purpose is guessed. Exact original-file reimport remains idempotent. Originals, failed/duplicate attempt ciphertext and hashes remain retained.

## Cryptographic verification and recovery

The authenticated server derives owner from the session before privileged metadata access. The browser receives safe hashes, scope and status, never raw rows, encrypted name metadata, storage paths or keys.

CSV recovery downloads its original ciphertext, uses its **recorded** key ID and owner/account/hash authenticated context, checks envelope authentication, exact byte length and plaintext SHA-256, then re-parses under the preserved parser/mapping. It compares the complete reconstructed intent, re-encrypts source cells under the original file's key/context and supplies verified rows to the service-only commit. File/row identity and original ciphertext remain intact.

Document recovery verifies the root, decrypts original names under the attempt's recorded keys and re-runs bounded document/ZIP validation. Every ordinal, name, media type, size and hash must match the original manifest before restoration begins. Missing ZIP children can be reconstructed from that verified root at their original immutable paths. Existing objects are authenticated and never overwritten. An ambiguous upload response is resolved by read-back/authentication. Missing root, unavailable historic key, mismatched hash/size, altered membership or corrupt existing ciphertext blocks registration. Permission/network/server errors are never treated as permission to replace an object.

`complete_evidence_recovery` atomically checks the reviewed failed-state stamp, registers the original scope and records immutable recovery confirmation/result. It follows request → attempt → existing account/document-owner lock order. Same request replay returns its original result; changed payload reuse rejects. Distinct concurrent requests cannot register twice. The server also rechecks committed replay after a concurrent state change/lost response, before requiring keys again.

Original source/document transitions now require a matched row. Terminal attempts cannot be downgraded or retargeted. Replaying a terminal attempt returns its existing destination without appending duplicate intake events. Attempt identity/registration intent is immutable. No recovery action marks a still-pending upload failed.

## Key configuration and rotation

Legacy single-key configuration still works:

- `VIBECOUNT_SOURCE_ENCRYPTION_KEY`: canonical base64 encoding of 32 random bytes.
- `VIBECOUNT_SOURCE_KEY_ID`: recorded ID, default `v1` in legacy mode.

For rotation, configure `VIBECOUNT_SOURCE_ENCRYPTION_KEYS` as a JSON array of `{id,key}` entries and explicitly set `VIBECOUNT_SOURCE_KEY_ID` to the active entry. Example structure only, with placeholders:

```text
VIBECOUNT_SOURCE_KEY_ID=v2
VIBECOUNT_SOURCE_ENCRYPTION_KEYS=[{"id":"v1","key":"<retained canonical base64 key>"},{"id":"v2","key":"<new canonical base64 key>"}]
```

Remove the single-key variable when selecting keyring mode. Both configurations together, duplicate/invalid IDs, malformed/noncanonical keys or a missing active key reject before new ingestion. Up to 32 entries are supported. IDs permit 1–40 ASCII letters/digits/underscore/hyphen. Unknown recorded IDs fail closed; there is no fallback to today's active key.

Rotation procedure:

1. Inventory every retained key reference, including failed/duplicate attempts and names. Establish the exact prior IDs; custom legacy IDs must keep their original meaning.
2. Back up old keys independently in the approved secret manager/recovery process. Generate the new 32-byte key there; do not print keys into logs, source control or chat.
3. Deploy keyring-capable code with all old entries retained and the old active ID. Verify old synthetic/restored evidence before switching the active ID.
4. Switch the active ID to a newly assigned ID with the new key. New uploads record it; old ciphertext is not rewritten.
5. Verify old and new source files, document content and names in an isolated restore rehearsal. Keep the full keyring during application rollback; a pre-keyring application/configuration is not a safe decryption rollback after new-key uploads.

Never replace a key's bytes under an existing ID or remove a key while retained evidence references it. The application cannot reconstruct lost keys. Stable ID/key association and protected backups remain operational responsibilities; authenticated decryption detects a wrong key. No deployment key was read, generated or rotated by this work. Tests use disposable in-memory keys.

## Separate filename key provenance

Content dedupe can retain a document encrypted under `v1` while a new batch's original name was encrypted under `v2`. `document_name_keys` records each batch item's own immutable key ID and creating attempt. Do not decrypt a name with `evidence_documents.key_id` merely because it belongs to that content row.

Migration20 backfills old name keys only when the preserved intake event and exact encrypted-name match prove one creating attempt/key. Ambiguous/missing chains are left unresolved, not guessed. This adds metadata without updating immutable original items. New registrations write name-key provenance in the same transaction as batch/items/history.

Privileged metadata-only inventory (do not expose the underlying private tables to browsers):

```sql
with references_to_keys as (
  select key_id, 'source file' as source from record_source_files
  union all select key_id, 'source attempt' from source_upload_attempts
  union all select key_id, 'document content' from evidence_documents
  union all select key_id, 'document name' from document_name_keys
  union all
  select item->>'key_id', 'document attempt'
  from document_upload_attempts a
  cross join lateral jsonb_array_elements(a.planned_objects) item
)
select key_id, source, count(*)
from references_to_keys group by key_id, source order by key_id, source;

select count(*) as names_without_proven_key
from document_batch_items i
left join document_name_keys k
  on k.batch_item_id=i.id and k.user_id=i.user_id
where k.batch_item_id is null;
```

A zero usage count alone is not deletion authorization. Retention/deletion policy and complete backup inventory are separate gates.

## Schema, rollout and backup contract

`20261017200000_evidence_recovery.sql` adds attempt intent/safe projections, immutable name-key provenance, guarded terminal states and recovery confirmations. It replaces registration implementations while preserving their public signatures and existing classification/reconciliation models. Deploy this additive migration before the new upload/recovery code; old rows remain explicitly legacy. Rehearse empty and realistic upgrade paths, grants, RLS and actual Storage HTTP behavior first.

Backups must include auth owner IDs; full evidence/import/source-row/decision data; attempt plans and encrypted names; name-key links; recovery confirmations; exact ciphertext objects/paths; and an independently protected retained keyring. Account JSON export is not such a backup. Restore database, objects and key labels together into an isolated environment and verify bytes/hashes/membership before enabling writes. Do not reset financial approvals while restoring evidence.

Rollback availability by disabling recovery/new writes while retaining schema/history/objects and all needed keys. Do not drop original evidence or attempt metadata. Successful recovery confirmations are immutable. Failure before successful registration leaves no partially committed accounting/import/batch transaction. A restored missing child may remain retained if later registration fails; it was already part of the immutable original plan. Read/access failure monitoring is still an operational requirement beyond the success-confirmation history.

## Verification and fixture demo

Run `npm test` and `npm run test:ui`. Dedicated tests use `fixtures/synthetic-starling.csv` and `fixtures/document-evidence/synthetic-invoices.zip`, disposable keys, injected Storage transports and disposable PostgreSQL.

The synthetic rehearsal:

1. Persist a confirmed Starling upload, inject a registration failure and verify failed state retains ciphertext plus intent.
2. Switch the active key while retaining its old key. Verify/decrypt the original under the recorded ID; reconstruct eight Unknown observations; commit recovery once. Repeat the same request and verify identical result/no extra source or audit event.
3. Fail an invoice ZIP after its root upload. Recover missing members from the root, authenticate read-back after a lost upload response, then atomically register the complete batch. Repeat with corrupt existing member: reject without overwrite.
4. Register identical document content into a later tax-year batch under the new key. Content remains under its original key; new names decrypt under their separately recorded new key.
5. Check stale/pending/legacy/foreign-owner rejection, anonymous/direct-write denial, late-audit rollback and native concurrent same/different-request recovery. Confirm no financial record was approved by these paths.

Current automated verification: **142 tests passed**, zero failed/skipped. Both browser component suites, final lint, production build, configured tracked-file secret scan and whitespace checks pass. A temporary production-server smoke check returned 200 for login, 307 to login for recovery, and 401 for unauthenticated intake/document-manifest/identity-export access; the server was stopped. The test script bounds file concurrency at two after an unbounded local run aborted inside Node 24.0.2/V8; the isolated affected test and subsequent bounded full suite passed. Native independent-connection financial/recovery race tests remain enabled. This mitigates process pressure without claiming a runtime-engine fix.

The automated suite, component browser checks and production build establish local behavior only. Hosted Supabase/Storage and a complete real backup/object/key restore have not been exercised. Real provider formats, controlled source preview/access auditing, retention/deletion, pending-worker operational triage, document facts, remaining M2 work and M3–M6 remain unfinished.

## Coordinated restore rehearsal (current local implementation)

Run `npx tsx scripts/rehearse-evidence-restore.ts`. This script has no production target or credentials. It stages the synthetic Starling CSV and invoice ZIP through the real persistence functions and registration RPCs, uses two independent recorded keys, and confirms one synthetic business expense before backup.

It then snapshots the entire disposable PostgreSQL data directory, copies every encrypted Storage object and retains the keyring separately in memory. It closes the source database, clears the source object buffers and keys, and creates a new database from the snapshot. A digest over all public/auth/storage table data must match before and after restore. The verifier reads every restored registered original, source-row ciphertext and encrypted document name, checks its recorded key/context/hash, and checks complete object and name-key inventories. Owner isolation and private-column denial are exercised again on the restored database. Verification must leave the database digest unchanged and preserve the existing approved financial record.

The rehearsal rejects a missing ciphertext object, corrupted ciphertext and a missing historical key even when the current active key is available. Its safe report is written to `/tmp/vibecount-evidence-restore/report.json`; plaintext, ciphertext, filenames and key material are not exported in the report. No financial approvals are reset or replayed during restore.

Current local result: 90 migrations, 103 restored tables, four encrypted originals, eight encrypted source rows, three encrypted names and two retained keys verified. TypeScript and focused lint pass. The database snapshot includes schema/roles; the data digest itself measures table contents, while the explicit role checks exercise restored authorization behavior.

This proves a consistent **synthetic local** database/object/key restore. It does not test Supabase backup/PITR, hosted object versioning, concurrent production writes, pending partial uploads, provider availability or production key custody. A real rehearsal must establish a consistent backup boundary across those systems, restore into a designated isolated environment and run the same checks before writes are enabled. Pending/failed-upload recovery remains covered separately by the recovery tests above. No hosted backup or restore was performed.

## Retention decision

The owner selected **explicit user requests only** for evidence deletion. Do not schedule automatic deletion after a retention interval. The deletion workflow is still to be implemented: it must preview source dependencies, preserve auditable exclusions and financial decision history, and coordinate database/key/object availability so a partly deleted source cannot remain eligible for financial approval. This decision does not authorize deleting existing evidence during engineering work.

The read-only [deletion impact preview and execution plan](evidence-deletion-plan.md) now enumerate duplicate statement copies, shared ZIP closure, encrypted row/name copies and direct dependencies. No deletion confirmation or worker is enabled yet.

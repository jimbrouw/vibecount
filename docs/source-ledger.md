# Source ledger: implementation and deployment notes

Subsequent implementation: [evidence-recovery.md](evidence-recovery.md) supersedes the single-key/recovery limitations below; [reviewed-duplicates.md](reviewed-duplicates.md) adds explicit overlap verdicts. Hosted deployment remains unverified.

The first evidence-backed CSV slice lives at `/dashboard/imports`. It uses the existing Supabase Auth/Postgres/Storage infrastructure. Account entries are labels for uploaded files; they do not connect financial accounts.

## Deploy order and configuration

Apply the complete reviewed migration chain through `20261017200000_evidence_recovery.sql` to a rehearsed database before deploying the current import path. The ledger originated in migrations `100000`/`110000`; current code also depends on later reconciliation, identity and recovery additions. No production migration has been applied by this work. Review linked migration state and take a tested backup first; the existing account JSON export is explicitly partial.

Server-side configuration:

- Existing Supabase URL, anon key and service-role key.
- `VIBECOUNT_SOURCE_ENCRYPTION_KEY`: a cryptographically random 32-byte key encoded as canonical base64. Store it in the deployment secret manager, not source control or a public environment variable.
- `VIBECOUNT_SOURCE_KEY_ID`: a short identifier, default `v1`, recorded with each source. Keep the corresponding encryption key available for retained files. Do not replace an existing key under the same ID. For retained-key rotation use `VIBECOUNT_SOURCE_ENCRYPTION_KEYS` and the procedure in [evidence-recovery.md](evidence-recovery.md); originals are not re-encrypted. Real backup/restore and production rotation remain operational gates.

If encryption or privileged storage is unavailable, ingestion fails before recording transactions. No plaintext fallback exists. No deployment key value was generated, read from the existing environment, or published during implementation. Automated tests generate disposable in-memory fixture keys.

## Data flow and invariants

1. The authenticated server verifies that the chosen account label belongs to the user.
2. The selected UTF-8 CSV is parsed strictly on both client preview and server. The user confirms mapping, date format, GBP currency and sign convention. Maximum 1 MB / 5,000 rows. Unsupported currencies, ambiguous amounts and invalid dates hard-stop.
3. Exact uploaded bytes are hashed with SHA-256 and encrypted with AES-256-GCM and a fresh nonce. Authenticated context binds owner, account and file hash. Original row cells are separately encrypted with row number in their context; row hashes refer to the original cell-array JSON, while the file hash covers the original byte stream including headers/newlines.
4. Ciphertext is uploaded without overwrite to the private `source-evidence` bucket. The repository defines no authenticated object policy for that bucket. Only privileged server code writes it. Ordinary users can read safe row metadata but cannot select encrypted raw cells or source object metadata.
5. A server-only RPC records the immutable file/import/source rows and signed bank observations atomically. Account-level advisory locking serializes both identical and overlapping imports. Failed/pending upload attempts and retained ciphertext are recoverable; they never create partial financial postings. Duplicate uploads remain in the attempt audit and currently retain their separate encrypted object copies.
6. Exact same-account/file-hash reimports reuse the original import and add zero transactions. Weak fingerprints only flag possible overlaps; two identical purchases inside one file remain distinct. Reliable cross-file provider IDs and reviewed overlap resolution remain M2 work.
7. Importing creates no `financial_records`. A separate, version-checked human classification procedure creates or updates the one recognised record for a transaction, together with immutable decision history and the existing financial-record audit. Unknown/Personal/Transfer/Refund do not create income/expense postings; Refund remains unresolved until reconciliation links it. Mixed expenses use exact basis-point apportionment with penny rounding. Business treatment remains provisional for tax eligibility.
8. Reversal locks the import and its transactions, checks a digest of the reviewed decision versions, excludes recognised effects and appends decisions/events. Evidence is never deleted. Reimport does not reopen or reapprove a reversed import. Reopening only permits fresh review.
9. Draft ledger and decision exports include excluded/unresolved rows, source hashes/row numbers, decision versions, author/time and recognised-record references. CSV formula protection is applied to presentation fields; plain signed numeric amounts remain numeric. These exports are current views, not immutable filing snapshots.

Review pages receive normalized descriptions/references with UK bank identifiers redacted. Raw sources and encryption material are not rendered or passed to AI. PostHog autocapture, session recording and page-leave capture are disabled; new import flows emit no manual analytics events.

## Anonymised demonstration

`fixtures/synthetic-starling.csv` is a synthetic format fixture, not a verified export from Starling or a record of the user's finances.

1. Add a Starling account label with a four-character mask; select the fixture.
2. Confirm Date / Counter Party / Amount (GBP) mapping. Balance is not the transaction amount. Keep `DD/MM/YYYY` and positive-in/negative-out direction.
3. Import twice. The second attempt opens the existing import with no new transactions.
4. Classify the receipt as Business with an income category. Classify the repair as Mixed at 30%, with an expense category and rationale: the read-back is £189.09. This is a candidate business amount pending vehicle-method and tax-eligibility review, not a confirmed tax deduction.
5. Classify the holiday as Personal. It remains in the export with zero recognised amount. The two same-value software purchases remain separate observations.
6. Export the evidence-linked ledger, decision history and draft JSON evidence manifest. Recompute included amounts from the original signed pence, percentages and approved/excluded status. The manifest explains file/row hash inputs and includes a reproducible digest of its own exported snapshot; it omits raw cells, descriptions/references, object paths and keys. A digest detects changes, not authorship. These are current views, not locked filing packs.
7. Open the selected import totals, reverse with a reason and explicit confirmation, and verify zero financial effects. Reopen for review; it must not automatically restore the amounts.

## Verification

- Unit tests cover strict CSV formats/sign/currency/date validation, redaction, exact percentages, encryption round-trip/tamper/context rejection and source-linked exports.
- Embedded PostgreSQL tests replay all migrations under Supabase-style default table privileges and verify RLS, immutable sources, privilege boundaries, rollback, reversal and preservation of excluded decisions.
- Native PostgreSQL tests start a disposable local cluster, use independent connections, observe lock waiting and verify simultaneous overlapping imports, identical-file retries and approval uniqueness. The cluster is stopped and removed afterward; it never connects to production.
- `npm run test:ui` runs real browser component checks with synthetic files and inert actions: preview mapping, superseded file-read protection, confirmation resets, exact mixed-use read-back and personal exclusion. It does not impersonate authenticated Supabase end-to-end testing.

Remaining release checks: real Supabase Storage upload/policy verification, authenticated browser-to-storage-to-database rehearsal, an anonymised real bank export for each adapter, operational key backup/recovery and retention/deletion policy. The ingestion database tests use a Storage metadata shim, not the Storage HTTP service. Invoice ZIP/PDF/image/employment evidence preservation is now implemented separately: see [document-evidence.md](document-evidence.md) and its additional migration. Complete source previews, document-fact extraction/review, provider-ID reconciliation and filing functionality remain outstanding.

## Subsequent signed refund support

Reviewed cash refund relationships, signed source/report effects and cross-import group reversal now exist locally; see `reviewed-refunds.md`. Earlier statements that refund accounting is entirely unresolved are superseded. Refund tax eligibility, invoice credit/correction treatment and complete exception handling remain review work.

## Merchant review provenance

Migration `20261017210000_merchant_memory.sql` follows evidence recovery and adds reviewed merchant memory/application history. Import decision CSVs append exact-version merchant batch/rule/origin/evidence/reversal metadata through an owner-scoped invoker view; the original classification evidence column is not rewritten. See [merchant-memory.md](merchant-memory.md).

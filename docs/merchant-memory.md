# Reviewed merchant memory and material exceptions

Local M3 slice, 17 October 2026. No production migration, financial approval, message, bank connection or deployment was performed.

This records the original M3 checkpoint. The later [reviewed annual rollover](merchant-rollover.md) adds separate year-scoped families and immutable ancestry; current merchant-history JSON uses schema `merchant-memory/2`. Latest verification and remaining scope are in [implementation-progress.md](implementation-progress.md).

## Workflow

Open `/dashboard/review/memory`, select a UK tax year, and review the material exception queue. Imports also link each source observation to merchant review. The default year is the last completed tax year; 2025/26 is a fixture scenario, not a production constant.

Memory uses exact normalized descriptions: lowercase, trim and collapse whitespace, version `description-exact/1`. It separates incoming and outgoing transactions. Masked/redacted descriptions can group unrelated payees: this is a suggestion key, never evidence of identity or tax eligibility. There is no fuzzy/AI classification or automatic approval.

A rule revision records its author, reason, category meaning, seed source, account/year scope, inclusive transaction-date effective range, priority, evidence state and enabled/disabled status. Higher priority wins; then the number of explicit account/year restrictions. Equal top ranks require manual choice. Revision history is immutable. A changed category invalidates its saved suggestion until revised. Saving or disabling a rule creates zero postings and does not change existing decisions. Historic rules remain applicable to historic transaction dates even after those dates have passed.

The queue surfaces Unknown, unresolved identity and unresolved Transfer/Refund observations. Financial materiality is the maximum of the individual gross amount, observed gross merchant amount, and an annual amount scenario. Confidence is only a triage heuristic: one unambiguous rule scores 95, competing rules 40, no rule 0. An unfamiliar £700 hardware payment remains prominent even at score 0. Known Personal decisions are not put back in the queue; an explicitly selected source can be reviewed with an override.

Recurring scenarios use median daily gross amount × tax-year days ÷ median interval between observed dates, rounded half-up to pence. The median interval must be at least seven days. Same-day repetitions alone do not imply recurrence. Partial statements, personal transactions and irregular purchases can distort this scenario; it is not a deduction or a liability calculation. No transaction's business-use percentage is inferred from the score.

## Approval and undo

Select up to 50 explicit rows and review every source, category, percentage and evidence status. Manual review supports Business, Personal and Mixed. Mixed is expense-only with an explicit exact percentage above 0% and below 100%, and a rationale. Unknown stays unresolved; Transfer/Refund suggestions direct users to relationship review. No independent transfer/refund posting is created by remembering a label.

The read-back shows each current and proposed recognised effect in figures and words, plus before/after income and expense totals. A row not selected is never implicitly expanded into the batch. Known treatment requires an explicit override. A common reason must explain all selected decisions. Linked evidence requires at least one owned preserved document; an attachment does not certify its contents. The document chooser pages safe IDs/hashes and supports up to ten links per row. Original filenames, storage paths, keys and raw bank/PAYE files are not exposed.

Confirmation clears after input changes or refreshed props. Selected IDs/versions, immutable rule revision, request ID and owner-wide stamp are sent to one database transaction. Success returns to the same reviewed tax year and advances to the remaining unresolved queue. Every public classifier dependency guard still runs. Undo rejects changed versions, discarded sources or dependent financial relationships; it leaves the whole batch Unknown with zero recognised effects. It never restores earlier approvals. Repeating the same request returns the original result; changing its payload rejects reuse.

## Migration and provenance

Apply existing migrations through `20261017200000_evidence_recovery.sql` first, then `20261017210000_merchant_memory.sql` in a disposable rehearsal before any rollout. The latter adds immutable rule families/versions, requests, batches/items, evidence links, reversals and undo items. It does not backfill merchant rules or change existing accounting approvals. New history references exact `(transaction_id, decision_version, owner)` classifications. Existing `classification_decisions.evidence_status` remains immutable; the invoker view `merchant_decision_provenance` joins additional evidence and memory provenance to that exact version.

All rule/application mutations take the existing owner reconciliation lock. Batches then lock source transactions in ID order. Rule saves and approvals lock owned/shared category rows in ID order **before** checking the review stamp, preventing a concurrent rename from silently changing reviewed meaning. Rule updates, manual classification, identity review and relationship operations therefore invalidate stale approvals. Category snapshots preserve historical meaning; current-category checks protect new uses.

RLS exposes only owner history; direct client writes are revoked. Public approval RPCs call `review_bank_transaction`, including transfer, refund and allocation guards; they do not bypass those guards using older versioned implementation functions. Failed validation rolls back all postings, classification decisions, evidence links and batch audit together.

`/api/review/memory/export` returns complete owner-scoped draft JSON with immutable rule/application/evidence/reversal history and a reproducible snapshot SHA-256. Nested category/source/document fields are explicitly allowlisted. Source snapshots retain original file/row hashes, dates, account masks and decision versions without raw cells or ciphertext coordinates. Existing import decision CSV columns retain their order and append batch/rule/origin/evidence/reversal metadata. Exports page to an empty page, reject changed financial stamps and fail if export audit insertion fails. These exports are current evidence views, not locked M5 filing packs, authenticity signatures or complete backups.

If a deployment must be rolled back, disable the new UI/actions and retain all history and sources. Do not drop tables, delete application decisions or silently restore approvals. Once applied to a shared environment, repairs need a forward migration rather than editing applied SQL. This migration is currently local/unapplied; its development fixes are within the same file.

## Synthetic demo and verification

Use the synthetic fixture paths/tests; never enter the handover's real personal data to run this demo:

1. Import a GBP CSV with repeated `Squarespace` observations, an unfamiliar £700 outflow and a £630.29 repair.
2. Save a scoped Business suggestion from a Squarespace observation. Verify saving creates no posting. Review and approve only one selected transaction; the other remains Unknown.
3. Give the repair an explicit 30% Mixed expense decision with a rationale. Read-back and recognised effect must be £189.09. Keep the vehicle method/tax eligibility provisional for M4 review.
4. Explicitly classify a personal lodging source Personal. Memory does not change it without selecting an override.
5. Try equal-priority overlapping rules, stale source versions, renamed categories, foreign evidence and allocated receipts. Approval must reject and leave the whole batch unchanged.
6. Undo an eligible batch. All of its rows become Unknown, zero effects remain, and original decisions and evidence hashes remain in history/exports.

Current verification: **155 tests passed**, zero failed/skipped; both browser suites, lint and the Next 16.4.2 production build passed. The configured tracked-file secret scan and whitespace checks passed. Unauthenticated production-server checks returned 307 to login for review, 401 for history/import decision exports and 200 for login; the temporary server was stopped. Build and smoke use public build-only Supabase placeholders; they do not prove hosted authentication or storage.

Verification covers actual SQL ownership/retries/scopes/rounding/provenance/rollback/dependencies, native independent-connection category/rule/classification races, selected-row and materiality domain checks, safe paged export failures, action authentication/gates, and browser confirmation/reset/read-back behavior. The source ledger/relationship suites continue to replay this migration.

## Remaining scope

Hosted Supabase/PostgREST/Storage and authenticated end-to-end behavior, database/object/key restore, governed retention/deletion and controlled evidence preview remain release work. Documents remain opaque until a separate fact-review workflow accepts their contents. Memory is not a tax-eligibility engine: vehicle method, donations, commuting, capital treatment and other tax questions remain M4 facts/rules. The full guided historic scenario, verified annual forms, immutable filing packs and Finance OS are unfinished. M2 still needs match proposals, split refunds/FX policy, comprehensive exceptions, fresh credit communication review and durable delivery recovery.

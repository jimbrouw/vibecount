# Reviewed cash refunds and signed accounting effects

Local implementation, 17 October 2026. Migration `20261017160000_reviewed_refunds.sql`; review at `/dashboard/reconciliation/refunds`. No production migration or real financial action was performed.

Current follow-up: [split-refunds.md](split-refunds.md) documents the pure split calculation, authenticated graph reader and complete connected reversal review (`18050000`/`18060000`). The refund page now links to that complete review rather than the original group form. One-original approval below remains active; split approval is still unfinished. The older group API preserves exact retries but rejects fresh requests involving unseen sibling originals.

## Model and behavior

`financial_records.amount` stays a nonnegative exact magnitude. New `effect_sign` defaults to +1; reviewed refund postings use -1 with an owned `refund_link_id`. Income/expense classification comes from the original posting, not the direction of refund cash. A supplier refund reduces expenses; a customer refund reduces income. The original payment, source date, posting and prior-year totals are preserved. The refund's own observed date determines its accounting record year/quarter; tax eligibility/basis adjustments remain for the reviewed tax engine.

`refund_links` snapshots original/refund source IDs, original decision, recognised amount, bucket, category, business-use percentage, author, reason and request. `refund_reversals` and `refund_requests` are immutable. Both transactions retain their source file/row provenance. Several refund observations may refer to one original; a refund observation has one active original link. A single observation covering several distinct originals remains an exception for future split-allocation work.

Approval requires owned, opposite-sign GBP observations; clear duplicate state; active imports; original approved Business/Mixed classification and positive accounting effect; consistent original business apportionment/category; available original gross and business capacity; no active transfers or refund-of-refund. A refund observation already allocated to an invoice must have that allocation reversed first. Previously misclassified refund income/expense is excluded before publishing the definitive negative effect, reusing its canonical record rather than duplicating it.

Refunds inherit the original category, business-use percentage and project when present. Business classification is still provisional tax treatment. An invoice-allocated original receipt can have a customer refund, but invoice settlement history stays intact and an explicit credit-note/correction exception is shown. That unresolved exception must be carried into future wizard/filing completeness checks. A cash refund alone does not establish an invoice credit note or a new outstanding amount.

## Partial refunds and penny rounding

For an original with gross G and business percentage B, each reduction is:

`round((prior active gross refunds + new refund) × B) − prior active recognised reductions`

Use integer/numeric arithmetic with half pennies rounded up. Gross refunds cannot exceed G, and business reductions cannot exceed the original recognised amount. Thus £630.29 at 30% has £189.09 recognised; refunds of £100 and £530.29 reduce expenses by £30 and £159.09 exactly. For a two-penny original at 50%, two one-penny refunds reduce by one penny and zero pennies. The zero-penny link remains auditable without creating a new approved zero-value posting.

To retain this cumulative invariant, reversal removes the complete connected set of active original/refund relationships. The current review lists every affected source, refund cash counted once, per-link portions and the whole signed effect before confirmation. It resets each refund observation to Unknown once without restoring any prior misclassification; originals remain approved. Desired links can then be reviewed again. Individual out-of-order reversal and automatic recalculation of other immutable links are intentionally unavailable.

Import reversal closes every affected original-payment refund group, including related refunds from other imports. If the original is outside the selected import it stays approved; external refund observations become Unknown. The selected import is then excluded. Reopening restores neither approvals nor links. Summary stamps/read-back include the complete cross-import group scope, gross cash and income/expense reductions.

## Safety and concurrency

Approval, group reversal, ordinary classification, transfer pairing, allocation and import reversal use the same owner reconciliation advisory lock before row locks. Source rows lock in deterministic ID order. Exact review versions and refund-family stamps reject stale state. Request IDs bind unchanged retries; changed payloads reject. Public wrappers prevent active refund sources from being reclassified or paired, and refund observations cannot masquerade as invoice receipts. Internal older RPC versions remain execution-revoked.

Owner RLS/composite FKs apply to both sources. Direct writes to relationship/history tables and arbitrary negative accounting effects are denied to ordinary roles. The canonical source-record FK prevents deletion of linked postings. Server actions authenticate, validate IDs/versions/stamp/reason and require explicit confirmation. Form reason or snapshot changes clear approval. Original files/raw cells remain in restricted evidence storage, not these review surfaces.

The normal classifier explicitly resets effect sign, bucket and refund provenance when a formerly refunded observation is subsequently re-reviewed as ordinary Business/Mixed. It also clears inherited refund project tagging. Excluded history remains in the audit trail.

## Reporting and exports

All inspected nonparked financial consumers apply signed effects: quarter summaries, record displays, Self Assessment totals/category hints, tax-prep reads/exports, project approved totals, source import summaries/CSV/manifests, reconciliation export and record-review summaries. Project reads are paginated, ignore review-state records in approved totals and fail closed on read errors. Record-summary failures do not display zero totals. Refund rows are excluded from legacy ordinary category suggestions.

- Record CSV `amount` and JSON `amount` are signed recognised amounts; `amount_magnitude`/`amountMagnitude`, `effect_sign`/`effectSign` and refund link preserve explicit semantics. JSON also carries exact integer `recognizedPence` as a string.
- Source CSV `recognized_pence` is signed and grouped by posting bucket; cash remains separately signed in `signed_amount_pence`. Manifest includes bucket, sign, signed pence and active/refund-record links. Negative expense totals for a later-year refund are possible and must not be recast as income.
- Reconciliation CSV appends refund event/provenance columns. Each event links both file/row chains and original/refund dates, category bucket and business-use share. Refund events have negative recognised effect; reversal events have the opposite effect. Relationship rows are audit events, not extra records to add to a recognised-record export.
- Source, record, tax-prep and reconciliation exports check a financial state digest around paginated reads and reject intervening mutations. The digest includes invoice, transaction, import, recognised-record, settlement, transfer and refund state. These remain current draft exports, not locked M5 filing packs.

Parked Phase 4 was not extended. Its raw list-expenses output does not expose the new sign and must remain unavailable for Finance OS release until a separately approved compatibility review. Its summary view inherits signed SQL totals.

## Migration, rollout and recovery

Rehearse all migrations through 160000 on disposable/staging Supabase and representative legacy rows. Deploy signed consumers and refund RPC/UI as a coordinated change; older consumers assume positive amounts and would misreport negative effects. Preserve legacy positive records as +1 without inventing relationships. Review default privileges, actual HTTP role behavior, views/PostgREST relationship embedding, Storage policies and authenticated end-to-end source review before real-data rollout.

Rollback must disable new refund approvals while retaining signed-aware reads/history. Do not restore unsigned summaries while approved negative effects exist. Use reviewed reversal or roll forward; never rewrite original amounts or delete evidence to hide a correction. Existing source recovery, key rotation/retention, backup restoration and release-base isolation remain operational requirements.

## Synthetic demo and evidence

Fixtures: `fixtures/synthetic-refund-originals.csv` and `synthetic-refund-following-year.csv`. These are deliberately synthetic generic CSV examples, not verified bank adapter formats.

1. Import originals dated 5 April 2026. Review the £630.29 repair at 30% and £1,500 freelance receipt at 100%.
2. Import the 6/7 April refunds. Link £100 and £530.29 to the repair; verify reductions £30/£159.09 in 2026/27 with the 2025/26 original unchanged.
3. Link the £500 customer refund to the receipt; verify reduced income, no new expense, and separate invoice correction warning where allocated.
4. Export records, source ledger/manifest and reconciliation; independently sum signed postings and trace both source chains.
5. Reverse a group or one supporting import; review all affected links and verify Unknown counterparts, preserved original and immutable reversal history. Reopening restores nothing.

Tests: `lib/database/refunds.test.ts`, native independent-connection races, `lib/records/refunds.test.ts`, server-action contract tests and browser confirmation/read-back checks. They prove accounting invariants with disposable/shim databases and inert browser transports; actual Supabase Storage/API/browser deployment is not established. Latest complete local verification is recorded in `implementation-progress.md`.

Remaining M2 scope includes credit notes and settled-invoice corrections, FX, splitting a single refund across originals, automatic proposals, overlapping-statement resolution and the material exception queue. Tax rules/PAYE/pensions, merchant memory, guided review and all seven locked draft pack outputs remain future milestones. This slice does not complete M2 or the handover.

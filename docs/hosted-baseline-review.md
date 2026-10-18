# Hosted baseline review

Read-only inspection on 18 October 2026 found the existing Supabase project `Vibecount` active, with 28 recorded migrations and no development branches. Twenty-four version/name pairs match early local migration filenames. Four October 14 receipt migrations are absent from `supabase/migrations`; their exact statement text is captured in `fixtures/hosted-baseline` for local rehearsal.

Hosted `financial_records` already has receipt-specific dates, merchant, currency, gross/VAT pence, business-use allocation, payment status, refund kind and original-refund linkage. The recorded receipt migrations also add attachment extraction/review metadata, a receipt confirmation RPC, and a reporting view that excludes unpaid receipts and reverses refund amounts. These are real existing capabilities that were not represented by the prior clean local schema tests.

The hosted settings schema lacks the local July tax-pot/interest columns. None of the October 17–20 vNext migrations appeared in hosted migration history. No customer records, original documents, keys or secret settings were read during this inspection.

## Local rehearsal and remaining gates

`scripts/rehearse-hosted-upgrade.ts` loads the common local predecessors, captured receipt migrations and remaining local migrations into disposable PGlite. It tests schema application and preservation of synthetic paid/unpaid/refund receipt fields. The result is written to `/tmp/vibecount-hosted-upgrade/report.json`. Passing this rehearsal does not prove tax/reporting treatment for legacy receipts or unrecorded hosted schema changes.

Before hosted acceptance:

1. Reconcile the four missing migration files with canonical history and compare the common baseline definitions, rather than repairing migration metadata by assumption.
2. Verify receipt payment/refund semantics across current reporting, review, tax and exports. Existing unpaid receipts must not become cash-basis deductions; refund signs must remain correct.
3. Select a non-production database and Vercel environment for the signed-in journey. The existing Supabase project has no development branch; no new resource was provisioned.
4. Rehearse database/object/key recovery and independent deletion-ledger storage before enabling deletion.

Vercel project metadata identifies project `vibecount`, `prj_XjqoAX8mMF1G589I6Tgu7qnVzvRR`, team `team_TJVsgtI8g34IU0BLDze0EbOE`. The connector returned HTTP 403 for that team. The same-scoped CLI fallback had no credentials and entered a device login flow; it was interrupted without completing login. Deployment state remains unverified. CLI version 57.0.0 was observed; upgrade to the current CLI before release operations.

No hosted migration, deployment, provider send, financial approval or evidence deletion was performed.

## Confirmed reporting regression and local correction

The upgraded quarterly view initially reported £35 for synthetic receipts consisting of a £10 paid cost, £20 unpaid cost and £5 paid refund. The correct cash total is £5. Migration 104 introduces a shared cash-effect helper and updates the quarter summary plus the hosted reporting view when present. Unpaid/non-GBP/unapproved rows are excluded; legacy refund metadata and native negative effects produce one negative effect without double negation. Existing view column order, grants, RLS and receipt fields remain intact. Installations without the receipt columns retain their native behavior.

The 108-migration combined rehearsal now passes with three synthetic receipts preserved, correct totals/counts, native refund sign checks and other-owner isolation. It is included in `npm test` through `lib/database/hosted-receipt-upgrade.test.ts`; six existing native refund/projection checks also passed. This fixes these two reporting views only. Direct record consumers, tax/finance snapshots and receipt confirmation integration still need compatibility checks before release. No hosted view was changed.

## Current operational review compatibility

Migration `20261020170000_receipt_operational_review.sql` corrects the current
financial review and service quarterly capture to use the shared cash-effect
projection. The retained V1 catalog is unchanged. Approved counts retain unpaid
receipt evidence; recent samples show zero current cash effect with an explicit
unpaid/unsupported-currency label. Receipt payment, currency and refund fields
are included in the current review stamp, without exposing merchant text.

The synthetic hosted upgrade now runs 109 migrations (105 local plus four
captured hosted predecessors). It reproduces the £35 operational expense defect
before this migration, then verifies £5 after it: £10 paid less a £5 refund,
excluding £20 unpaid. It checks the parsed current review, all three visible
records, saved quarterly net profit of -£5, private helper access denial,
unchanged original receipt columns, unchanged V1 output and owner isolation.
Operational coverage/route tests passed (16 tests); the final hosted rehearsal
and parser checks passed (7 tests, overlapping the former run), with TypeScript,
focused lint and whitespace checks clean. These are local synthetic checks;
no hosted migration was applied.

### Remaining receipt compatibility integration

The direct tax input core and source snapshot/currentness checks still omit
receipt payment/currency/refund dimensions. A new current input contract must
carry those dimensions while retaining historical snapshot replay; existing
receipt sources without that provenance require re-review or blocking. Do not
silently rewrite original approved amounts/statuses to make the engine fit.
The tax-prep checklist/export, project expense totals, records export and recent
records display also still consume raw amount/effect_sign. Move these live
consumers to the common cash projection and verify the same hosted fixture
through each output. Hosted receipt amounts already include business-use
allocation: never apply the percentage twice. Finance plan arithmetic uses
reviewed balance/obligation inputs and does not need an unrelated arithmetic
change for this defect.

## Receipt tax-source freshness

Migration 106 (`20261020180000_receipt_tax_source_provenance.sql`) records an
allowlisted receipt-dimensions object during new explicit tax fact reviews:
currency, payment status, expense/refund kind, payment/document dates and refund
reference. Native records with no receipt cash semantics keep a null dimension
object. Merchant text and raw documents are not copied.

Current source status and current calculation-input sources now use the common
cash effect and compare those dimensions. Existing receipt snapshots lacking
them require explicit re-review; changing only payment status invalidates the
new review. Historical fact snapshots and withdrawal/retry behavior stay intact.
The evidence-target availability fence remains in the current source view.

The 110-migration synthetic hosted rehearsal verifies old-source blocking,
explicit re-review, zero recognized cash for unpaid evidence, a payment-only
change producing 2,000 pence and invalidating review, unchanged old snapshots,
and other-owner isolation. Tax fact tests plus the rehearsal passed (11 tests);
tax calculation capture, bank accounting and evidence approval regression tests
also passed (11 tests). TypeScript and focused lint passed.

This closes source freshness only. The calculation's record totals still need
a receipt-aware current input version and engine handling, with historical
calculation replay preserved. Live tax-prep/project/record export readers also
remain on the receipt compatibility worklist above. No hosted changes applied.

## Receipt-aware calculation and draft pack

Migration 107 (`20261020190000_receipt_tax_calculation_input.sql`) emits
`tax-calculation-input/5` when records have receipt cash semantics; native-only
inputs retain V4. V5 includes safe receipt dimensions without changing original
amounts, signs or statuses. The deterministic engine excludes unpaid/non-GBP
receipts from GBP cash candidates and recognizes refunds negatively once.
Unsupported receipt currencies continue to block derived tax figures. Correct
cash arithmetic does not remove existing eligibility/provenance review gates.

Current saved V5 calculations are recomputed during integrity verification using
their stored rules. Database capture independently compares V5 income/expense
candidates with frozen approved evidence. Filing input V6 accepts V5 calculations,
and the normalized draft ledger uses the same cash effects while preserving
original record dimensions. Earlier calculation/filing contracts retain their
original interpretation and bytes.

The 111-migration synthetic hosted rehearsal now verifies database input →
calculation → service capture → saved verification → filing review → seven draft
artifacts. The £10 paid / £20 unpaid / £5 refund fixture produces £5 in both
calculation and exported ledger. A supplied £35 candidate is rejected by capture;
unit tests reject recomputed-hash result tampering. All 27 focused tests passed,
covering calculation, receipt boundaries, bank accounting, filing effects and
historical pack replay. TypeScript and focused lint passed. No hosted migration
was applied. Remaining direct readers are the legacy tax-prep checklist/export,
project expense totals and standalone records display/export.

## Remaining live receipt readers aligned

Migration 108 (`20261020200000_record_cash_computed_fields.sql`) adds
`cash_effect_pence(financial_records)` and `cash_treatment(financial_records)`.
These [PostgREST computed fields](https://docs.postgrest.org/en/latest/references/api/computed_fields.html)
keep the existing table, RLS and embedded category/attachment relationships.
The helpers consume the common cash projection and use JSON access for optional
hosted receipt columns; no stored amounts or approval states are rewritten.

Records display, project totals, standalone records JSON/CSV, and the legacy
tax-prep checklist/export now request those fields. Excluded evidence stays
visible with an explicit reason; original magnitude/sign remain separate from
recognized cash. Checklist counts exclude non-cash rows and explain the excluded
count. Native historical values without the new projection retain their signed
contract; contradictory projected amounts/treatments are rejected.

The 112-migration synthetic hosted fixture verifies computed-field execution as
an authenticated owner, other-owner isolation, and £5 through live accounting
and checklist consumers. Endpoint tests exercise the actual records JSON/CSV
and tax-prep routes with inert DB responses, including requested field selection,
retained £20 unpaid magnitude, zero cash effect and negative £5 refund.

Full regression: 838 tests passed in 198 seconds. Production build, TypeScript
and focused lint passed. After that run, a narrow original-amount label safeguard
and validation of excluded checklist rows were added; final focused route,
projection and pagination tests plus TypeScript/lint passed. Hosted PostgREST
schema-cache/HTTP acceptance remains unproven until migration deployment to the
designated test environment. No hosted changes were made.

## Existing receipt confirmation and refund integrity

The captured receipt confirmation RPC was exercised after upgrade, using only
synthetic authenticated requests. It preserves exact retry identity, applies
£630.29 × 30% once to produce £189.09, recognizes receipt refunds negatively,
and enriches an existing manual expense without creating another cost. Missing
amount confirmation and another owner's attachment are rejected.

The test reproduced an existing integrity defect: an original expense could be
reduced below its already-approved refunds, or marked unpaid while those refunds
remained approved. Migration 109 (`20261020210000_receipt_refund_integrity.sql`)
adds a hosted-schema-only database guard. Approved receipt refunds lock their
owned original and check the aggregate allocation. Originals with approved
refunds cannot be reduced below that total, excluded, changed into refunds or
marked unpaid. Explicitly excluding the refund permits a later original
correction. Native bank refund guards remain in place.

Upgrade preflight rejects pre-existing inconsistent receipt refund families for
explicit review; it does not rewrite financial records. The synthetic rehearsal
proves that rejection and rollback, then upgrades the valid baseline. It now
applies 113 migrations. Native PostgreSQL independent connections verify actual
lock waits for five races: competing refunds, plus shrinking/unpaying the
original against refund approval in both orders. Final hosted confirmation and
native concurrency tests passed; native refund regression, TypeScript and lint
also passed. The prior 838-test run predates migration 109; focused checks cover
this addition. Hosted deployment remains unperformed.

Receipt matching against canonical bank-linked postings is still contained by
the existing reviewed-classification guard. The legacy receipt RPC cannot be
used to override those posting amounts. A compatible enrichment-only user flow
and its hosted acceptance remain separate from the proven manual-match path.

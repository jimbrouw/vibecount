# Reviewed tax-year facts and provenance

Local M4 foundation, 17 October 2026. This does not complete the tax rules engine, filing pack, production rollout or Finance OS. No real financial fact was approved, migration deployed, return submitted or account connected.

## What is available

`/dashboard/tax-prep/facts` provides an explicit owner/year profile and typed facts for employment, termination payments, pension contributions, other income, actual tax-payment allocations, vehicle elections, Gift Aid and trading adjustments. The default is the last completed UK tax year; historic amounts are only synthetic test fixtures. Every revision reads back values in figures and words, selected sources, year, status and zero new trading postings. The input UI uses ordinary labelled controls, stable selectors and confirmation reset on edits/refreshed props.

The tax-prep checklist now links here and withholds the old profit-only liability/NI/POA figures. Its ledger subtotals and draft checklist exports remain preparation aids. `tax-estimate.ts` is a deprecated unused legacy helper, not a versioned tax engine. No replacement liability is invented from missing facts.

## Data and review contract

Migration `20261017220000_reviewed_tax_facts.sql` follows merchant memory. It adds owner/year profile families and revisions, fact families and revisions, source links, completeness attestations and idempotency requests. Profile schema `tax-profile/1` and fact schema `tax-facts/1` are explicit. Profiles/facts/sources/attestations are immutable; current views select the latest revision. No guessed backfill or existing ledger rewrite occurs.

Profiles explicitly capture jurisdiction, accounting basis, structure, VAT, loan plan, residence, special circumstances and ledger completeness. Unknown/unreviewed answers can be retained provisionally; they cannot become a reviewed profile. Reviewed answers do not mean every profile is supported by a calculator. A profile stores the financial digest it reviewed: subsequent financial changes make its ledger-completeness answer stale.

Fact states are Provisional, Verified, Excluded and Withdrawn. Verified means the person checked the typed values against selected evidence, not accountant certification. Source/type/timing requirements are validated independently by TypeScript and SQL. Missing required values reject; optional unknown NI-band earnings/mileage remain null; an explicit reviewed zero is distinct. Values use bounded integer minor units and exact decimal parsing.

Fact families have stable owner/year/kind identity. Use one employment family for one job, revising cumulative P45/P60 information instead of adding both totals again. Labels are safe identity aids, not employer tax identifiers. Two differently labelled transcriptions can still duplicate the same underlying employment; the later calculation/wizard must check cumulative/source overlaps, not assume distinct labels prove distinct income.

Each fact kind has an explicit collection answer: Unreviewed, None confirmed, or Complete. None conflicts with active facts. Complete requires all active facts to be reviewed or excluded; provisional facts block it. The attestation stores the current fact digest; any new revision invalidates it. Collection completeness is distinct from calculation eligibility: unsupported cases, missing NI inputs, source issues and ledger overlaps remain blockers even with a complete collection.

## Accounting and evidence separation

Saving PAYE, redundancy, pensions, Gift Aid, tax payments or vehicle elections creates **zero** `financial_records` entries. Those facts are not freelance turnover or ordinary trading expenses. A linked source that remains recognised as trading income/expense is surfaced as an overlap requiring correction; no financial decision is silently removed. The later calculator must block on unresolved non-trading overlap.

Sources may be owned preserved documents, clear active normalized bank observations or approved trading records. Employment, termination, pensions and a verified mileage election require documents. Snapshot metadata contains hashes, source rows, dates, masks and decision versions; raw files, filenames, object paths and keys remain private. Typed facts are manual review, not OCR or automated acceptance of document contents. Source state/version/effect changes are surfaced separately from immutable history.

Withdrawal retains exact previous data and the exact previous source set. It copies the original source snapshots even when a bank import has since been discarded or a trading record excluded. This permits correction of stale provenance without deleting history or restoring older approvals. Changing values/identity during withdrawal rejects; a new explicitly reviewed revision is required for another treatment.

## Payment and vehicle safeguards

Actual tax-payment facts distinguish physical payment total, allocated amount, payment date, safe payment reference, liability type and allocated tax year. Reserves and savings are not credits. With bank evidence, one source observation must show the exact outgoing total/date; multiple bank observations cannot be silently aggregated. Verified allocations sharing that bank observation, or the same canonical date/reference, cannot exceed the physical total across tax years. Totals must agree; reference/date/total are immutable for an existing fact family. References collapse case and whitespace. Correct identity errors by withdrawing and reviewing a new family.

Document-only identity still relies on the human's correct statement-item transcription. The app cannot prove two differently identified statement items represent the same payment without extraction or a shared bank observation. Do not treat the capacity guard as certification of document contents. The later payment reconciliation/filing review must resolve ambiguous identities and allocations before accepting credits.

Vehicle facts retain one explicit asset/method, business-use percentage, evidenced mileage and linked actual-cost records. Approved costs must belong to the reviewed tax year and cannot be reused across two verified vehicles. Verified mileage needs a document log. Bicycle/e-bike employee mileage is not accepted as a sole-trader simplified-expense election. This foundation does not calculate a deduction: later rules must substitute mileage for relevant actual costs, review method history/capital treatment, and never add both. Existing mixed-use amounts are not apportioned a second time.

Pension inputs separate personal cash paid, gross contribution and relief method. Pension assets/forecasts have no field here and cannot silently become deductions; unknown methods stay provisional. Net-pay/salary-sacrifice/employer treatment needs its own later calculation branch. Termination exemption is never inferred from narration or amount; verified facts require a reviewed breakdown and must not repeat employment pay/withholding.

## Transactions, export and recovery

Review RPCs use the owner reconciliation lock, exact current ordinal, owner/year tax stamp and immutable request ID. Exact retries resolve before stale checks; changed payloads reject. Selected mutable sources are locked and the stamp is rechecked before capture. A late audit failure rolls back the family/revision/source writes together. RLS, owner-composite FKs and revoked direct writes protect history. The tax-specific stamp includes financial state and tax history without changing unrelated merchant review stamps.

`/api/tax-prep/facts/export?year=2025` provides a draft JSON history: all profile/fact revisions, source snapshots and completeness attestations, with schema versions and reproducible SHA-256. It uses complete keyset paging, explicit year/owner scope, before/after consistency checks, nested allowlists and fail-closed export audit. It is not a calculation trace, filing pack, authenticity signature or full backup.

Rehearse migration replay and upgrade in disposable Supabase before rollout. Rollback should hide/disable new writes while retaining all evidence/history; do not drop reviewed facts or reinstate old approvals. After a shared deployment, repair through a forward migration. This migration remains local/unapplied, so development corrections stay in the same file.

## Synthetic demo and verification

Use synthetic documents and disposable databases, not real financial accounts:

1. Create a provisional profile with unknown basis/jurisdiction. It persists but cannot become Reviewed until every answer is explicit.
2. Enter a synthetic P45's £14,033.52 taxable pay and £1,542.60 tax withheld, leaving separately evidenced Class 1 band earnings Unknown. Select the preserved synthetic document, read back and confirm. Trading totals must be unchanged.
3. Confirm the employment collection complete, then revise its pay to an explicitly reviewed zero. The old collection answer must become stale. Withdraw the latest fact: earlier pay is not restored; history/hashes remain.
4. Enter an unresolved synthetic settlement. A zero taxable component does not become verified while its breakdown is unresolved. Record pension contributions separately from savings and trading expenses.
5. Allocate one synthetic £100 bank payment £60/£40 across two tax years. A further penny must reject. Whitespace changes and changed total/reference cannot bypass the guard.
6. Link a source still recognised as trading income to a non-trading fact: retain its posting and show the overlap. Reverse that source, then withdraw the fact while retaining the original source snapshots.
7. Inspect the draft export, recompute its snapshot digest and confirm it contains no storage/key/filename/raw-document fields.

Tests cover actual SQL validation/scopes/retries/rollback/ownership/immutability, source reversal recovery, payment caps, vehicle guardrails and collection invalidation. Native independent PostgreSQL connections exercise competing profile saves and classification/profile capture in both orders. Domain/export/action tests cover exact inputs, missing-versus-zero and private metadata exclusion; browser tests cover read-back, evidence gates, withdrawals and reset.

Current verification: **171 tests passed**, zero failed/skipped; both browser suites, lint and production build passed. Configured tracked-file secret scanning and whitespace checks passed. Local production smoke returned 307 to login for the tax pages, 401 for fact/checklist exports and 200 for login; the temporary server was stopped. Build/smoke use public build-only Supabase placeholders and do not establish hosted authenticated behavior.

## Remaining M4–M6 and release work

Implement the sourced, versioned tax rules engine and immutable calculation input/output snapshots with independent golden cases. It must handle or explicitly identify the outstanding supported-case branches: year/jurisdiction/basis timing, PAYE/NI interaction, pensions, POA and actual credits, losses/allowances, vehicle consistency, other income and special reliefs. Do not turn a complete fact collection into a liability or “ready to file” state by itself.

See [tax-rules-research.md](tax-rules-research.md) for official sources and rounding/NI/POA pitfalls. Annual SA100/SA102/SA103 mappings, the resumable guided filing pack, immutable exports/attestation, ongoing cash/reserve forecasts, remaining M2 work and hosted auth/Storage/restore/retention validation remain unfinished.

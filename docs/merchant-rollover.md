# Reviewed annual merchant-rule rollover

17 October 2026. Local M6 annual-rollover slice. No production migration, account connection, real financial approval/posting, send, payment or deployment occurred.

## Workflow and financial boundary

Open `/dashboard/review/memory/rollover` from cash planning or the selected-year merchant-review page. It lists latest rule families scoped to the immediately preceding tax year. All-year rules retain their own scope and are not annual-rollover candidates. Disabled sources, changed category meaning, unavailable/unclear source observations and already-completed rollovers require explicit review instead of silent reuse.

Selecting a source derives a target-year proposal. It defaults to **Disabled**, keeps the source account scope (including explicit all-account/null scope), resets evidence to provisional/missing and proposes explicit dates inside the target year. The source's classification/percentage is only a candidate. Recheck business use, eligibility, category, dates and priority; partial prior-year windows receive a warning. A user may explicitly enable a suggestion during this review, but no transaction is approved or posted by saving it.

An overlapping active target-year or all-year rule makes the proposed full-year window invalid. The editor remains available to narrow the dates to a non-overlapping interval or follow a link to the existing rule. The database checks the actual reviewed range, not merely the initial full-year proposal. Account scope and adjacent target year stay fixed in the rollover flow; broader scope changes use normal, explicit merchant-rule revision.

Figures/words read-back explicitly states that this creates £0.00 of income/expense. Final confirmation and a reason are required. Changes to inputs/reason or refreshed props clear confirmation. The editor now preserves a saved global account scope instead of incorrectly falling back to the seed account. Known source treatment, prior-year rule families and financial decisions remain unchanged.

## Persistence and concurrency

Local migration `20261018030000_merchant_rule_rollovers.sql` follows the complete chain through `20261018020000_finance_plan_revisions.sql`. It adds immutable owner-valid ancestry between exact source and target rule versions and a reviewed target year. Composite foreign keys protect family/version ownership. A unique `(owner, source family, target year)` prevents duplicate rollover even if the source later receives another revision. A rollover creates a separate target family: superseding the old family would remove its prior-year current suggestion.

`rollover_merchant_rule` derives owner from `auth.uid()`, takes the existing owner reconciliation lock, and resolves exact request recovery before reading mutable source state. New captures lock category meaning before checking the reviewed financial stamp. The current source version/status/year/category, source import/identity, account/seed identity, exact fields and target-year date bounds are checked. Unsupported evidence state cannot carry linked/verified evidence into a new suggestion. Active overlapping target scopes are rejected.

The function calls the existing `save_merchant_rule` validator with a separate inner request, then records immutable ancestry and the outer SHA-256-bound request/result in the same transaction. A late failure leaves neither new family/version nor ancestry/request residue. Both source and target families remain available to their own years. No classification batch or financial-record insertion is called. Exact completed retries return their original result after later source changes; a changed request or a fresh stale request rejects.

Authenticated users can read only their ancestry and invoke the reviewed RPC; direct ancestry writes are revoked. Service callers cannot invoke this human-reviewed RPC without the authenticated boundary. Every ancestry insert is atomic with a new merchant-rule version, which is already covered by existing reconciliation/financial stamps. There is no audit-only mutation path. Adding such a path later would require updating the stamp design and its explicit-owner tax clones.

## Export, rollout and recovery

`/api/review/memory/export` now emits schema **`merchant-memory/2`**, adding allowlisted `snapshot.rollovers` source/target IDs, target year, stamp, author/reason/request/time. Existing rule/application/evidence/reversal fields remain. It reads every owner-scoped page to empty, checks financial consistency and requires export-audit insertion before releasing private/no-store JSON. Raw source data, private object paths and keys are omitted. Previously saved filing-pack bytes are not regenerated or changed.

Before production: isolate the authorised release from parked Phase 4, review linked migration state and backups, replay the complete chain on clean and realistic legacy data, and prove hosted auth/PostgREST/Storage and restore behavior. This additive migration performs no rule or transaction backfill. Roll back feature availability by disabling rollover entry points; preserve families, versions, ancestry and request history. Correct target suggestions through ordinary reviewed rule revisions/disablement; do not delete ancestry or restore old transaction approvals.

## Synthetic demonstration and verification

Run `npx tsx scripts/demo-merchant-rollover.ts`. It writes a disabled synthetic proposal and unchanged source to `/tmp/vibecount-merchant-rollover-demo`, with explicit zero postings. It creates no real rule or approval. Run `npx tsx --test lib/database/merchant-rollover.test.ts` for actual disposable SQL creation/retry/rollback and both-year suggestions, or the native concurrency suite for independent-connection races.

Full local suite: **262 tests passed**, zero failed/cancelled/skipped; all **six browser suites** passed. Focused SQL tests cover preserved year suggestions, Unknown transaction state, zero postings, source changes, exact retries, request-method collision, owner/anonymous denial, immutable ancestry, account/date/year constraints, evidence state, conflicts, safe export and late rollback. Native PostgreSQL covers competing rollover retries, source-version edits and category renames in both commit orders. Browser checks cover disabled default, global account preservation, fixed year, narrower dates, exact read-back and confirmation reset. Action/page tests cover authentication, explicit intent, dedicated RPC scope, complete reads and stale-context suppression. Lint, secret scan and production build passed, including TypeScript/routes. Anonymous production-mode rollover page/export/login returned 307/401/200; the temporary server was stopped. A clean build retry passed after preserving the ignored generated cache following an ENOTEMPTY cleanup error. Hosted authenticated acceptance remains separate.

This does not complete M6. Tax-deadline reminders, ongoing source/commercial integration and remaining historic operational/provider, split/FX/communication, independent tax/form and hosted acceptance work remain. A renewed suggestion never certifies a tax deduction or replaces review of an actual transaction.

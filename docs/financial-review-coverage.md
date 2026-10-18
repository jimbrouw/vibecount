# Currency-aware operational review and quarterly checks

This document records the original V1 checkpoint. Current operational V2 adds complete bank source context and capture freezes; see [operational-bank-coverage.md](operational-bank-coverage.md). V1 remains available only as explicit historical replay.

18 October 2026. Continues the handover's existing review workflow. This does not enable external canonical invoice capture, FX settlement or tax filing.

## Authoritative review data

`20261018180000_financial_review_coverage.sql` adds a private owner-parameter catalog, an authenticated `read_financial_review` wrapper that derives the owner from `auth.uid()`, and a service-only `capture_quarter_readiness`. The catalog obtains its counts, signed totals, samples and source token from one SQL read. No raw bank/source content, merchant description, client name or invoice reference is selected into the returned catalog.

Counts include every approved record in the selected year; the latest 20 approved examples are explicitly a sample. Draft and review-state records both count as unfinished interpretations. Four quarters retain exact signed GBP income/expense/net values, including reviewed refund reductions. No data/read error becomes zero. Zero approved quarter activity needs attention and never becomes an inferred “all clear.”

Native overdue invoices are finalised native GBP documents due before the explicit as-of UTC date, with a positive reconciled outstanding balance. A manual paid marker does not remove an unmatched invoice. Only ten examples are returned; the complete overdue count is separate. Original invoice totals group by currency, with no inferred GBP equivalent. Preserved external invoice settlement coverage is explicitly unsupported and prevents a no-issues operational result. Missing/invalid native balance or invoice dimensions withhold the review.

Active imported observations are counted even when no recognised `financial_records` row exists. Unknown/ambiguous duplicate status, unfinished source-linked records and missing required Business/Mixed effects surface as unresolved. Known duplicates and reviewed Personal exclusions do not become spurious unknowns. Coverage counters can overlap; they are not an additive total of unique issues. This operational coverage does not certify that all files were imported, that expenses are deductible, or that tax inputs/filing are complete.

`lib/records/financial-review.ts` rebuilds a bounded typed projection, verifies owner/year/date, counts/sample sizes, identities, currencies and quarter arithmetic, and drops unexpected fields. Review-page failures show unavailable state without an AI request or partial zero totals. The existing batch category panel retains its separate all-tax-years count and explicit human approval flow; its provider/data-consent behavior is not changed by this slice.

## Quarterly capture and historical rows

Cron discovers owners from fully paged current-year records, current-year bank observations and finalised invoices. Invoice-only and source-only accounts are included; it does not enumerate private auth profiles. It sends only owner/year/quarter/as-of to the guarded service RPC. SQL computes and persists the result rather than trusting submitted counts or status. Capture shares the reconciliation lock used by guarded financial writers and writes the operational check in the same database function; source/financial records remain unchanged.

Five nullable coverage fields are added to `quarterly_readiness_checks`. The migration does not rewrite old notes/status or add a verified marker to them. The table remains the **latest check per owner/year/quarter**, not immutable history: a subsequent refresh replaces that quarter's previous result through the existing conflict key. The review UI presents an old or changed result as historical/unverified unless its coverage version, complete source token and as-of date match current data. Even a current `ok` means “no listed operational issues,” never source/tax/filing readiness. Failed captures are reported as failures and the cron response is unsuccessful when any capture fails.

Source state may change after a consistent read/capture. The saved token identifies the state checked; it does not guarantee that state remains current. Legacy direct writers and hosted concurrency still require their broader release rehearsal.

## Consent and AI request boundary

The browser sends only a small exact request containing version, year, expected token and explicit consent. It cannot supply a financial summary. The API authenticates, reloads the owner catalog and rejects stale tokens before provider access. The user reviews generated sample labels/dates/figures and consents to sharing with the existing Anthropic integration for one request. Consent resets after completion/failure and a changed source token remounts the review component, clearing old consent/results.

The provider prompt contains complete counts, dated signed GBP totals, bounded generated examples and original-currency groups with deterministic scale/read-back. Database IDs, descriptions, client names, invoice references, source metadata/files and bank details are absent. Provider diagnostics are not logged or reflected. Results remain plain-text suggestions and cannot change records, approve categories, send messages or certify tax completeness. No new provider or stored provider key feature is introduced.

## Verification and local demonstration

SQL tests use the real ordered migration chain, real synthetic import/review/refund RPCs and retained legacy check rows. They prove 27 approved rows with a 20-row sample, signed refund effects, unresolved sources, known duplicate/Personal exclusions, manual paid markers, draft attention, owner/grant boundaries, derived service capture and no-activity handling. Model/route tests cover explicit GBP/USD/JPY/KWD units, contradictory/missing projections, stale/forged AI requests, consent, privacy, failed reads and complete invoice/source-only cron scope. A dedicated browser suite verifies per-request consent, sample/full-count read-back, exact bounded request metadata, reset after success/failure and source changes. Browser provider calls are inert.

Run `npx tsx scripts/demo-financial-review.ts`. It writes `/tmp/vibecount-financial-review-demo` with review data, an **unsent** provider-summary preview, a captured operational result and a scope README. The disposable SQL fixture seeds synthetic historical approved records and a manually marked-paid invoice: 25 approved records, sample 20, GBP 250 income and GBP 120 still outstanding. No real approval, source-original access, provider call, bank connection or hosted write occurs. This is a read/capture demonstration, not a production approval workflow or tax certification.

## Rollout and remaining requirements

There are now **58 local migrations, including 33 untracked additions**; hosted history is unknown. Rehearse/apply the ordered chain before deploying the new readers/cron. Missing RPCs fail closed. Roll back feature availability or compatible application code while retaining financial/evidence history; do not make old checks current by backfilling coverage markers. No hosted migration was applied here.

Before external enablement: complete native balance-view isolation, tax/filing/finance source closure and parked consumer containment, then canonical external capture/correction. Actual FX lots, settlement/reversal/exports, foreign accounts, fees/refunds, evidence lifecycle/recovery operations, durable communication recovery, representative provider/hosted acceptance, independent tax/form review and release isolation remain required. Existing category/voice AI consent and broader privacy review remain separate work; this slice only replaces the read-only review request boundary.

Checkpoint: 458 automated tests and all 12 browser suites passed. The 13 focused SQL/model/route checks and six independent model/route checks passed. Lint, secret/whitespace checks and clean production build/TypeScript passed. Anonymous production review/AI/cron/login returned 307/401/401/200; the temporary server was stopped. No live provider call or hosted authenticated acceptance was performed.

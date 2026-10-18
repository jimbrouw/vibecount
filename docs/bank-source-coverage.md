# Complete bank source coverage and initial native decision guards

This is a prerequisite for the foreign-account workflow, not its completion. Migration `20261019100000_bank_source_coverage.sql` adds owner-wide safe coverage and initial native decision guards. Foreign account/observation admission remains closed by the existing GBP constraints and non-null native pence. Private valuation writers remain inaccessible to application and service roles.

## Source contract

`read_bank_source_coverage()` derives its owner from authentication. The private reader builds `vibecount.bank-source-coverage/1` from raw owned accounts and observations, with account/import/source-file/source-row closure and latest valuation heads. Native receipt views are not the completeness source. The complete safe payload has a SHA-256 stamp, reconciled counts, at most 2,000 accounts/20,000 observations and a two-megabyte bound. Missing, partial, failed or oversized coverage is unavailable, never successful zero coverage.

Each observation retains cash date/year, account/import/row IDs and hashes, exact original minor units/ruleset, nullable actual GBP cash, classification/dedupe/import state, approved-record count and retained valuation identity/state/value/currentness. Unvalued, provisional, reviewed, reviewed zero, stale, withdrawn, invalid and discarded observations remain represented. No raw cells, descriptions, filenames, object paths or key identifiers enter this projection. Unlike currencies are never summed.

A reviewed valuation is not a classification, recognised accounting effect, tax acceptance or account cash balance. A zero valuation is a real retained value, not missing cash. All foreign representations remain unsupported by current native financial controls, including reviewed zero. Discarded rows remain visible but do not count as active blockers; foreign accounts still require separate account-cash treatment.

`source_available` means matching Storage metadata exists. It does not establish readable retained bytes. `bankSourceCoverageBlocks` is specifically a currency/representation fence, not a general evidence completeness or readiness predicate. Native observations with missing objects require separate source-access semantics in the next consumer contracts.

## Guards and UI

- The private native helper requires owned account and transaction GBP parity, actual nonzero bounded pence, and null foreign-unit fields; it locks selected accounts/observations.
- Native classification, merchant seed rules, merchant batches and transaction/linked-record tax facts check source eligibility. Fresh V1 ingestion requires a GBP account after retained-import recovery.
- Decision and approved-posting triggers cover direct paths; their security-definer helpers retain existing caller-level posting/RLS restrictions. Sourced account currency cannot be rewritten.
- Current import, merchant-memory and tax-fact pages show complete currency coverage. Native-only queues and choosers filter eligibility before amount arithmetic; unsupported source rows have explicit read-back without native financial forms. Incomplete reads withhold selected totals or review controls.
- Original-unit read-back accepts bounded exact nonzero integers. Empty, exponent, fractional, leading-zero, signed-zero and nonprimitive values show unavailable rather than an asserted currency amount. Source changes reset native confirmation.

Public function OIDs/grants and preceding view columns remain stable. Checked in-place edits retain completed-request branches before fresh source checks. The private ingestion base is patched because the current public wrapper delegates to it. No historical request or artifact contract is rewritten.

This does not certify every event-only native writer. Before foreign admission, audit allocations, transfers, refunds, duplicate resolution and connected reversals across complete raw source scopes. Generic posting triggers alone do not cover all event writes.

## Verification and demo

The actual ordered predecessor upgrade compares retained native observation/record bytes and public/private function identities/grants, then exercises native classification and denies direct authenticated posting. Disposable foreign fixtures demonstrate complete source retention despite omission from native cash views, all valuation states, discarded retention, safe owner reading and denied helper grants. Actual calls reject foreign classification, merchant seeds/batches, tax transaction sources, synthetic legacy linked tax records and fresh V1 ingestion. Native import recovery still returns the exact existing import after source-object loss with zero added observations/effects.

Model, route and browser checks cover exact counts/dimensions, invalid/missing native metadata, null-money withholding, merchant gates, source focus beyond pagination, figures/words, retained zero valuation labels and confirmation reset. Browser fixtures use inert server actions and synthetic data; SQL authorization is tested separately.

Run `npx tsx scripts/demo-bank-source-coverage.ts`. It writes `/tmp/vibecount-bank-source-coverage-demo/coverage.json`, `manifest.json` and `README.md`. Actual disposable SQL and encrypted synthetic KWD -10.001 demonstrate seven source snapshots, distinct stamps, native-view omission and zero classifications/financial records/settlements. Test-only foreign admission and every fixture/history change roll back; actual production constraints are checked before and after. The manifest binds exact artifact hash/size. No hosted state, provider or real source is involved.

## Next required work

Follow [foreign-source-containment-plan.md](foreign-source-containment-plan.md): operational review V2; tax input V3; filing input V4/bundle V5; finance context/input/result V3; independently enforced SQL completeness and explicit capture freezes; dimensioned source/reconciliation exports; full event-writer containment. Preserve historical preparers, parsers, saved bytes and request-first recovery. Then finish guarded foreign registration, evidence proof, human valuation/classification/posting, correction/reversal and full tax/finance/export acceptance. A permanently blocked foreign path is not the intended final state.

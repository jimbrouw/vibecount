# Finance V3 bank source coverage

18 October 2026, local implementation. Continues the [foreign source containment plan](foreign-source-containment-plan.md). Foreign admission remains closed. This is not a bank connection, balance verification or completion of M6.

## Current and historical meaning

Finance context, input and result V3 freeze complete owner-wide bank coverage alongside invoice coverage. Empty foreign/invalid accounts, unsupported active observations and active observations with missing source closure or Storage metadata withhold effective current free cash and additional drawings. Discarded native observations remain retained context. A foreign account remains unsupported even when its only observation is discarded: a transaction valuation cannot establish a current account balance.

`evaluateBankCoveredFinancePlan` and `prepareBankCoveredFinancePlan` wrap the existing manual GBP scenario unchanged. Balances, reserves, pension assets, annual forecast arithmetic and explicit obligations preserve their previous meaning. Original bank amounts and retained valuations do not enter assets or recognised income. Native source metadata can be unavailable while its retained cash amount remains valid; readable evidence and metadata existence are separate claims.

The new result includes both invoice and bank coverage stamps. Current readers require context V3; missing, partial, old or drifting contexts fail closed. Confirmation resets on either coverage or other context changes. Current/saved pages show complete coverage and bounded examples. Historical V2 copy explicitly states that bank coverage was not retained. Export reuses owner authentication, retained verification and export audit; it includes frozen V3 coverage rather than current mutable sources.

V1 and V2 preparers/evaluators stay explicit and unchanged. Saved verification requires exact input/result version pairing and replays retained dates, source metadata, coverage and rules. Rehashing edited optimistic outputs cannot authorize drawings. Deadline plans continue selecting explicit tax obligations from verified retained finance inputs; incomplete bank coverage does not erase those obligations or create a new tax bill.

## Migration and safety

`20261019130000_finance_bank_source_coverage.sql` is migration 77 in this local chain. It copies the existing V2 private context builder, replaces current bodies in place and preserves current entry-point OIDs/ACLs. Existing rows and rules are not rewritten. The input-version constraint permits V1/V2/V3.

Exact completed requests recover before new bounds, current context, source availability or date checks. Fresh capture accepts a bounded four MB input/result, requires exact complete owner/current-date input and both coverages/stamps, and independently requires incomplete status plus explicit null effective cash/drawings when blocked. Missing fields reject. Scenario arithmetic is recomputed by the server and retained verifier; SQL adds an independent coverage safety gate.

Capture uses the existing owner reconciliation advisory lock and complete `freeze_financial_review_inputs()` dependency set, including bank valuation/currentness, sources, document registrations/objects, accounts, recognised effects and invoice balance histories. It does not globally SHARE-lock revision/ruleset capture destinations. Cross-owner input mutations may make a capture busy; no optimistic save is substituted. Historical requests remain recoverable.

Actual predecessor upgrade tests capture V1/V2 before migration 77, compare retained bytes/OIDs/grants and retry after head/source changes. Independent PostgreSQL connections prove source deletion and valuation capture races in both commit orders, stale preview refusal, exact retry after loss and simultaneous two-owner captures. Ten dependency-table lock probes establish phantom-write lock coverage, rather than claiming ten actual financial mutations.

## Demonstration and remaining scope

Run `npx tsx scripts/demo-finance-bank-coverage.ts`. Disposable SQL output under `/tmp/vibecount-finance-bank-coverage-demo` includes a report, eight retained verified snapshots and a SHA-256/size manifest. The states are native manual scenario, empty foreign account, unvalued, provisional, reviewed, reviewed-zero, stale and withdrawn. Manual cash and inaccessible pension amounts remain constant; all unsupported states withhold effective cash/drawings. Legacy/current requests recover exactly. Target migration and new fixtures/snapshots roll back, closed admission guards return, and recognised records remain zero. Synthetic predecessor history exists only in the disposable database, which is closed at the end. Placeholder evidence metadata does not prove readable objects.

Remaining work includes event-only native writer containment, standalone dimensioned exports, guarded foreign registration, verified readable evidence, human valuation/classification/posting/correction/reversal and complete foreign transfer/fee/refund/credit treatment. Hosted access, representative provider imports, complete historic facts, evidence lifecycle and coordinated restore, durable communications, independent annual tax/form review and release isolation remain separate handover requirements. No real financial action or hosted migration is performed by this increment.

Final local verification: 709 automated tests, all 16 browser suites, lint without warnings, standalone TypeScript, secret/whitespace checks and clean production build passed. Anonymous finance/deadline pages returned login redirects, exports denied access and login returned 200; the temporary server was stopped. Two demo artifact files independently match their manifest hashes and sizes. Hosted authenticated acceptance remains unproven.

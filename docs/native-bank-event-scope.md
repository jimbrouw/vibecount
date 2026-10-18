# Native bank source scope at financial event boundaries

Local migration `20261019140000_native_bank_event_scope.sql`, 18 October 2026. This implements the database portion of the [connected-source containment plan](native-event-source-containment-plan.md). Foreign admission stays closed. Current choice screens, graph blocker envelopes and standalone dimensioned exports remain further work; this is not completed foreign support.

## Existing contracts preserved

The shared native check requires owned observations with an owned GBP account, actual nonzero bounded GBP pence, GBP observation currency and null foreign original-unit/ruleset columns. Amount sign or a GBP-looking row alone is insufficient. This is an economic representation check, not proof of readable source bytes or tax eligibility. Native historical cleanup does not acquire a new readable-evidence requirement.

The native branch of `require_dimensioned_settlement` now checks its actual bank endpoint under the owner lock before insertion. The entire FX branch remains byte-identical. Fresh private native allocation and returned-cash assignment paths check source scope after exact prior-request recovery and authoritative parent lookup, before capacity arithmetic. Current function identities and grants are preserved through checked in-place edits.

New private event triggers cover transfer pairs/reversals, refund links/reversals, returned-cash assignments/reversals and duplicate decisions/reversals. Reversals resolve actual owned immutable parents. Assignment scope includes the original allocation and both refund endpoints; the allocation must reference that refund's original transaction. Missing/unowned parents reject before insertion. Caller-supplied snapshots cannot establish scope. No table or RPC grant is widened.

## Complete duplicate and import scope

Duplicate review resolves the subject's raw owned account/fingerprint cohort, plus the explicit retained endpoint, under owner and account ingestion locks. Native-filtered views and submitted cohort JSON are not authority. The bounded input stops at 20,001 IDs and rejects above the 20,000-source limit. Distinct/no-op verdicts and fresh reversals receive the same check, so a valid native selected row cannot hide an invalid unselected peer.

Import reversal roots include every raw observation in the target import plus every financial record's bank source linked through that import, including a draft effect. A recursive union expands active transfer/refund edges in both directions until the connected component is complete. A foreign shared-refund source several edges away is not omitted by a refunds-first/transfer-second traversal. Missing or invalid endpoints reject. Both reviewed and legacy public reversal entries check scope before fresh mutation. Completed reviewed requests and already-discarded legacy returns remain ahead of fresh checks.

Unrelated foreign sources do not blanket-block a native operation. The check applies to selected/connected scope. Invoice-only credits and their existing origin boundaries are unchanged; unpaid native invoices do not require an invented bank source. Private legacy import delegates remain revoked and reachable through the guarded public chain.

## Upgrade, rollback and concurrency proof

The ordered predecessor fixture creates actual reviewed allocations, refund assignments, transfers, separate-payment identity decisions, import reversal and shared refund splits. Applying migration 78 preserves retained table bytes, current function OIDs/ACLs, exact old requests and the FX function suffix. Synthetic account-currency corruption demonstrates the new check separately from existing sign/currency checks; production admission constraints are relaxed only inside disposable fixtures.

Public fresh allocation/reversal/assignment, privileged direct event insertion, missing parents, native/foreign cohort mixtures, foreign Unknown imports, effect-linked import roots, connected transfers and transitive shared refunds are exercised. Failed operations preserve complete request/event/classification/effect snapshots. Exact old requests still recover under later invalid account metadata. Current native cleanup succeeds when only unrelated foreign sources exist.

Independent native PostgreSQL connections prove account-row ordering in both directions. An event holds the actual account row through commit; a competing update waits. If account metadata changes first, the event waits and then rejects without a saved reversal/request. Exact reversal recovery survives later account corruption and source-object loss. Ordinary account-currency and immutable-source guards remain intact. Temporarily disabling the sourced-account currency trigger is confined to the test corruption fixture, not a production capability.

For rollback before use, disable current entry points and rehearse the predecessor chain. After real events exist, preserve append-only history and use forward repair. This local migration has not been applied to hosted Supabase. Hosted Auth/PostgREST/Storage, real provider statements and release isolation remain acceptance requirements.

## Disposable demonstration

Run `npx tsx scripts/demo-native-event-scope.ts`. Output is `/tmp/vibecount-native-event-scope-demo/report.json` with a SHA-256/size manifest. Actual predecessor SQL creates native reviewed history, applies migration 78, replays old allocation/assignment requests, rejects fresh malformed-account allocation and reversal without changing history, then performs and exactly recovers legitimate native allocation cleanup. Recognised income/expense totals remain unchanged. Every fixture and the target migration roll back, leaving zero recognised records/settlements and restored GBP admission/non-null pence constraints. Synthetic placeholder source metadata is not certified readable evidence.

## Remaining work

Add complete current bank coverage and explicit native eligibility to reconciliation choice screens. Version connected refund/split/import graph envelopes so unsupported sources appear before native arithmetic, without filtering connected nodes away. Complete dimensioned standalone exports, guarded foreign registration, verified readable evidence and human valuation/classification/posting/correction/reversal remain required. Foreign transfers, fees and cross-currency credits/refunds require their complete reviewed treatment. Evidence lifecycle/coordinated restore, durable communications, representative hosted journeys, complete historic facts and independent annual tax/form review remain part of the full handover.

Final local checks: 722 automated tests, all 16 browser suites, lint without warnings, standalone TypeScript, secret/whitespace checks and clean production build passed. Anonymous reconciliation review pages redirected to login, exports denied access and login returned 200; the temporary server was stopped. The demo report independently matches its manifest hash/size. Hosted acceptance remains unproven.

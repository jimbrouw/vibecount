# Direct native reconciliation choice readers

Local application increment after migration 78; no new SQL migration and foreign admission remains closed. This implements the direct-screen portion of [the native event plan](native-event-source-containment-plan.md). Connected refund/split/import graph envelopes and standalone dimensioned bank exports remain subsequent work.

## Behavior and reuse

`native-choice.ts` compares choice DTOs with complete owned raw bank coverage: source/account/import/row identity, date, currency, exact nullable cash, current decision state and supplied hash/parser/original-unit aliases. Missing or contradictory projections fail closed. Explicit invalid zero representations remain visible but never become eligible native sources. Missing Storage metadata alone does not forbid cleanup of retained native relationships.

`native-choice-store.ts` brackets current reads with bank coverage, financial stamp and a complete owner-scoped account ID/currency/type catalog. The separate catalog detects account-type changes without changing historical bank coverage contracts. Keyset paging continues to an empty page and rejects missing/stalled/unsorted rows. A changed current catalog withholds the review.

Matching uses raw source dates for selected years, complete raw coverage independently of the positive native receipt view, and rejects omitted native positive observations. Unsupported focused sources display exact original units and source links. Native allocation history remains visible; unsupported financial reversal controls are withheld.

Transfers and refunds validate every choice/selection. Active transfer history checks both actual endpoints and native cash parity before exposing reversal. Unsupported sources display original currency figures and words without native financial forms. Existing refund graph links remain available for the next complete connected review step.

Duplicate review requires the whole same-account/fingerprint cohort, unique IDs and exact raw peer counts. It never drops an unsupported peer to obtain a smaller eligible cohort. Missing or contradictory membership withholds the review. Recognised GBP history stays distinct from original source amounts.

No public writer, request intent, retained replay contract or historical financial bytes changed. Database event fences remain independently authoritative at approval time; a rendered form is not permission to bypass current SQL checks.

## Verification and demonstration

Focused rendered/model/data/recovery checks pass **10 tests**. They cover native transfer/refund controls, foreign KWD 10.001 read-back, missing/contradictory source state, account-type and coverage drift, complete duplicate cohorts, retained pair history and conditional reversal. Matching's existing capped-page, owner/year, adjacent-year invoice and recovery assertions remain.

The initial three page-test failures came from fixtures ignoring ascending-ID order. A further drift test advanced its state for the empty pagination sentinel as well as complete catalogs. The harness now models the actual query contract; all original financial/control assertions remain. Production safeguards were not relaxed to make these checks pass.

`scripts/test-native-choice-ui.mjs` renders actual source/read-back/transfer components with inert actions. Changing a selected source removes native controls; returning to native clears confirmation. Malformed complete coverage withholds the form. Exact figures/words, source links and zero financial transport are asserted.

Run `npx tsx scripts/demo-native-choice-readers.ts`. It replays all local migrations in disposable SQL, creates two native and one synthetic KWD source, and renders the actual safe read-back component. All three observations survive complete coverage while the native receipt view contains only one. KWD 10.001 remains exact with null native cash, its source link remains, and no financial form/record/decision/settlement is created. Synthetic foreign source encryption round-trips locally; this does not certify a hosted original. All fixtures and temporary admission DDL roll back; actual GBP admission checks and non-null native pence are rechecked. Output: `/tmp/vibecount-native-choice-readers-demo/{report.json,readback.html,manifest.json}` with SHA-256/byte sizes.

Final verification passed 728 automated tests, all 17 browser suites, lint, standalone TypeScript, secret/whitespace checks and a clean production build. Anonymous production smoke returned login 200, four reconciliation pages 307 to login and reconciliation/records exports 401; the temporary server stopped and its port closed. See implementation progress for evidence and limits. Local component/disposable SQL verification does not establish hosted Auth/PostgREST/Storage, signed-in full journeys, readable real source evidence or financial/tax treatment.

## Next required scope

Connected split/refund closure/import envelopes must derive complete raw scope before native parsers or arithmetic, with independent native and FX blockers and null native context when blocked. Split catalogs need unsupported candidates visible without globally blocking unrelated native selections. Standalone exports must preserve full original/valuation/recognised dimensions. These are prerequisites to guarded foreign ingestion and separate human evidence/valuation/classification/posting/correction workflows, rather than substitutes for them.

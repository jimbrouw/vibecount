# Refund and returned-cash FX dependency review

Local migration `20261019060000_fx_refund_dependency_context.sql` makes existing FX/refund restrictions visible before financial confirmation. No existing financial writer, fingerprint, native reader or grant is changed. At this read-only checkpoint FX saves remained disabled. Subsequent [reviewed FX actions](reviewed-fx-actions.md) enable narrow authenticated matching/reversal through a saved review and separate final human confirmation.

## Database and review contracts

The private `fx_source_dependency_context` derives complete owned safe sources and reuses `fx_dependency_blockers`. It rejects null, duplicate, foreign or missing nodes, checks count parity and returns a versioned context with the financial stamp, explicit counts and retained active lot summaries. Active relationship counts include positive-original/zero-cash portions. The helper remains unavailable to application, service and anonymous callers.

Four new authenticated-only `STABLE SECURITY DEFINER` readers use an empty search path and one statement snapshot:

- `read_fx_source_dependencies`: one to 101 distinct owned selected endpoints; used for simple refund approval.
- `read_refund_split_catalog_v2`: wraps the exact existing native catalog with dependencies for every candidate. A blocked refund withholds the whole form; blocked originals are disabled individually. Unrelated candidates do not block valid native selections.
- `read_refund_reversal_graph_v2`: derives scope from every transaction in the existing complete graph, including import-seeded nodes. Active FX sets `native_context=null`, withholding native financial read-back and confirmation.
- `read_refund_assignment_fx_context`: resolves the original receipt through an owned active native allocation. Posted receipt IDs and capped choice lists are not authoritative. This scope matches the existing assignment writer's original-receipt guard.

Complete envelopes have a two-megabyte bound. Generic contexts retain the existing 20,000-node and 10,000-lot limits; the split catalog retains its 10,000-source bound. Overflow rejects the read rather than returning partial context. Old native reader OIDs, payloads and grants remain unchanged.

## Application behavior

A shared strict parser rebuilds safe owned metadata, validates source/lot closure, exact counts, dates, heads and stamps, and discards private extra fields. Import reversal reuses the parser and shared blocker display while retaining its existing contract and selectors. Each blocker links to complete retained lot review and the exact source transaction. Figures and words preserve original units and GBP cash separately. The current panel links to complete-lot reversal with a saved review and separate human financial confirmation. Reload the blocked native operation after the confirmed reversal releases the dependency.

Simple selected refund reads now bracket native choices/dependencies with a financial stamp. Assignment dependencies sit inside the existing consistency bracket. Current split and reversal stores require their new versioned readers; missing/foreign/incomplete/failed/stale context cannot become an empty blocker set. Split source changes reset confirmation, and pure calculation rejects selected blocked endpoints even if a disabled option is bypassed.

Fresh simple, legacy group reversal, connected closure and assignment actions check owned request history before dependency preflight. Retained requests call the unchanged original writer with the submitted arguments so SQL still verifies the fingerprint; request presence is never automatic success. History errors fail closed. Legacy simple/group actions preserve their original refund-group stamp; closure and assignment use the global financial stamp. Existing SQL guards remain authoritative if state changes after preflight. Assignment reversal stays available for dependency cleanup and has no new FX gate.

## Verification and demonstration

The focused SQL fixture applies predecessors in order, seeds a genuine predecessor zero-cash FX/refund combination and shared native penny, then applies the read-only upgrades. It proves native reader OIDs/stamp/event/record/request preservation, exact native inner-catalog/graph parity, selected/catalog/connected/assignment blockers, complete release after private reversal, distinct-owner denial and anonymous/service/private-writer permissions. Route tests cover fresh history → dependency → writer ordering, failed history/read/counts/stamps, blocked financial forms, historical retries and changed-fingerprint rejection. Browser checks cover disabled originals, valid unrelated selection, exact lot/source links, refund-form withholding, release/reset and existing native read-back.

**Local verification:** 596 automated tests and all 14 browser suites passed, with lint, standalone TypeScript, secret/whitespace checks and a clean production build. Anonymous production smoke denied refund review pages and reconciliation export access; the temporary server was stopped. These checks do not prove hosted acceptance.

Run `npx tsx scripts/demo-fx-refund-dependencies.ts` for `/tmp/vibecount-fx-refund-dependency-demo/dependency.json`. Actual disposable SQL and synthetic evidence retain KWD 0.001 / GBP 0.00, a native penny and a predecessor refund. The output shows all four blocked contexts, exact historic recovery and clear contexts after private complete-lot reversal. It contains safe synthetic metadata only.

Apply the reviewed migration after all predecessors and before deploying the current readers. No hosted migration has been applied. Old readers are retained for staged compatibility. No destructive rollback is required for this read-only addition; financial history is untouched. Hosted Auth/PostgREST/Storage behavior, large-history transport/performance and a representative signed-in end-to-end journey remain unproven.

The subsequent [reviewed FX action checkpoint](reviewed-fx-actions.md) implements freshness, uncertain-response recovery and least-privilege activation locally; hosted acceptance remains required. Full foreign-account valuation, fees/cross-currency credits/refunds, tax/finance treatment, evidence lifecycle/coordinated restore, durable communications, annual tax/form review and historic/provider acceptance remain unfinished handover scope. This slice does not complete the Finance OS.

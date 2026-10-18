# Shared-cash refund allocations and reversal closure

17 October 2026. FR2/M2 continuation of the reviewed implementation plan. This is an additive extension of the current ledger, not a second accounting ledger. The initial pure calculation/closure proof creates no financial action; the full write/report/UI migration must land together before split approval is exposed.

## What already exists

`refund_links` already records immutable source-to-original cash portions and recognised reductions. It has owner-composite source FKs, per-link request/reversal history, category and percentage snapshots. `refundReview` and `approve_refund` use cumulative exact-pence rounding. Existing invoice refund assignments have useful per-link capacities. The tax record reader already enumerates recognised `financial_records` with refund-link provenance; filing-pack source traversal already follows refund edges recursively.

The pre-extension bottleneck was one-to-one state: `financial_records.bank_transaction_id` is unique; `bank_transactions.recognized_record_id` and `active_refund_id` are scalar. Several views/exports join only that canonical record, and commercial refund assignment requires one link to own the entire observed cash. Permitting a second link alone would misstate totals or fail an assignment. Original-group reversal also assumes no shared refund observation.

## Proposed architecture and invariants

1. One immutable bank observation remains the source of cash. A reviewed request allocates its **entire** positive magnitude to 1–100 unique opposite-sign owned originals, using exact integer pence. Unallocated cash is not silently discarded. Invalid/unknown scope, retained duplicate/transfer/refund dependencies and stale source versions stop approval. Unsupported FX remains unresolved.
2. Keep `refund_links` as one immutable allocation per original. Each nonzero recognised portion gets its own negative `financial_records` effect retaining the original bucket, category and project, dated at refund cash receipt/payment. A zero-recognised portion still has a cash/evidence link, but no zero-value posting. Per-original cumulative reduction remains `round((prior cash + portion) × business-use bps / 10000) − prior reduction`.
3. Replace the source-wide unique posting constraint with a partial unique ordinary-record index (`refund_link_id is null`), retaining unique `refund_link_id` for negative effects. Update every ordinary `ON CONFLICT` inference to the partial predicate. Never overwrite an old refund effect to reuse it as an ordinary record. Preserve excluded historical effects.
4. Keep the scalar canonical record pointer for ordinary interpretations. Refund observations use a shared aggregate projection over **all active child effects**, not an arbitrary child. Add an explicit shared cash group/header or clearly scoped refund-state projection; a representative link may only mean dependency presence, never total ownership. One classification decision represents the aggregate negative recognised amount. Do not invent a shared percentage/category when children differ.
5. Remove an existing ordinary interpretation of the refund once per cash observation, then record child links/effects plus one aggregate decision and request result atomically. Source observations and original positive postings remain unchanged. Lock the owner reconciliation scope and selected source rows in deterministic ID order. Recover exact requests before mutable checks; new/stale/changed requests reject. Bind the full displayed source/financial stamp, selected versions, prior refunds, rationale and request method.
6. Reverse the complete connected component of originals and refund observations. From any selected original, follow all its active refunds, every sibling original sharing those refunds, and all further active refunds of those originals. An import reversal seeds every source observation in that import and follows the same closure. This preserves cumulative rounding and prevents half-reversed cash. No earlier classification is restored.
7. If **any** closure link supports an active invoice refund assignment, stop before mutation and direct the user to reverse those assignments. A closure read-back must enumerate every source/import, original, child link, total observed refund cash counted once and signed accounting reductions. Version/closure changes reset confirmation.

## Coordinated consumers — do not skip

- `approve_refund` becomes the one-original compatibility wrapper for the new split action. Preserve exact historical request recovery; a legacy successful request must not get reinterpreted under a new method fingerprint.
- Ordinary classifier upserts and all dependency guards must remain valid after index changes. Transfers, duplicates, reclassification and invoice receipt allocation must continue rejecting active refund observations even when the ordinary pointer is null.
- Update `transfer_transaction_choices`, `refund_transaction_choices`, `receipt_allocation_balances`, `duplicate_review_transactions`, `source_import_summary`, group stamps and import/group reversal to use complete projections/closure.
- Invoice refund assignment validates its child cash/effect and complete shared-cash allocation, rather than requiring observed cash equal one link. Keep original allocation/credit/refund capacities and sibling-assignment reversal blocking.
- Source CSV/evidence manifests must enumerate every effect while counting source cash once. Current `source-export.ts` takes the first joined record; that is insufficient. Version the changed schema and retain prior saved artifact bytes.
- Reconciliation export must identify shared cash vs portions and preserve both source chains. Tax calculation/filing observation totals must use aggregate effects. Existing saved snapshots and filing packs remain unchanged and reproducible.
- Existing financial stamps cover refund links, reversals and financial record states. New independent mutable header state would also need stamp coverage, explicit-owner tax clones and parity tests. Prefer immutable provenance plus derived active state.

## Delivery and migration sequence

A. Deliver strict split-intent validation, exact read-back calculation, source closure and a connected-component reversal reference model with synthetic tests/demo. This does not enable financial writes.

Implemented locally: the strict pure calculation/closure models, safe authenticated graph RPC (`18050000`), synthetic demo and tests. The complete reviewed reversal (`18060000`) now has an authenticated human review page, authoritative connected-set write, complete child-effect exclusion, assignment blocking, exact recovery and legacy shared-scope guard. Its migration preserves source-wide posting uniqueness and one-original approval. See [split-refunds.md](split-refunds.md). This implements the connected-reversal portion of B/D/E; full shared-cash approval and coordinated report/export projections below remain required.

B. Add the coordinated forward migration: partial ordinary-posting uniqueness and classifier changes; immutable shared-cash provenance; split approval; aggregate views; complete reversal/import closure; commercial assignment validation. Preserve owner FKs, RLS, private helper grants and exact retry compatibility. Replay all existing migrations on clean and realistic legacy fixtures.

C. Update all current view/export/report consumers, snapshot/source consistency and parity tests before exposing the split form. Test integrated totals across records, source manifests, tax and filing exports. Retain old artifact/version verifiers. Block unsupported/incomplete source projections explicitly.

Implemented read-side preparation in `18070000`: one-row observation aggregates, all current choice/import/tax/filing projections, complete independently paged source child histories, version 2 evidence and filing outputs, and original-byte predecessor recovery. Selected-year posting effects survive cross-year cash context with a blocking timing exception. See [split-refunds.md](split-refunds.md). The remaining B write/index/assignment migration must be tested against these readers; the read-side implementation does not itself enable split approval.

Implemented the database writer portion of B in `18080000`: partial ordinary uniqueness and classifier, strict immutable split approval, legacy retry compatibility, child-based legacy reversal and per-child invoice assignment validation. Existing real fixtures now prove writer-to-reader-to-reversal behavior; independent-connection retry/legacy/category races pass. The later checkpoints below supply the human gates, reconciliation cash export and native shared-assignment race coverage; hosted rollout checks remain required. See [split-refunds.md](split-refunds.md).

D. Add explicit figures/words review, per-original portion input and entire-closure reversal/import read-back. Reset confirmation after any source, scope, amount, reason or props change. No new transfer, payment, invoice send or filing action.

Implemented the split approval portion of D with safe atomic catalog `18090000`, the human split page/form and server action. Fresh intent is recomputed against owned metadata; retained request recovery remains database-authoritative before live reads. Added exact source focus beyond pagination, complete confirmation-reset browser coverage and version 2 reconciliation cash/portion columns. Full import discard coordination is now implemented in `18100000`; its dedicated review/coordinator avoids the old nested chain and verifies exactly one Unknown reset per affected observation. See [reviewed-import-reversal-design.md](reviewed-import-reversal-design.md).

E. Verify disposable SQL, native concurrency in both commit orders, action/export contracts, browser read-back and anonymous runtime denial; document rollout/recovery. Rehearse hosted PostgREST/Storage before applying production migrations. Disable entry points to withdraw availability; never drop populated history or rewrite source evidence as rollback.

## Required acceptance evidence

- One refund across multiple categories/projects and years; customer refund across originals remains income reduction, not expense. Exact portions sum to cash and one prior interpretation is removed once.
- Cumulative mixed-use pennies, including final zero-recognised portions and full reversal of the original allowable amount. Capacity and integer overflow reject.
- Foreign/missing/duplicate/stale sources and unsafe payload fields reject. No raw evidence, paths, keys or bank details enter review/export.
- Reversal graph includes transitive siblings, extra refunds and imports; incomplete graph counts/assignments fail closed. Per-link portions do not multiply observed cash.
- Original/import reversal blocks on a sibling invoice refund assignment. Connected closure effects and all immutable reversal rows commit or roll back together.
- Competing split/single approvals, same/fresh retries, original capacity, category meaning/source revision and reversal/assignment races in both orders.
- Source, record, reconciliation, tax and filing totals agree after approval/reversal, including paged datasets and zero-posting portions. Frozen historical outputs do not change.

The full split-refund feature is not complete until B–E are implemented and verified. The shared human approval path, full-import coordinator and shared-assignment native races now exist locally. `18110000` closes the reproduced assignment-reversal post-lock freshness gap. Hosted authenticated/large-context acceptance and release checks are still required. FX, provider/source/evidence lifecycle operations, durable communications, unsupported tax branches, independent tax/form review, hosted acceptance and release isolation remain active handover work.

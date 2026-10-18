# Reviewed complete import reversal

17 October 2026. Local implementation for handover FR1/FR2/M1/M2. The design below records the predecessor defect and the coordinator now implemented by `20261018100000_reviewed_import_reversal.sql`. It is not hosted deployment evidence.

## Existing behavior and defect

The public three-argument `reverse_source_import` in migration `17160000` reverses directly encountered refund groups, then invokes `_v3` (`17140000`, transfers), `_v2` (`17130000`, invoice allocations) and `_v1` (`17110000`, target effects/classification/import state). The base loop unconditionally adds Unknown to every target transaction. Target refund/transfer observations already reset by a child action can consequently receive a second decision/version increment. Shared refunds fail closed through the current legacy group guard, so the old totals-only form cannot approve a complete shared/import operation.

Reuse `read_refund_reversal_graph`, the pure `refundReversalClosure`, `reverse_refund_closure`, the reviewed transfer/allocation reversal functions, immutable event patterns and the owner reconciliation lock. Do not call the old import wrapper chain after reversing child relationships. Preserve its historical API/recovery boundary; replace the application's entry with a dedicated complete review.

## Read context

Add authenticated owner-derived `read_source_import_reversal_context(import_id)`. Return one atomic safe snapshot: selected import/status, every target observation/effect, complete connected refund graph (including disconnected families seeded by the import), transfer pairs/counterparts, target invoice allocations and explicit blockers. Include the financial stamp, independent counts and bounded source lists. Omit descriptions, raw evidence, bank identifiers, paths and keys. Reject incomplete/oversized context; no partial financial read-back.

Read back ordinary target effects plus complete connected negative effects without counting target refund effects twice. Show signed income, expense and net-profit changes; refund cash once per observation; transfer cash separately; and invoice allocation/balance changes. Discard only the selected import. Other-import original payments retain their classifications; affected other-import refund observations and transfer counterparts become Unknown.

## Write coordinator

Add immutable owner/request payload/result history and `reverse_source_import_reviewed(import_id, stamp, reason, request_id)`.

1. Authenticate, validate the exact reviewed intent, acquire the owner reconciliation lock and recover an exact completed request before mutable reads. Changed payload rejects. Reopening an import cannot make a successful retry act again.
2. Reconstruct/validate the full context and reviewed stamp. Lock affected source/effect/import rows deterministically and recheck currentness. Check retained duplicate references and invoice refund assignments throughout the connected graph and target allocations before any mutation.
3. Reverse the complete import-root refund component once, supported transfer pairs and target invoice allocations using existing guarded operations. Child request identities/results remain traceable to the outer request. Intermediate stamps may change only because of this operation; initial complete scope must already have been reviewed and locked.
4. Maintain an explicit set of observations reset by child steps. Exclude/reset residual selected-import observations directly, skipping already-reset IDs. Each affected observation gets exactly one Unknown decision for this operation. Never restore an earlier approval.
5. Discard only the selected import and append its source event and immutable outer result atomically. Any child/event/request failure rolls back all relationships, exclusions, decisions and import state. Preserve original files, rows and history.

Do not automatically reverse duplicate verdicts or invoice refund assignments. Existing `protect_retained_duplicate_import` and assignment guards remain authoritative blockers. Withdrawal disables new entry points; it does not delete populated history or evidence.

## Human gate and acceptance

Replace the totals-only discard form on the imports page with a link to a dedicated complete review. Require a reason and explicit confirmation of every affected source, relationship and signed amount in figures and words. Source/scope/reason changes clear confirmation. The action passes a root/stamp/request rather than trusting client relationship lists. Retry recovery must still compare the database fingerprint before returning a retained result.

Prove real shared/transitive/disconnected refunds; transfer counterparts; overlapping target/reset IDs; sibling and target-allocation assignments; retained-duplicate blockers; no unrelated import changes; exact retry after reopen; changed requests; late all-or-none rollback; and competing approval/reversal in both commit orders. Compare the displayed read-back with actual records, source/reconciliation exports and tax/filing readers. Include page/action/browser/anonymous checks, a synthetic demo, migration/recovery notes and explicit hosted acceptance limits.

## Implemented local checkpoint

The dedicated `/dashboard/imports/reversal` page replaces the old totals-only form. Atomic context, detached pure validation, figures/words read-back, root-only server intent and the guarded coordinator are present. All target draft/review interpretations are excluded too. The legacy three-argument API is unchanged; the new application path avoids its nested reset chain. Initial approved effects determine signed changes; staged effects do not inflate the displayed accounting delta. A released invoice match changes outstanding only by its actual credit/retained-cash economics.

The real SQL fixture includes shared/transitive/disconnected refunds, transfer counterpart, ordinary original, receipt and personal exclusion. Six links across four refund observations and other imports reverse together. Ten affected observations reset exactly once; only the chosen import is discarded. Signed income/expense/profit changes match the review; other original classifications and immutable source rows survive. Exact retry after reopen, changed/stale requests, assignment/retained-source blockers and injected late rollback are verified. Native connections prove competing shared approvals and same/fresh reversal requests serialize.

The synthetic demo `npx tsx scripts/demo-import-reversal.ts` executes actual authenticated RPCs in disposable PostgreSQL and saves its review/result to `/tmp/vibecount-import-reversal-demo`. It verifies minus £3.70 profit and a £10 invoice release yielding only £1 outstanding after retained £5 receipts and £9 credits. All evidence/ciphertext/object metadata are synthetic placeholders. The build caught an untyped demo query; it now declares its returned balance fields and passes TypeScript. No real data or financial action occurred.

Page/action/model/SQL and the tenth browser component suite cover exact intent, failed/foreign/incomplete context, blockers, source/reason refresh and confirmation resets. Production-mode anonymous reversal/source/export/login checks return 307/307/401/200; the temporary server is stopped. Current aggregate checks are recorded in `implementation-progress.md`. Hosted RPC/Storage/authenticated journeys, large context acceptance and operational restore remain release gates.

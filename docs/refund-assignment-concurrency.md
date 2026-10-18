# Reviewed refund assignment concurrency

17 October 2026. Local handover FR2/M2 hardening plan. Preserve existing financial models, human gates, request fingerprints and result shapes.

All governed assignment and connected/import reversal actions acquire the owner reconciliation advisory lock. Existing native tests use single-original cash; add real shared-child fixtures, explicit observed waits and both commit orders. Test same/fresh retries, sibling capacities, original/refund/import roots, final-assignment release, and historical retry after parent reversal. Accounting postings must never be created by assignment.

A read-only inspection found that `reverse_invoice_refund_assignment` checks its global stamp before waiting for the invoice row but not after. Reproduce using an allowed authenticated reminder-metadata update holding that row. If confirmed, use one additive forward migration replacing this function with the same body and a post-lock stamp recheck before the reversal insert. Preserve exact retry recovery before mutable reads and all current grants.

Verify the regression fails on the predecessor chain and passes after the forward migration. Prove stale failure leaves assignment, reversal/request history and accounting effects unchanged. An exact previously completed retry must still recover after context changes. Run the native suite, full tests, lint/build and synthetic demos; hosted authenticated acceptance remains separate.

## Implemented and reproduced

`20261018110000_refund_assignment_reversal_freshness.sql` replaces only the existing assignment-reversal function. It retains the historical method/payload hash and result shape, owner identity, exact retry before live reads, immutable history and authenticated-only execution. The added post-invoice-lock financial stamp check rejects changed review state before insertion. Apply after `18100000` in the complete ordered chain; no hosted migration was applied. Withdraw entry points to disable use, retain history, and never delete financial evidence as rollback.

The native predecessor run failed with “Missing expected rejection” while the reversal demonstrably waited for an authenticated `next_reminder_at` update. With the forward migration the same regression passes, leaves active assignment/request/reversal history intact on failure, then permits a fresh review. Subsequent metadata changes do not invalidate exact successful historical request recovery.

The real shared fixture uses two £100 original receipts, one £100 customer cash return, two £50 portions, two reviewed invoices, real allocations and two £50 credits. The native matrix checks original/refund closure roots and both original/refund imports against a sibling assignment in both commit orders. It also proves same/fresh approval and assignment-reversal races, refreshed child capacity, two-child assignment with zero new postings, remaining sibling blockers, last-assignment release/stale parent, immutable source facts, exact decision resets, target-only discard and historical recovery after parent reversal. Function privilege assertions preserve anonymous/service denial and authenticated execution. All 35 native tests pass; the full suite has 371 passing tests. The final additional retry/grant assertions were rerun in the native suite.

Independent read-only review found no blocker. Global context checks and selected row locks do not claim to freeze every unrelated legacy owner write through commit. Hosted PostgREST/Storage/authenticated journeys and large payload/operational recovery remain unverified release work. Final build/lint results are recorded in `implementation-progress.md`.

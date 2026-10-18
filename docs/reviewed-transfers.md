# Reviewed transfers and card repayments

Local implementation, 17 October 2026. `20261017140000_reviewed_transfers.sql` adds immutable transfer requests, pairs and reversal history; `/dashboard/reconciliation/transfers` provides explicit human review.

A pair requires different owned accounts, equal opposite GBP observations, active imports, clear duplicate state and matching decision versions. Bank transfers pair bank accounts; repayments pair an outgoing bank payment with an incoming credit-card credit. Existing invoice allocations must be reversed before pairing. Approval reads back both accounts, dates, amount in figures/words and any recognised income/expense removed.

Approval excludes both observations from recognised turnover/deductions without changing separate card purchases. Pairing a £300 repayment therefore does not duplicate or remove a distinct card purchase. Active pairs block ordinary reclassification and invoice allocation. Shared owner reconciliation locks and deterministic row locks coordinate competing actions; request IDs make unchanged retries safe.

Reversal requires reason/confirmation and retains history. Both observations return to Unknown; previous income/expense classifications are not automatically restored. Import reversal dissolves touching pairs atomically, including a counterpart from another import, then excludes the selected import. Reopening restores neither old approvals nor relationships. Pair reversal and import reversal are separate recorded audit stages and may increment affected decision versions twice.

The source summary includes pair/counterpart effects in its review digest. Reconciliation exports carry pair/reversal events plus both source row/file hashes, account masks and counterpart links. These events describe relationships, not additional turnover to sum. Source manifests expose current active-pair IDs. Revision-safe export stamps reject a financial mutation during paginated reads.

Synthetic examples are `fixtures/synthetic-transfer-nationwide.csv`, `synthetic-transfer-starling.csv` and `synthetic-transfer-amex.csv`. They demonstrate signed/debit-credit/card-charge normalization only; they are not certification of representative real provider formats. Demo: import/review the £1,500 bank legs, pair them and verify zero sales/deductions; pair the £300 bank/card repayment and verify the separate £630.29 card purchase remains unchanged; reverse the pair and verify both legs become Unknown.

Tests cover owner/anonymous/direct-write isolation, stale versions, duplicate/reversed/allocated legs, equal amounts/account kinds, idempotency, reversals, cross-import reversal and independent-connection pair/classification/allocation races. Browser checks cover transfer read-back and confirmation reset. Actual deployed Supabase/Storage and authenticated full-browser integration remain unverified. No production migration or real financial action was performed.

Remaining M2: refunds and credit notes, FX, overlapping-statement resolution, proposals and material exceptions. Unmatched transfer candidates remain visible; pairing is explicit, not automatic. See `invoice-reconciliation.md` and `invoice-revisions.md` for adjacent scope.

## Subsequent refund slice

Reviewed supplier/customer cash refunds and signed report/export effects now exist locally; see `reviewed-refunds.md`. Earlier statements that all refund accounting is absent are superseded. Invoice credit notes/settled corrections, FX, split refund allocations and complete exception resolution remain unfinished.

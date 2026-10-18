# Reconciliation implementation contract

Status: reviewed GBP receipt allocations, GBP transfer/card repayment pairing and invoice/PDF revisions are implemented locally. Refunds, settled-invoice corrections/credit notes, FX and full exception resolution remain future work. See `docs/reviewed-transfers.md` and `docs/invoice-revisions.md`. Read alongside `handover2.md`, `docs/invoice-reconciliation.md` and the Milestone 0 audit. Remaining M1 document-fact review/recovery and deployment verification are still outstanding.

## Existing behavior to preserve

Invoice finalisation (`app/api/invoices/pdf/route.ts`) creates an invoice, not an accounting receipt. `markInvoicePaid` in `app/dashboard/invoices/actions.ts` changes delivery/paid metadata only. Treat existing paid flags as unverified assertions until linked to payment evidence. Do not fabricate missing payment dates or source links.

The source ledger already creates at most one recognised `financial_records` posting per reviewed bank transaction. Matching invoices must reuse that posting. A £1,500 payment from a former employer who became a freelance client must remain one receipt regardless of the number of matched invoices.

## Allocation model

Add append-only `invoice_settlements` with owner, invoice and bank-transaction composite owner FKs, positive integer-pence allocation, event kind (allocation/reversal), original allocation reference, author, rationale, request idempotency key and immutable invoice snapshot. A unique reversal reference prevents double reversal. Direct writes are revoked; owner reads use RLS.

Support many receipts per invoice and many invoices per receipt. Allocation reversals retain history and restore outstanding balances without reversing cash income. Manual paid metadata, invoice lifecycle and evidence-backed settlement state remain distinct. Show partial and unallocated balances explicitly.

## Mutation and concurrency contract

All reconciliation mutations acquire the same owner reconciliation lock before row locks. Update classification/import reversal procedures to follow this order before adding allocation writes. Lock affected invoices in deterministic order and verify review versions.

Human approval reads back the complete receipt amount, allocations and unallocated remainder. Allocating £500 must not silently classify an unreviewed £1,500 receipt. Require an already approved positive GBP Business receipt at 100%, or explicitly review the entire receipt in the same transaction.

An allocation procedure verifies owner, active import, clear duplicate state, finalised invoice, positive exact amount and both remaining receipt/invoice capacity. It records all allocations and audit events atomically, creates no duplicate income and safely handles request retries. Paid/reminder state changes only from confirmed settlement evidence.

Prevent classification changes from invalidating active allocations. Import reversal must reverse allocations and restore invoice balances atomically, with settlement state included in the confirmation digest. Reopening must not restore allocations automatically. Protect finalised allocated invoice facts against direct owner writes as well as UI edits.

Source-posting deletion is currently constrained by the reciprocal `bank_transactions_recognized_record_owner_fk` (default NO ACTION). The absence of a DELETE branch in `protect_source_posting` alone does not establish a bypass; retain/test that FK when changing relationships.

## Transfers, refunds, credits and FX

Retain immutable relationship/reversal events. Reviewed GBP transfers/card repayments pair different owned accounts with opposite equal amounts and exclude both accounting effects. Keep unmatched candidates visible.

Refunds need signed accounting effects: supplier refunds reduce expense; customer refunds reduce income, on the correction date. Add a compatible signed-effect representation and update every reporting/export/tax consumer together. Do not rewrite the original purchase, especially across 5/6 April. Bound partial refunds by unrefunded amounts.

Credit notes reduce invoice entitlement; cash refunds reduce cash received. Model both so outstanding is not reduced twice. Invoice revisions and currency must be explicit. Unsupported FX remains an exception until source/invoice currencies, exchange rate, fees and approval are implemented.

## Proof before completion

- £1,500 receipt matched once; partial and many-to-many allocations; unallocated remainder.
- No receipt/invoice over-allocation, including independent-connection races.
- Owner isolation, anonymous/direct-write denial, stale reviews and idempotent retries.
- Allocation reversal, import reversal and concurrent classification maintain invoice balances and one accounting receipt.
- Transfers and card repayments contribute zero turnover/deductions; partial refunds retain original evidence and correct tax-year timing.
- Credit note plus refund cannot double-reduce outstanding; unsupported FX stays unresolved.
- Reconciliation export links invoice/allocation/reversal IDs to source row/hash and exposes unresolved differences.

## Subsequent refund slice

Reviewed supplier/customer cash refunds and signed report/export effects now exist locally; see `reviewed-refunds.md`. Earlier statements that all refund accounting is absent are superseded. Invoice credit notes/settled corrections, FX, split refund allocations and complete exception resolution remain unfinished.

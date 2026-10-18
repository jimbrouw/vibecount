# Reviewed invoice reconciliation

The first M2 allocation slice lives at `/dashboard/reconciliation`. It is implemented locally, not deployed or a declaration of M2 completion.

## Migration and compatibility

Apply `20261017130000_invoice_settlements.sql` after the existing source/document migrations, following schema/backup rehearsal. Existing invoice presentation and stored `amount` are GBP: this migration makes that currency explicit. The stored amount is already gross payable; do not add VAT from current settings. Existing paid flags remain assertions until supported by allocations.

New append-only `invoice_settlements` contain allocation/reversal decisions, exact pence, author/reason, request ID and an immutable snapshot of invoice number/date/client/gross amount/currency/status/version. `settlement_requests` records input identity and response for safe retries. Composite owner FKs, owner RLS and revoked direct writes protect both. Security-definer mutation procedures derive owner from `auth.uid()` and pin their search path. No financial account is connected and no money is moved.

The migration wraps previous classification/import-reversal procedures. Original implementations become internal functions with public/authenticated/service execution revoked. Do not call their `_v1` names from applications. New and existing actions use the public reviewed wrappers.

## Accounting and human review

Only an active, clear, positive GBP bank receipt already reviewed as 100% Business income can be matched. Its canonical approved financial record must equal the complete receipt. Matching creates no extra income. A receipt can pay many invoices; invoices can receive many receipts. Partial/unallocated amounts remain visible.

The form reads back individual allocations, resulting invoice outstanding, total match and remaining receipt amount in figures and words. Approval requires a reason and checkbox. Changing amounts/reason or the entire receipt/invoice review snapshot resets confirmation. PostgreSQL rechecks ownership, classification version, invoice timestamps, the exact previously allocated receipt total and both capacities under a shared owner reconciliation lock. Changed state requires fresh review, even if there is still enough cash.

Fully allocated invoices receive an evidence-backed paid marker and source payment date. Partial matches/reversals restore an open balance. Reminder scheduling is disabled during these changes and is not automatically restarted after a reversal. No email is sent by reconciliation. Economic invoice facts cannot change once settlement history exists; metadata-only operations remain possible. Invoice corrections/credit notes need their own reviewed history workflow.

Reversing an allocation restores outstanding and unallocated cash but does not remove genuine income. Reversing an import also reverses its active allocations, excludes recognised effects and retains all evidence. The import confirmation digest includes allocation history, and the UI reads back affected match count/value. Reopening restores no postings or allocations automatically.

## Exports

`/api/reconciliation/export` produces a spreadsheet-safe CSV with separate `settlement_event`, `receipt_balance` and `invoice_balance` row kinds. Do not sum the amount column across different row kinds as turnover. Allocation/reversal rows link invoice and transaction IDs, source row/hash, original file hash, author/reason and request identity; receipt rows include unallocated amounts and provenance. All rows are labelled **Draft — not submitted to HMRC**.

Reads continue to an empty page rather than assuming a short page is the end. An owner-wide digest of invoice timestamps, transaction decision versions and immutable settlement IDs is checked before and after reading all pages. Changes/failures reject the export; they do not yield mixed states. This is a current consistent view, not the immutable filing snapshot planned for M5. Embedded relations rely on the [documented PostgREST view/base-table FK inference](https://docs.postgrest.org/en/v13/references/api/resource_embedding.html); refresh the schema cache and verify actual PostgREST responses after migration.

## Synthetic demo and proof

In a disposable authenticated test account, create finalised synthetic invoices of £1,000 and £1,000 and import a synthetic £1,500 receipt. Review the complete receipt as Business income. Match £1,000 to the first invoice and £500 to the second: outstanding becomes £0/£500, receipt unallocated becomes £0 and recognised income remains £1,500. Import/review another £500 receipt and match the remaining amount. Reverse the first match and verify £1,000 outstanding returns while income stays unchanged. Reverse its source import and verify related matches reverse together.

PostgreSQL tests execute this many-to-many flow, reject over-allocation/stale snapshots/foreign IDs/direct writes, verify rollback, preserve snapshots and test import reversal/reopening. Native independent connections observe real lock waits and prove stale receipt remainder rejection, invoice edit protection after waiting, and no concurrent invoice overpayment. Browser component tests verify read-back and confirmation reset on amount or snapshot changes; isolated action tests verify auth/checkbox gates and exact RPC parameter wiring. They do not replace full authenticated Supabase/Storage/PostgREST rehearsal.

## Outstanding M2 work and risks

- Transfer/card repayment pairing, refunds with signed accounting effects, credit notes, reviewed FX and overlap resolution.
- Automatic matching proposals and a materiality-ranked exception queue; current matching is explicit manual review.
- Historical invoice import/extraction and robust invoice revisions/PDF preservation. Existing unallocated invoice editing can reconstruct VAT incorrectly because only gross is stored; do not infer historical net/VAT from current settings. Resolve with explicit versioned invoice facts before completing invoice correction support.
- Full authenticated deployment rehearsal, migration drift review and production backup/recovery. No new migration has been applied by this work.
- All later expense memory, tax rules/calculations, filing-pack and ongoing cash-planning requirements remain active.

## Subsequent local slices

GBP transfer/card repayment pairing and reversals are now implemented; see `reviewed-transfers.md`. Exact invoice economics and immutable PDF revision history are also present; see `invoice-revisions.md`. Any earlier remaining-scope references to those core capabilities are superseded. Signed refunds, settled-invoice corrections/credit notes, FX, proposals, overlaps and full exception handling remain unfinished.

## Subsequent refund slice

Reviewed supplier/customer cash refunds and signed report/export effects now exist locally; see `reviewed-refunds.md`. Earlier statements that all refund accounting is absent are superseded. Invoice credit notes/settled corrections, FX, split refund allocations and complete exception resolution remain unfinished.

## Current currency-aware export

The current reconciliation endpoint emits version 3, retaining existing GBP financial columns and adding separate original-currency document rows, retained source references and explicit unavailable external balances. Version 2 bytes remain reproducible. See [currency-reconciliation-export.md](currency-reconciliation-export.md) for the exact contract, coverage checks and remaining FX enablement dependencies.

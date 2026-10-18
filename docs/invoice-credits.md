# Reviewed invoice credits — local implementation

17 October 2026. This is an incremental M2 delivery, not completion of M2 or the handover. No production migration, real financial action or email send was performed during development.

Subsequent integration: [invoice-refund-assignments.md](invoice-refund-assignments.md) completes returned-cash matching and updates balances, parent-reversal safeguards and exports. Its verification supersedes this earlier checkpoint where noted.

## What the flow does

`/dashboard/reconciliation/credits` lets an authenticated owner choose a finalised GBP invoice, review supplier/customer details, enter a credit amount/date/reason and explicitly confirm the read-back. It shows net/VAT where verified, total credit, entitlement, outstanding and cash to reconcile in figures and words. Any changed input or refreshed invoice snapshot resets confirmation.

Approval preserves a uniquely numbered draft PDF before an atomic database approval. The PDF records the original invoice reference/date and the reviewed supplier/customer, supply, reason and monetary components. It is not sent. History provides the preserved PDF/hash and original revision link. Reversal requires a reason and separate read-back; only the latest active credit can be reversed, preserving cumulative penny apportionment. Reversed credits and their source facts remain immutable.

Credits change commercial entitlement only. They create **zero financial records** and move no money. A bank refund already has its own signed accounting effect under the reviewed-refund model. Its assignment to an invoice/credit does not post that effect again.

## Migration and invariants

`20261017170000_invoice_credits.sql` is the existing local, unapplied migration completed for this delivery. It depends on all preceding October ledger, settlement, revision and refund migrations. It adds append-only credit requests, notes and reversals; extends the invoice balance/choice views; adds review RPCs and reminder amount/version fields. Do not deploy it in isolation from its API/UI/consumer changes. Establish actual deployed migration metadata before rollout; do not edit or reorder any migration already applied elsewhere.

- Owner-derived review RPCs, composite ownership foreign keys, owner RLS and restricted direct writes.
- Shared reconciliation owner lock and invoice row lock coordinate credits, allocations and reversals. Requests are idempotent, with changed payloads rejected.
- Credits are bounded by original gross less active credits; a valid date is between invoice date and today's London date. Future credits cannot change today's entitlement.
- Known net/VAT is apportioned cumulatively against the original invoice snapshot. Fragmenting a credit into pennies still sums to the original net and VAT. Current settings never supply historic VAT.
- Legacy unknown net/VAT stays unknown and requires explicit UI/API acknowledgement. The preserved draft carries a commercial-only VAT warning. This does not resolve tax treatment.
- All credit history, including reversed notes, freezes invoice economics/deletion. Ordinary invoice revision requests reject credit history before uploading a new artifact. Existing successful revision retries still recover their original artifact first.
- Credit approval/reversal disables reminders and skips pending drafts. No fully credited unpaid invoice is represented as paid cash.
- Immutable upload paths use owner/request IDs and PDF SHA-256. Successful POST retries read preserved metadata/PDF before consulting current balances and verify the stored hash. Upload failure produces no credit. A failed/ambiguous approval can leave an orphan upload retained for operational recovery; full recovery tooling remains M1 work.

## Balances and consumers

Current balances now use `entitlement = gross − active credits`, `retained cash = allocated receipts − assigned returned cash`, `outstanding = max(entitlement − retained cash, 0)` and `cash to reconcile = max(retained cash − entitlement, 0)`. Reviewed returned-cash assignments and their reversals are implemented in migration `180000`; unassigned refunds remain separate and must not be assumed matched. Do not interpret cash to reconcile as an instruction to refund again.

The dashboard now reads complete, consistency-checked, paged balance data and separates original invoiced value, allocated receipts, credits, outstanding and cash to reconcile. A manual paid marker is an assertion, excluded from received-cash totals. Read failures show unavailable data. The former percentage-of-paid-invoices tax-pot card is removed; actual reserves/forecasts remain M6 work. Original invoice downloads remain available. Existing email/chase shortcuts are withheld for reconciliation history until a communication can review the changed balance and original document together; static full-period late interest is not asserted for that history.

Reconciliation export adds immutable credit/reversal events, credit date, net/VAT status, original revision/PDF provenance, credit PDF hash, current balance components and an explicit zero accounting effect. Existing column positions remain intact; all rows are padded to the extended header. Financial snapshot stamps include credit/reversal state.

Reminder drafting uses outstanding cash and captures the reviewed amount plus invoice version. It rejects invoice details whose original version differs from the balance read, then compares-and-swaps scheduling before publishing a draft. The draft stores the post-scheduling version. Sending checks current amount/version immediately before the provider call and uses a stable provider idempotency key. Legacy drafts without snapshots fail closed. Credit history keeps scheduling unavailable, even after reversal, pending a dedicated fresh communication review.

This is **not durable email delivery coordination**. A balance can change after the send-time check while the provider request is underway. Stopping a schedule before draft insertion can also leave an interrupted drafting attempt to recover. Complete claim/outbox/recovery design, provider acknowledgement persistence and real Supabase race tests before relying on delivery guarantees. Quarterly readiness now uses positive reconciled balances under the subsequent assignment delivery.

## Verification and limits

Final local verification: **118 tests passed**, zero failed/skipped; both browser component suites, lint, production build, secret scan and `git diff --check` passed. Production build used public build-only Supabase placeholders. A temporary production-server smoke check returned 307 to login for the credits page, 401 for unauthenticated credit POST/download and reconciliation export, and 200 for login. The server was stopped after the check. No hosted Supabase services or mail provider were used for this verification.

Tests cover real SQL approval/reversal, ownership/direct-write denial, stale versions, retries, capacity, unknown legacy VAT, cumulative rounding, immutable history after reversal and zero extra ledger postings. A fully paid invoice credited by £30 becomes £30 cash to reconcile; its original £120 receipt remains one income record. Native independent PostgreSQL connections prove credit/allocation races serialize in either order; a fresh allocation cannot exceed the reduced entitlement.

Component browser checks cover exact figures/words, VAT acknowledgement, changed-field and refreshed-snapshot confirmation reset, and reversal gates. API tests use inert transport to prove authentication, stale-review rejection, upload-before-approval failure behavior and hash-checked recovery. Multi-page PDFs are parsed to verify full reason preservation and monetary words. Reminder tests use inert providers, reject stale/unknown/zero balances and revised customer versions, and prove partial-balance drafting and provider key reuse. These do not certify deployed Supabase HTTP/Storage or authenticated end-to-end behavior.

Document fields and the commercial-only warning were checked against [HMRC VAT Notice 700, section 18](https://www.gov.uk/guidance/vat-guide-notice-700#section18) and [electronic invoicing guidance](https://www.gov.uk/guidance/electronic-invoicing-notice-70063). No claim of tax certification, VAT-return adjustment or legal sufficiency is made. Review the actual supply, party details, original evidence and tax treatment before issuing a document.

Next: reviewed credit communications/durable reminder delivery, bank-refund splits across original receipts, overlap resolution, match proposals and material exceptions. M3–M6 and the historic Self Assessment pack remain outstanding.

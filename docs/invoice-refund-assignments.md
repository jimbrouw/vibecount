# Reviewed customer-refund assignments

17 October 2026. Incremental M2 implementation. The full handover remains active. No production migrations, bank connection, payment or email send occurred during this delivery.

## Workflow and financial meaning

`/dashboard/reconciliation/refund-assignments` lists reviewed customer refunds with masked account provenance, original receipt/refund source links and assigned/unassigned amounts. Choose an active credit and original receipt allocation for the same invoice, enter an exact partial or full amount, read back its effects in figures and words, then explicitly confirm. Refreshed data or changed inputs reset confirmation.

The bank refund already reduces its original income bucket on its recorded date. Assignment creates **zero accounting postings** and moves no money. It changes commercial reconciliation only:

- Entitlement `E = original invoice gross − active credits`.
- Retained invoice cash `N = allocated receipts − active assigned returns`.
- Outstanding `max(E − N, 0)`; excess cash to reconcile `max(N − E, 0)`.

An invoice for £120 with £120 allocated receipts and a £30 credit initially has £30 cash to reconcile. Matching an already-recorded £30 return leaves £90 entitlement and £90 retained, with nothing outstanding or excess. Matching can also increase outstanding: a £100 invoice with a £30 credit and £70 allocated receipts becomes £30 outstanding after a £30 return. Further allocations can fill that shortfall. This is why a return assignment is bounded by credit and receipt capacity, rather than by currently displayed excess cash alone.

One refund can be partially assigned across multiple credits/invoices funded by its original receipt. Multiple refunds can support a credit. A bank refund still belongs to one original payment under the existing refund-link model; splitting one bank refund across different original receipts remains separate M2 work. Non-GBP/FX matching remains unsupported and visible as unresolved.

## Data and safety contract

`20261017180000_invoice_refund_assignments.sql` adds immutable requests, assignments and assignment reversals, with an active projection and owner-safe candidate views. Each assignment preserves invoice balances and original allocation/credit/refund snapshots. Composite owner foreign keys and owner RLS constrain relationships; direct writes are revoked from application roles. Review RPCs derive the owner, take the shared reconciliation lock then invoice lock, reject stale global review stamps and replay unchanged requests before mutable-state checks.

Approval requires an active owned credit, active original receipt allocation and active reviewed GBP customer refund of that same receipt. The negative recognised refund posting must still be approved. Amounts are positive exact pence, bounded by the remaining refund, original allocation, credit, invoice credited amount and allocated receipts. No source refund can be spent twice across invoices.

Reversal appends a separate event, preserves all parents and recomputes balances. It requires its own current-state read-back, reason and confirmation. Reversing an assignment does not undo the bank refund or its accounting effect.

Parent reversals **block while dependent assignments remain active**. Database triggers cover receipt allocation reversal, credit reversal, refund-group reversal and every source-import reversal path. This includes the complete affected refund group across different source imports. Reverse assignments explicitly first, then review the parent again. A rejected parent operation rolls back all intermediate effects. Import reopening restores no assignments, refunds or allocations; credit history remains preserved.

Invoice, refund-group, import and global export stamps include assignment/reversal history. Import summaries disclose active assignment count/amount and the UI withholds source reversal until resolved. Credit history links to dependent assignment review. Allocation reversal now reports its actual outstanding delta, which can be smaller than the amount released because credits remain in force.

## Reporting and evidence

Dashboard and reconciliation distinguish gross receipts, matched returns, retained cash, credits and outstanding. Credit approval/reversal read-backs include already-assigned returned cash. These remain invoice reconciliation amounts, not current bank balances or actual reserve balances.

The reconciliation CSV adds immutable assignment and reversal rows with parent IDs, both source file/row hashes, preserved credit PDF hash, signed retained-cash effects and explicit zero accounting effects. Current invoice balances include total assigned returns. Existing column positions remain stable; the retained cash header now describes its net meaning. Exports page all history and reject financial-state changes during reads. The export is not an immutable filing pack.

Quarterly readiness now counts sent invoices with positive reconciled outstanding and a past due date. Fully credited invoices do not create false overdue counts. Scope reads are paged; failed counts/summaries fail the affected check rather than being written as zero. Net profit uses exact pence conversion. This is a readiness aid, not a tax calculation or filing assessment.

## Verification and fixture demo

Final local checks: **120 tests passed**, zero failed/skipped; both browser suites, lint, production build, secret scan and `git diff --check` passed. Build used public build-only Supabase placeholders. A temporary production-server smoke check redirected both assignment/credit pages to login (307), denied unauthenticated reconciliation export and quarterly cron (401), and served login (200). The temporary server was stopped. No hosted Supabase or mail provider was contacted by these checks.

Database tests exercise real receipt classification/allocation, credit approval, bank refund review, fragmented assignments, replay/stale/capacity rejection, cross-owner/anonymous denial, unchanged ledger totals, all four parent guards, rollback, reversal and reopening. A further allocation after a return proves the cap uses retained cash. Independent native PostgreSQL connections exercise competing assignments and a concurrent refund-group reversal; the loser waits, rejects stale state and cannot overuse remaining capacity. These run with a Supabase schema shim, not hosted Supabase HTTP/Storage.

Browser component checks prove exact read-back, zero-posting wording and confirmation reset for changed amount/reason/server snapshot and reversal. Action tests prove auth/confirmation gates and exact pence/RPC arguments. Export tests prove both source chains, reversal signs, zero postings, formula neutralisation and consistent column widths.

Disposable test-environment demo using existing synthetic files:

1. Create/review a non-VAT synthetic £1,500 invoice dated 5 April 2026. Use synthetic supplier/customer details and preserve its PDF.
2. Import `fixtures/synthetic-refund-originals.csv`; review the £1,500 receipt as Business income and allocate it to the invoice. Other fixture rows remain unresolved unless separately reviewed.
3. Import `fixtures/synthetic-refund-following-year.csv`; link its £500 customer return to the original receipt through the refund-review page. Do not infer decisions for the supplier refund rows.
4. Approve a £500 credit dated 6 April 2026. Invoice entitlement is £1,000 and £500 excess cash needs reconciliation.
5. Match that recorded £500 return to the credit/original allocation. Retained cash becomes £1,000 and excess becomes zero. Ledger totals do not change at this step.
6. Attempt parent reversals: each must block. Reverse the assignment with read-back first; the original credit/refund remain approved. Then review any intended parent correction separately.
7. Export reconciliation and follow the original/refund file hashes, source rows and preserved credit PDF hash. Other unresolved rows prevent this demo from claiming a complete filing pack.

## Rollout, recovery and remaining work

This additive migration depends on all prior October migrations and coordinated application changes. Establish deployed migration metadata, rehearse empty/upgrade databases and run actual two-owner authenticated Supabase/PostgREST/Storage tests before rollout. Do not apply production migrations from this checkpoint.

Rollback must preserve assignments and their history. Disable new writes and keep compatible reads; simply rolling back to an application that ignores returned cash would misreport balances. Recover interrupted operations through immutable request results, not manual edits or deletion. Evidence retention/key recovery remains an operational release dependency.

Still required for M2: bank-refund splits across original payments, unsupported FX policy/implementation, overlap resolution, match proposals, material exception queue, reviewed credit communications and durable reminder delivery/recovery. M1 source/document operational gaps and M3–M6 remain unfinished. Current tests do not certify tax eligibility, the historical reconciliation, production deployment or HMRC filing.

## Shared cash and reversal freshness

The shared writer (`18080000`) validates child-specific capacities against complete observed cash; representative link identity is not total ownership. Native independent connections now prove same/fresh assignment retries, both child capacities, sibling blockers, connected/full-import reversal in both commit orders, last-assignment release and historical recovery without new effects.

The actual predecessor assignment-reversal function allowed a reviewed stamp to become stale while waiting for an invoice row held by a permitted reminder metadata update. Forward migration `20261018110000_refund_assignment_reversal_freshness.sql` rechecks the global financial stamp after the lock, before any reversal event. Fingerprints/results, exact recovery before live reads, grants and zero accounting effects are preserved. Regression failure and corrected acceptance are documented in [refund-assignment-concurrency.md](refund-assignment-concurrency.md). Hosted acceptance remains separate.

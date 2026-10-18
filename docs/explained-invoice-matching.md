# Explained invoice suggestions and category integrity

Local M1/M2 hardening checkpoint, 17 October 2026. The complete `handover2.md` objective remains active. No production SQL, financial approval, bank connection, send or deployment was performed.

## Human workflow

`/dashboard/reconciliation` now opens a receipt tax year and prioritises unresolved positive cash by unallocated amount, then date/ID. The queue distinguishes approved income awaiting invoice review, source-classification exceptions, unresolved source identity, unpaired transfers and refunds needing an original-payment relationship. Personal exclusions, reviewed duplicate exclusions and completed transfer/refund pairs remain accessible in complete receipt history; they do not re-enter classification simply because they have no invoice match.

Selected receipts show their safe source description/reference and link to import review. Existing receipt-only links and post-approval redirects reopen the receipt's own tax year through an owner-scoped date lookup. Explicit year filters remain explicit. The filing wizard carries its current year into reconciliation. Invoice candidates remain across years, so a receipt on 6 April can settle an invoice dated 5 April without changing cash-basis receipt timing.

Suggestions rank bounded invoice references, distinctive client text, exact remaining cash/current outstanding and date proximity. Amount alone is manual-review evidence. Common/short identifiers and common client words do not establish identity. Equal leading evidence is ambiguous; deterministic ID ordering is only presentation. A conflicting known invoice reference or multiple referenced invoices prevents a strong single-invoice shortcut. Late/advance payments remain reviewable with timing warnings. The ranking is a deterministic triage heuristic, not a probability, tax eligibility or approval.

Only an approved, clear, whole Business GBP income observation with matching recognised cash and no active transfer/refund receives a suggestion. An unresolved employer-like PAYE observation receives none. Draft, zero-outstanding and non-GBP invoices receive none. Non-GBP balances are visibly withheld from pound displays pending FX review.

The current slice suggests individual invoices, including partial settlements using the smaller of current outstanding and available cash. Selecting a suggestion replaces only the draft allocation fields and resets confirmation; it never submits. The existing form still supports multiple manually selected invoice allocations. Every approval requires exact figures/words, a reason and human confirmation, then the existing transactional RPC rechecks owner, source classification/version, existing allocated cash, invoice version and capacities. Matching adds zero income.

## Complete reads and bounded presentation

`lib/records/match-data.ts` reads owner-scoped receipt balances, finalised invoice balances, minimal client identities, posting types and selected receipt allocations using keyset pages until an empty response. Server page caps below the requested size do not truncate candidates. Only the receipt queue is tax-year filtered; invoice dates are not.

Reconciliation stamps enclose the full read, including selected allocation history. Client identity is read twice and compared because names are not covered by the financial stamp. Failures, client drift or financial drift withhold review instead of reporting empty/zero data. Free source descriptions/references and client names are redacted; machine invoice identifiers and integer amounts are preserved. No raw evidence, credentials, client contact details or external AI calls are involved.

The page displays 50 receipt exceptions and 50 invoice balances at a time. A selected receipt's top ten proposals are computed from the complete invoice set and their invoice DTOs are added to the review form even if beyond the current invoice page. The page reports candidate coverage and omitted alternatives; ambiguity is determined before limiting display. Other invoices remain available through manual pagination. Large complete candidate sets currently require server memory; measure realistic workload before claiming unbounded scalability.

Implementation references:

- `lib/records/match-proposals.ts`: pure eligibility, ranking, explanations and queue.
- `lib/records/match-data.ts`: complete, consistent, safe server read model.
- `app/dashboard/reconciliation/page.tsx`: tax-year queue, history, candidate coverage and review.
- `AllocationReview.tsx`: proposal draft selection and confirmation reset.
- Existing `approveAllocations` / `approve_invoice_allocations`: authoritative reviewed writes, unchanged.

## Category database invariant

Migration `20261018010000_record_category_integrity.sql` follows draft packs and the complete earlier chain. It adds owner-or-shared-default and record-type validation to every insert/update of `financial_records`, `csv_import_rows` and `bank_statement_import_rows`. Null remains an explicit missing category. Shared defaults are valid; a foreign user's category or the wrong income/expense type is rejected even on status-only approval.

The category identity tuple `(id,user_id,record_type,is_default)` is immutable for every role. Rename/mapping metadata edits remain possible and existing review digests detect them. Reclassification uses a new correctly typed category rather than changing the meaning of all references. A narrowly scoped definer trigger takes a key lock, with a pinned search path and no ordinary EXECUTE grants. This avoids shared-default locking SELECTs being hidden by their intentional UPDATE RLS restrictions. Generic row triggers do not acquire reconciliation advisory locks in reverse order.

The migration does not rewrite, clear, reapprove or guess repairs for historical invalid links. The security-invoker `record_category_integrity_issues` view reports only owned row identity/type/status/update time and source kind, without foreign category labels/metadata. Invalid historical rows remain visible, but a subsequent write with that invalid link must explicitly replace/clear it. Existing manual record review can choose a valid category. A dedicated staging repair UI remains a rollout task; operator reconciliation of diagnostics must be explicit and auditable, not a blanket backfill.

Existing category FK delete semantics remain: legacy-only references may clear, while immutable source/history references restrict deletion. Native PostgreSQL verifies category deletion/linking in both orders, and identity edits are denied even through a privileged caller. The change does not claim all older financial writes have database-enforced human confirmation.

Bank/refund/history models retain their existing reviewed RPC protections. Their categories must not be revalidated merely from bank cash sign: a positive supplier refund correctly retains an expense category. Future defence-in-depth guards there must resolve the original accounting bucket and historical refund version.

## Verification and anonymised demo

At this checkpoint the full suite has 220 passing tests, zero failed/cancelled/skipped; lint, all four browser component suites and the Next production build pass. The temporary production-mode server redirected anonymous reconciliation access (307), denied reconciliation export (401), served login (200), and was stopped. Local SQL tests use synthetic Supabase auth/storage shims; they do not certify hosted PostgREST/RLS/Storage or real bank export variants.

Run the focused source-to-approval demo:

```bash
npx tsx --test lib/database/match-proposals.test.ts
```

It imports synthetic source rows for £250, £275 and £1,500 plus an unresolved employment receipt, reimports idempotently, explicitly classifies only freelance receipts, generates synthetic invoice PDFs and saves reviewed immutable revisions, computes suggestions, and confirms them through the actual allocation RPC. Recognised income stays exactly £2,025 across all matches and exact retries; unresolved employment does not become allocatable.

Additional checks:

```bash
npx tsx --test lib/database/category-integrity.test.ts lib/database/concurrency.test.ts
npx tsx --test lib/records/match-proposals.test.ts lib/records/match-data.test.ts lib/records/match-page.test.ts
npm test
npm run test:ui
npm run lint
npm run build
```

They cover an upgrade containing an invalid legacy link without audit changes, all three legacy entry paths/roles/shared defaults, owner-safe diagnostics, category deletion races, exact references versus prefix collisions, ambiguous/conflicting/multiple references, current/partial/credited capacities, ineligible receipts, reviewed exclusions, pending relationships, page caps, owner/year isolation, adjacent-year invoice matching, changed client/financial state, a strong match beyond row 50, FX withholding, source-year reopening and unavailable-page gates. Browser tests prove proposal selection changes draft amounts only and clears confirmation; existing SQL/native tests prove stale capacity/version approval rejection and zero duplicate postings.

## Rollout and remaining handover work

Replay the entire ordered chain on empty and realistic upgrade databases; inspect hosted migration state and diagnostic counts before rollout. Do not silently repair foreign links. Validate actual Supabase relationship/projection syntax, authenticated owner separation, access/restore and realistic read/lock performance. Roll back UI availability/new writes while preserving source/history; keep integrity guards until an equivalent reviewed replacement exists.

This closes local first-page candidate blindness and the three legacy category entry guards. It does not complete M2 or the handover. FX, split refunds across originals, broader exception resolution, durable/fresh financial communications and a general reviewed no-invoice resolution remain. The pack's no-invoice declaration remains pack-scoped. Evidence preview/restore/retention, staging repair UX, independent tax/form review, unsupported calculator/pack branches, hosted authenticated end-to-end proof and M6 remain active.

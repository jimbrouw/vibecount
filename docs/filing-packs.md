# Guided immutable draft filing packs

Local M5 checkpoint, 17 October 2026. This is a draft review/export capability, not a completed tax return, HMRC submission, MTD recognition or independent tax certification. The full `handover2.md` objective remains active.

## User journey

Save a current draft calculation, then open `/dashboard/tax-prep/filing-pack?year=2025`. Review Profile → Sources → Income → Expenses → PAYE → Redundancy/other income → Pension/Gift Aid → Estimate → Exceptions → Final review → Export.

Each review stores its relevant input digest, typed answers, author, reason and ordinal. Valid decisions resume when their relevant inputs are unchanged. Changed source metadata invalidates source/final review; changed form choice invalidates dependent expense/final review. Newer answers under the same digest supersede older ones. Current input, review history and calculation are read consistently before displaying review forms or capturing output.

All financial amounts use exact pence and figures/words. Missing one-off amounts differ from explicit zero. An unmatched approved trading receipt requires reconciliation or an explicit, current no-invoice declaration; it cannot disappear merely because its income classification was approved. Human confirmation resets when fields, scope or refreshed props change.

Users may preserve an incomplete draft. Financial completeness attestation is enabled only when all ten current reviews and required financial/mapping inputs are resolved. It does not approve filing, verify employer documents, fill taxpayer identity fields or certify every HMRC return field. Reviewing an exception step cannot dismiss an unsupported calculation branch.

## Frozen outputs

Every capture stores all seven files together under one input SHA-256, calculation/rule version, annual mapping, review request and draft status:

| File | Meaning |
| --- | --- |
| `worksheet.html` | Printable escaped worksheet with annual form/box candidates, exact amounts, separate paper rounding and source IDs |
| `normalized-ledger.csv` | Year observations plus connected context, recognised income/expense effects and manual/legacy provenance |
| `invoice-payment-reconciliation.csv` | Invoice/receipt balances and immutable settlement, transfer, refund, credit, assignment and duplicate relationship history |
| `expense-decisions.csv` | Classification, merchant application/undo and legacy change history |
| `exceptions.csv` | Current unresolved requirements and review notes |
| `calculation-trace.json` | Saved inputs/result/rules/rounding/source trace and annual mapping |
| `evidence-manifest.json` | Source file/row/document/invoice revision hashes and related safe provenance |

The ledger separates `year_income_pence`, `year_expense_pence` and `year_profit_effect_pence`. Sum the first two independently; profit effect is income minus expenses. A negative expense refund therefore increases profit. `year_effect_pence` preserves the signed effect in its accounting bucket and is not itself a profit column. Context rows contribute zero to every year-effect column. Invoice relationships contribute no second trading receipt. Balances are explicitly all-time as of capture, not tax-year income.

Source graph closure retains connected originals/counterparts outside the selected year, including refunds, transfers, duplicates, invoice settlements and tax-payment sources physically paid later. Those sources explain the selected year without entering its trading totals. Classification/relationship history is not incorrectly filtered by decision creation date.

CSV uses physical CRLF records and formula escaping. Machine identifiers, hashes and integer amounts are not bank-redacted. Free descriptions/references/rationale are redacted in the database's safe projection. Empty exports contain explicit metadata/no-row markers. HTML escapes untrusted values and exports with a restrictive CSP and private/no-store headers.

## Annual mapping limits

`lib/tax/form-mapping.ts` records the 2025/26 mapping and official annual sources. The review date is 17 October 2026; engineering source checking is separate from independent tax review. The [SA103S form and notes](https://www.gov.uk/government/publications/self-assessment-self-employment-short-sa103s), [SA103F form and notes](https://www.gov.uk/government/publications/self-assessment-self-employment-full-sa103f) and linked SA100/SA102/SA101 references remain part of the versioned mapping.

Short-form eligibility requires an explicit full-year/simple-affairs review, not turnover alone. Full-form categories aggregate by annual box before rounding. Profit/loss lines use the appropriate box and positive magnitude. Exact calculation amounts remain separate from proposed paper pounds; derived paper profits need a consistent paper arithmetic review.

Cash-basis capital candidates are restricted to relevant car allowance box families; eligibility still requires evidence. The [cash-basis guidance](https://www.gov.uk/simpler-income-tax-cash-basis/income-and-expenses-under-cash-basis) distinguishes cars from ordinary equipment expenditure. The current UI cannot establish entitlement merely by selecting a box.

Completeness remains blocked for unmodelled other-income mapping, unsupported adjustment/loss branches, full-form substitutions/disallowable sub-box allocations not yet implemented, net negative expense mapping, missing legacy content hashes, and required unknown source facts. Termination exemption is explicitly transcribed from reviewed components rather than inferred as gross minus taxable. One-off pension and Gift Aid subsets are reviewed separately; gross RAS and net donations retain distinct fields. Negative PAYE paper rounding is withheld for review.

## Database, capture and retry contract

Migration `20261018000000_draft_filing_packs.sql` follows the entire existing chain, including `20261017230000_tax_calculation_snapshots.sql`. It adds immutable owner-readable `filing_pack_step_reviews`, immutable `tax_form_mappings`, immutable `filing_packs`, and owner-valid pack export links. The SQL has only been exercised locally; it has not been applied to production.

Authenticated clients can read owned safe input and history. Step review and bundle capture are service-only; the server action authenticates, requires explicit confirmation, rebuilds the complete input/model/bundle and compares the reviewed digest. Private explicit-owner helpers and freezing functions are not callable by ordinary owners, anonymous clients or service callers directly.

Capture uses the owner reconciliation lock and brief global `SHARE NOWAIT` locks over independently writable source/legacy/evidence tables. It rebuilds inputs after locking, rejects a stale calculation, validates review ownership/latest ordinals and artifact hashes/sizes/names, and atomically registers mapping plus pack. Global locks can cause cross-owner contention; measure actual workload and preserve fail/retry behavior rather than dropping the consistency guarantee.

Exact request recovery occurs before mutable input reads/locks. The same completed request returns the original pack after later financial, evidence or review changes. Different payloads under that request fail. A fresh request must satisfy current input and review checks. No pack operation posts a financial record, sends a message or submits anything.

Saved exports verify canonical input/bundle hashes, mapping/version/year, request/status consistency, seven unique artifact names and each artifact hash/size. An export audit failure withholds output. The integrity manifest includes reviewer/reason/request/time and artifact metadata. SHA-256 is an integrity reference, not an authenticity signature, continued blob availability or full backup.

Current delivery rejects individual artifacts over 4,000,000 bytes explicitly; there is no truncation. Larger-file private delivery remains work before claiming large-source coverage. Readable document preview, account lifecycle/retention and database/object/key restore also remain separate M1/operational acceptance work.

## Verification and synthetic demo

At this checkpoint: 208 automated tests passed, zero failed/cancelled/skipped; all four browser component suites, lint and Next 16.4.2 production build passed. Tests use synthetic Supabase auth/storage schema shims and inert transport. They do not certify hosted policies, real source formats or tax correctness.

The actual SQL scenario covers repeated imports, cross-year refund/transfer/payment evidence, a real generated synthetic invoice PDF hash, receipt matching with zero extra income, all ten step reviews, seven outputs, forged artifacts/provenance/mapping/status/year rejection, late-failure rollback, owner/role denial, superseded answers, exact recovery and immutable historical bytes. Native PostgreSQL independently connected transactions prove both lock orders for document, batch, batch-item and same-digest answer changes. Route tests cover owned immutable export bytes, confirmation/hash forgery, exact request recovery, capped history pagination, and source/review drift. Browser checks cover exact zero versus invalid money, no-invoice scope, clearing optional mappings and completeness/confirmation reset.

Run:

```bash
npm test
npm run test:ui
npm run lint
npm run build
npx tsx scripts/demo-filing-pack.ts /tmp/vibecount-filing-pack-demo
```

The demo writes all seven outputs, synthetic PDF fact examples and a verified `saved-pack.json`. It uses handover-scale example amounts with explicit synthetic assumptions; it is not a reconstruction of the taxpayer's actual sources or an approved historic tax result. The SQL scenario is the separate evidence-linked import/reconciliation proof.

The production-mode smoke check redirected anonymous filing-page access to login, returned 401 for pack export and 200 for login; the temporary server was stopped. Authenticated hosted browser/PostgREST/Storage validation remains required.

## Rollout, rollback and remaining work

Before rollout, isolate the reviewed release diff from parked Phase 4, inspect hosted migration history, replay empty and realistic upgrade databases, verify actual roles/Storage and rehearse object/database/key restore. Do not selectively apply dependent October migrations or backfill missing evidence hashes. Feature rollback should disable new review/capture availability while retaining immutable evidence, rules, packs and historical exports.

This is a local M5 slice. Complete independent annual tax/form review and unsupported branches, full historic source reconciliation, scalable artifact delivery and authenticated hosted E2E before claiming M5 acceptance. Release isolation/evidence operations, remaining M2 matching/FX/split corrections/durable communications, legacy ownership hardening and M6 remain in the full handover.

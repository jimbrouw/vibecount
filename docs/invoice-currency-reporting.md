# Invoice amounts by currency

18 October 2026. Reporting prerequisite for the [foreign invoice plan](fx-foreign-invoice-plan.md). No migration or external invoice writer is added here. Canonical external invoices remain disabled by the existing native-only SQL constraints.

## Current behavior

`lib/invoices/reporting.ts` validates two explicit document-amount representations. Native GBP uses its existing exact non-null decimal amount and requires all external-only metadata to be null. Preserved external projections require a null compatibility amount, positive bounded integer original minor units, the supported immutable currency ruleset and well-formed source revision/family identifiers. Missing, contradictory or unsupported metadata does not fall back to zero or another amount field. A valid projection is not proof that its source is owned, current or readable: the future canonical capture writer must enforce that proof in SQL.

Original invoice totals group by currency, with finalised and draft amounts separate. They never imply GBP conversion, received income, an outstanding balance or accessible cash. Single-document bounds remain unchanged; aggregate totals use checked safe-integer addition and exact BigInt figures/words formatting. An out-of-range aggregate withholds the total rather than rounding it.

The dashboard reads all invoice metadata and all native balances to an empty page inside one financial-stamp boundary. A failed page, duplicate identity, missing native balance, balance/document amount mismatch, unexpected external balance or stamp change withholds totals. The existing GBP summary is explicitly native-only. A separate section shows original amounts in figures and words per currency and the external settlement coverage count. Recent external or unsupported rows have an evidence-review link and an unavailable settlement message; they create no native Storage signatures, edit/download/delete controls, email/chase controls or paid/reminder forms. Existing server/API guards remain authoritative for direct requests.

Projects read complete paged invoice/record sets within a financial-stamp boundary. Project invoice commitments are grouped by original currency and draft/finalised state; recognised income, expenses and budget remain GBP. Invoice totals are unavailable when their metadata is invalid. External invoices are excluded from the ordinary project-tag picker. The direct tag action also rejects them, checks authentication/owner reads and conditions native updates on origin, currency and the retained update timestamp, requiring a returned row before success.

## Verification

Six reporting model/page/action tests cover GBP/USD/JPY/KWD and preserved external GBP, figures/words, draft separation, exact large totals, invalid metadata, duplicate identities, missing/mismatched native balances, complete paging, late read failures, stamp drift, external Storage/control containment, separate project ledger income and direct external/stale tagging rejection. These use inert database/Storage/provider fixtures; external projections are synthetic and cannot be inserted through the production native-only schema.

The existing FX read-back tests also run after introducing aggregate formatting. No historical invoice values, retained request payloads, snapshots or artifact bodies are rewritten.

## Before external enablement

The GBP balance view must explicitly exclude external rows. The reporting summary deliberately rejects any external row in that native reader; it does not invent a zero balance. Complete the dimensioned settlement balance reader and its original-unit/cash/valuation semantics before presenting foreign outstanding totals. Native eligibility and original metadata must remain immutable or update the financial consistency stamp when canonical external writes become possible.

Still required: versioned complete reconciliation/backup exports, review/quarterly/tax/filing/finance coverage, containment of parked native-only consumers, guarded one-family external capture/correction, conversion lots, FX settlement/reversal, fees, foreign accounts and refunds/credits. See [native-invoice-boundary.md](native-invoice-boundary.md). No Phase 4 capability is added by this step.

No hosted schema change, real financial approval, send, bank connection, payment, deployment or filing is performed. Hosted authenticated/Storage acceptance and independent tax/form review remain outstanding.

Checkpoint: 424 automated tests and all 11 existing browser suites passed; final refinements passed 32 focused tests. Lint, secret/whitespace checks and clean production build/TypeScript passed. Anonymous production dashboard/projects/login returned 307/307/200; the temporary server was stopped. These local checks do not prove hosted authenticated or real evidence access.

The reconciliation export prerequisite now has a version 3 document/currency projection; see [currency-reconciliation-export.md](currency-reconciliation-export.md). It still rejects external financial relationships, and does not complete partial-account backup or FX settlement exports.

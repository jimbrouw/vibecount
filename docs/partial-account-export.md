# Versioned partial account export

18 October 2026. Hardens the existing `/api/backup/export` route without presenting it as a restorable backup. No import, invoice, classification, tax or financial approval is performed. Canonical external invoices remain disabled.

## Scope and exact data

Downloads now use `vibecount.partial-account/2`, with a version header, explicit scope/omissions, table counts, selected data and reproducible `data_sha256`. The data comprises settings, clients, invoices, financial records, reminder **status metadata**, and invoice revision **metadata**. It includes approved, review, excluded and draft records; payment/delivery markers may be manual assertions. Original invoice amounts are separate from received or recognised cash. Financial records are explicitly GBP.

Each table has an explicit allowlist in `lib/records/account-export-fields.ts`. A second application projection rejects missing, unsafe or foreign rows and strips unexpected database fields, even if a query fixture or future schema returns them. Included client/invoice relationships must resolve within the complete selected data. New database columns never automatically enter the export.

Exact decimal money/rates and integer minor units are strings; null stays null and stored zero never becomes a default. Invoices preserve native origin/GBP amount or preserved-external original units/ruleset/source revision/family with a null GBP compatibility amount. Unsupported or contradictory representations reject the export. Invoice revision metadata includes available PDF hashes and source identities, but excludes the generic economic/source snapshots and paths. It cannot reproduce an invoice's historical body or prove external source eligibility.

Excluded: Companies House/provider credentials, bank details, UTR, storage/logo/PDF paths, provider IDs/errors, raw reminder subject/message, raw source-reference text, generic revision snapshots, attachments, import/evidence/decision histories, settlement/credit/refund histories, project/category parent tables, keys and recovery configuration. VAT registration details remain selected business settings. Contextual parent/source IDs do not make the omitted tables or evidence recoverable. Reminder metadata is not a durable delivery outbox.

The existing bank-number redactor applies to selected free text, and the artifact discloses that transformation. Original stored evidence is untouched. Regex redaction is not a guarantee that every kind of personal information is removed; this is selected account data, not an anonymised public artifact. The retained data hash covers the exported, transformed data, not a signature or independent proof of original authenticity.

## Consistency and migration

`20261018170000_partial_account_export_context.sql` adds only the read-only `read_partial_account_export_context()` function. It is `SECURITY INVOKER`, authenticated-only, derives owner from `auth.uid()` and rejects absent authentication. Its sorted, owner-filtered projections match all six application allowlists. The SHA256 and per-table counts include the contract version. Secrets, paths and generic snapshots never enter these SQL projections. No existing row, history, artifact, financial stamp or financial state is rewritten.

The previous reconciliation stamp does not cover settings, clients and reminder changes, so it cannot establish this export's completeness. The new route checks its dedicated context before and after **all** paged reads. Every collection reads until an empty page; lower server caps do not imply completion. Missing context migration, failed pages, owner mismatch, duplicate identities, count mismatch, changed context or failed audit withhold the entire response. Successful downloads use `Cache-Control: private, no-store`; the audit count includes every included row.

This is optimistic before/after consistency checking, not a PostgreSQL transaction snapshot. Very large accounts may exceed query/runtime resources. Complete JSON output is checked against 4,000,000 UTF8 bytes before response/audit; oversize yields an unavailable response, never a partial artifact. Large-artifact delivery and an atomic frozen capture, if required, remain separate work.

Deploy/rehearse the ordered migration chain before the route; missing context fails closed. There are now **57 local migrations, including 32 untracked additions**; hosted history remains unknown. Rollback disables or returns the application route to a compatible version while preserving evidence/history. Do not drop immutable populated financial tables or expose entire database rows as a fallback. No hosted migration was applied here.

## Verification and demonstration

Focused model/route/SQL checks exercise actual predecessor replay and unchanged rows; authenticated/anonymous/service grants and two-owner isolation; changes to all six tables; SQL/application projection equality; explicit privacy omissions; exact zero/decimal/minor/null values; external GBP/USD/JPY/KWD projections; complete smaller-cap paging beyond 1,000 rows; missing context, late failures, drift, failed audit and oversized output. External projections are synthetic; native-only production constraints still reject actual external captures.

Run `npx tsx scripts/demo-account-export.ts`. The actual ordered-SQL, authenticated-owner demo writes `/tmp/vibecount-account-export-demo/partial-account.json`, a SHA256/count manifest and README. Its draft invoice GBP 120.00, draft record GBP 30.01 and stored VAT rate 0.00 remain exact. It creates only disposable synthetic drafts, with zero real financial approval, source document, external invoice, bank connection or hosted interaction. This is not a recovery rehearsal.

## Remaining handover work

The account export does not satisfy the coordinated database/object/key restore requirement, evidence retention/deletion operations or full historic reconciliation. Before external enablement, still complete native balance-view isolation, review/quarterly/tax/filing/finance coverage and containment of parked consumers, then guarded canonical capture/correction. FX financial lots, dimensioned settlement/reversal/reporting, foreign accounts, fees/refunds, communications recovery, representative provider/hosted acceptance, independent tax/form review and release isolation remain required.

Checkpoint: 445 automated tests, all 11 browser suites and the 11 focused model/route/SQL checks passed. Lint, secret/whitespace checks and clean production build/TypeScript passed. Anonymous production backup/settings/login returned 401/307/200; the temporary server was stopped. Hosted authenticated acceptance remains outstanding.

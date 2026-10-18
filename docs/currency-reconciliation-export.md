# Currency-aware draft reconciliation export

18 October 2026. Reporting prerequisite for the [foreign invoice plan](fx-foreign-invoice-plan.md). This step adds no migration, financial writer, canonical external capture or FX settlement. External canonical invoices remain disabled by the existing native-only SQL constraints.

## Artifact contract

`/api/reconciliation/export` now emits `vibecount.reconciliation/3`. The schema is explicit in the response header and every data row. Existing financial pence columns retain their GBP meaning. Their rows also state `value_currency=GBP`; they cannot contain an external invoice relationship, including preserved external GBP. Original invoice document amounts have a separate currency/minor-unit representation.

One `invoice_document` row per finalised invoice contains the original amount, figures and words, origin, currency ruleset and source fact family/revision. It is a document value, not another balance, cash receipt or accounting posting. Original totals appear only on these rows, avoiding repeated original totals across every financial event. Draft invoices are outside this export scope. Do not sum different row kinds as turnover.

External document rows leave **all** legacy pence fields blank and declare settlement/GBP valuation unavailable. Their source revision must be owned, verified and backed by the original-read attestation, match the canonical family/currency/original amount/date and retain an invoice-purpose registration. The export includes the retained source document ID and SHA256. It does not claim current access, successful decryption or latest source eligibility. A later lost object or withdrawn latest family state does not rewrite captured historical facts. Native documents identify their canonical invoice; this export does not invent a missing historical PDF hash.

Current invoice document totals and retained settlement snapshot gross/currency have separate fields. Exporting a current total never rewrites the historical event snapshot. Shared refund cash-once, portions, active portions, returned cash, credit and assignment semantics remain unchanged. All rows retain **Draft — not submitted to HMRC**.

`reconciliationExport` retains the version 2 serialization contract. Its row-building code is extracted into `reconciliationExportTable` so V3 can add dimensions to raw cells, avoiding unsafe CSV splitting, source-import parser size limits and double formula escaping. A frozen synthetic V2 CSV, SHA256 and input captured before the extraction prove byte compatibility. Existing saved artifacts are not regenerated.

## Complete reads and failure behavior

The authenticated route owner-scopes and pages every dataset through an empty page within the existing before/after financial stamp. Captured evidence is fetched by deduplicated revision IDs in batches of at most 100, each independently paged; it does not use capped nested history arrays. Exact native finalised balance coverage, identities, units and amount equality are required. Missing or contradictory evidence, duplicate canonical source families, unsupported relationships, failed pages, stamp drift and failed export audit withhold the entire CSV. Audit count includes document rows.

Complete output is capped at 4,000,000 UTF8 bytes before responding. Oversized output returns an unavailable error, with no partial artifact or successful export audit. Large-artifact alternative delivery and hosted acceptance remain separate work; this limit is not a claim of unrestricted export capacity. No current backup/export format is a database/object/encryption-key restore package.

## Verification and demo

Model and route tests cover frozen V2 bytes; multiline/formula quoting; native GBP, external GBP, USD, JPY and KWD; document/cash separation; retained source ownership/hash and privacy projection; missing, duplicate or contradictory metadata/balances; unsupported external relationships; retained history after access loss; shared refund cash-once parity; oversized output; auth, stale reads and failed audit. A smaller server page cap exercises more than 1,000 invoices and more than 100 source revisions without omissions.

Run `npx tsx scripts/demo-currency-reconciliation-export.ts`. It writes a five-row V3 CSV, manifest with SHA256 and scope README to `/tmp/vibecount-currency-reconciliation-demo`. Every identity, source hash, human attestation and relationship is synthetic. It makes zero database/financial writes and does not prove a readable original, external capture or hosted acceptance.

## Remaining enablement dependencies

Before external capture: make the native balance view explicitly native-only; implement dimensioned settlement balances; complete review/quarterly/tax/filing/finance coverage and parked consumer containment; finish complete versioned partial-account exports. Before FX financial writes: add original-unit/cash/GBP valuation lots, source guards, coordinated reversal/refunds/fees and corresponding dimensioned financial export rows. V3 deliberately rejects external financial relationships until those semantics exist. Preserve V2 bytes and retained snapshots as new paths are added.

Hosted PostgREST/grant/Storage checks, representative source-provider acceptance, readable retained-source operations, independent tax/form review, communications recovery and release isolation remain outstanding. No hosted migration, bank connection, real approval, send, payment, deployment or filing occurred.

Checkpoint checks: 434 automated tests and all 11 browser suites passed; the 14 focused export/route checks also passed independently. Lint, secret/whitespace checks and clean production build/TypeScript passed. Anonymous production export/reconciliation/login returned 401/307/200, and the temporary server was stopped.

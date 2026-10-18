# Tax and filing bank source coverage

Local implementation, 18 October 2026. This extends the [containment plan](foreign-source-containment-plan.md); foreign-source admission remains closed. It does not certify tax treatment or complete the handover.

## Contracts and scope

Tax input `tax-calculation-input/3` retains invoice coverage and complete owner-wide bank source context. Its blocking scope is the selected cash tax year plus explicit connected ledger/fact sources. Unrelated discarded observations remain context. A discarded source explicitly linked to an effect remains a blocker. Original currency units, valuation date and reviewed valuation amounts never replace recognised GBP cash or move the source cash date between years.

The shared `lib/tax/bank-source-coverage.ts` parser validates every tax observation against the complete source identity: account/import/row, cash date, currency, file and row hashes, classification/dedupe/decision version, import state and nullable signed GBP cash. Supplied original-unit aliases must match. Duplicate observation IDs, missing connected IDs and omitted active native year sources reject the input. Coverage cannot silently omit a native Unknown or repeat an exported effect.

Unsupported representations, missing source closure or missing Storage metadata withhold all eight dependent totals: trade profit, taxable trade profit, Income Tax, Class 4, assessed liability, net balance, each payment on account and combined January amount. Missing inputs are not zero. Reviewed and reviewed-zero foreign valuations remain unsupported during containment; they have no posting effect. Metadata availability is not proof that ciphertext can be read or decrypted.

Filing input `filing-pack-input/4` produces `draft-filing-pack/5`. It preserves existing invoice/FX provenance and binds complete bank coverage into every step digest. Current calculations require exact current input V3 equality. All filing observations are checked against source identity and year, including discarded context. Explicit cross-year filing connections remain in blocking scope.

All seven artifacts remain draft. The normalized ledger retains original units, representation, source availability and valuation metadata, with additional complete owned source context labelled separately from recognised financial-record effects. Calculation trace and evidence manifest retain full coverage. Unlike currencies are never summed as cash. Saved verification recomputes the ledger and checks coverage in retained trace/manifest; changing outer hashes cannot legitimize contradictory artifacts or optimistic completeness.

## Database compatibility and concurrency

Migration `20261019120000_tax_bank_source_coverage.sql` copies private predecessor input builders and replaces current bodies in place. Public OIDs, grants, older input/result/artifact bytes and exact completed-request recovery are preserved. Fresh captures require the new versions. Prior requests recover before current source, coverage, size or version checks.

SQL independently rejects optimistic tax status, non-null or missing withheld totals and filing completeness for blocked scope. New inputs/results have a four MB bound. Capture freezes include the inherited financial review dependency set, bank sources/valuation histories/Storage metadata, invoice balance histories and additional tax/category/classification/source/document/merchant/FX dependencies. Filing pack capture also freezes step reviews. Capture destinations are not globally SHARE-locked, avoiding cross-owner destination lock upgrades.

Actual independent-connection tests cover source deletion and valuation writes against capture in both commit orders, stale preview rejection after waiting, exact retry after source loss, ten dependency-table phantom lock conflicts and concurrent two-owner captures. The ten lock probes are not ten separately executed financial mutations. Upgrade tests preserve predecessor tax V2/filing V3/bundle V4 bytes and recovery, and exercise current SQL withholding, grants and year/connection/discarded scope parity.

## Synthetic demonstration

Run `npx tsx scripts/demo-tax-bank-coverage.ts`. Output is `/tmp/vibecount-tax-bank-coverage-demo`: report, current retained bundle, all seven exported artifacts and a hash/size manifest. The demo applies the ordered 75-migration predecessor, captures actual old snapshots, then applies migration 76 inside a disposable transaction. Temporary foreign admission relaxation is confined to that transaction.

Seven source states cover unvalued, provisional, reviewed, reviewed-zero, stale, withdrawn and unrelated discarded context. Every retained bundle is V5; recognised income remains the same synthetic GBP 1.00. Old and current requests recover exactly. Nine manifest files were independently checked against their SHA-256 and byte size. All synthetic rows and the target upgrade DDL roll back; closed GBP constraints/non-null pence and zero retained financial/capture rows are verified afterward. There are no real bank sources, provider calls or financial approvals.

## Acceptance still required

This checkpoint preserves historical compatibility and exposes unsupported scope. Finance V3, remaining native event-only writer guards, standalone dimensioned exports, guarded foreign ingestion, verified readable evidence, human valuation/classification/posting and correction/reversal remain next. Foreign transfers, fees and cross-currency refunds/credits need complete treatment. Hosted Auth/PostgREST/Storage, representative provider exports, historic source completeness, coordinated database/object/key restore, release isolation and independent annual tax/form review remain separate acceptance gates.

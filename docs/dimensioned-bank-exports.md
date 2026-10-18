# Bank source downloads with explicit currency dimensions

Current extension: bank context `/2`, ledger `/4`, evidence manifest `/5`, and reconciliation `/6` now include complete foreign classification history. The foreign decision download uses `vibecount.foreign-decision-ledger/1`. Every foreign decision closes over its immutable request/result and specific retained valuation revision; the exporter independently recalculates the business share and verifies the current canonical financial record. Missing versions, mismatched source/owner, changed canonical identity or altered amounts stop the download. Original foreign units remain separate from recognized GBP effects.

Current focused verification: 11 SQL/model/route tests, TypeScript and focused lint pass. The actual SQL lifecycle covers Business → Mixed → Unknown → reviewed zero → import reversal, including evidence loss and retained excluded records. Tax/filing coverage integration remains pending; these standalone export versions do not alter captured tax or filing schemas. The earlier checkpoint below documents the preceding export increment.


The current import download route uses evidence-ledger/3 and evidence-manifest/4. The current reconciliation download uses reconciliation/5. Retained earlier serializers and saved filing-pack formats keep their existing contracts.

All selected-import observations are exported, and reconciliation includes all owned observations: outgoing cash, Personal, Unknown and discarded rows remain visible. The raw inventory must match complete bank coverage independently of the positive-receipt view. Reconciliation retains the existing invoice/FX relationship rows and adds one `bank_source_observation` row per source. Receipt allocation rows explicitly refer to this same cash; summing both row kinds would double count it.

Original currency, exponent, minor units and ruleset remain separate from nullable actual signed GBP cash. Recognised GBP accounting effects carry their own bucket, magnitude, sign, status, category/project and refund ancestry. Foreign effects require an explicit accounting bucket; neither sign guessing nor a valuation creates a posting. Native original cash remains in its native pence field; a blank foreign cash field means unavailable, not zero.

Every observation retains account/import/file/row identifiers, safe hashes/parser metadata, review status and exclusion/duplicate links. The ledger also includes normalized descriptions/references with CSV escaping. Manifests exclude those narrative fields and all raw bytes, encrypted rows, storage paths, keys and original filenames.

Valuation revisions retain documented rates, calculation provenance, evidence registrations, state, author and request history. The existing immutable family history plus authoritative head ordinal proves expected revision count: export validates contiguous ordinals, predecessor links, head equality, economic source IDs/hashes/parser/ruleset and exact original units. No new database table or migration is required. Reviewed zero, provisional, stale and withdrawn states remain distinct.

Downloads bracket their complete reads with bank coverage, account metadata, financial stamp and the safe registered-evidence catalog. This includes current document metadata for provisional and withdrawn history; latest-head `source_current` alone would not detect every change. Retained evidence registration and current catalog registration are separate, since the catalog can select a later invoice-purpose registration. Object metadata availability does not certify readable/decrypted original bytes. Source-file IDs are read through owned imports; the private source-file table stays privileged.

Reads preflight authoritative revision counts and bound raw/history page counts and byte sizes. Complete output is limited to 4 MB. Changes or incomplete pages fail before the export audit and download. Snapshot hashes use recursively sorted canonical JSON and bind the bank context plus retained FX history in manifests. Ledger context hashes identify the corresponding bank snapshot, excluding ledger-only narrative columns. These are live snapshots, not promises of later byte-identical regeneration or authenticity signatures.

## Reproduce

```sh
npx tsx scripts/demo-bank-dimensioned-exports.ts
```

The demo writes `/tmp/vibecount-bank-dimensioned-exports-demo/{ledger.csv,evidence-manifest.json,reconciliation.csv,report.json,manifest.json}`. Actual disposable SQL produces two retained KWD valuation revisions, including reviewed zero; the original remains KWD -10.001, actual GBP cash remains null and recognised expense remains zero. All synthetic rows and admission relaxation roll back. This pure serializer demo does not capture current document metadata; production route tests additionally exercise the catalog bracket. Manifest byte sizes and hashes were independently verified.

Focused actual-SQL/model/current-route tests cover retained histories, owner/source identity, omitted observations/revisions, exact zero/stale/withdrawn states, capped pagination, source/document drift, CSV injection, existing FX history and failed audit writes. The implementation adds no browser controls or financial mutations. Hosted PostgREST embedding, authenticated download acceptance and representative provider evidence still require the designated test environment.

The complete regression run passed 760 tests; 15 focused tests passed after final adjustments. The clean production build passed. The existing 18 browser suites were not repeated for this API/serializer-only change. Final verification logs are under `/tmp/vibecount-bank-export-*`.

Foreign bank admission, reviewed posting/correction/reversal, readable original evidence, fees and cross-currency transfer/refund/credit treatment remain subsequent work. This export completion alone does not enable those workflows.

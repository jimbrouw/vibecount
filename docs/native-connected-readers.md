# Connected source review: read-only SQL envelopes

Local migration `20261019150000_native_connected_review_context.sql` implements the database portion of [the connected-reader plan](native-connected-reader-plan.md). **Current pages and actions still use their V2 readers.** This checkpoint does not claim user-facing V3 containment, foreign ingestion or a complete connected-review workflow. The next increment must integrate strict parsers, source read-back, confirmation freshness and current action checks together.

## Existing models and compatibility

No ledger, event or request table is added. Existing V1/V2 reader bodies/OIDs/ACLs and every financial writer stay unchanged. The native split projection is copied privately with an explicit eligible-ID predicate inserted before its CTE's arithmetic; the migration checks both expected source anchors and aborts on drift. The public original remains intact for historical dependencies. Admission remains GBP-only.

New authenticated read-only entry points:

- `read_refund_reversal_graph_v3(kind,id)`
- `read_source_import_reversal_context_v3(import)`
- `read_refund_split_catalog_v3(refund_transaction)`
- `read_refund_assignment_context_v2(allocation,refund_link)`

Public readers derive ownership from `auth.uid()`. All new source/graph/predicate/projection helpers have execution revoked from public, anonymous, authenticated and service roles. The stable source helper performs no writer locks or mutation. Complete distinct IDs, exact owned-row parity, 20,000-source and 2 MB payload bounds fail closed; split inventory additionally retains its 10,000-row bound. No partial graph is returned.

## Scope and meaning

The private source context independently retains account type/currency, exact nullable native/original units, source/account/import/row identity, file/row hashes, parser and classification versions. It separates source completeness, native eligibility and Storage metadata availability. Missing Storage metadata changes the source digest but does not prevent otherwise valid native historical cleanup. Original units and native cash are never interchangeable. The additional source SHA-256 digest accompanies the existing 32-character financial stamp; it does not replace writer intent contracts.

Refund reversal discovers raw selected/import roots and active refund links transitively in both directions. Import eligibility starts with every target observation and every import-linked effect's bank endpoint, including draft effects, then follows both active transfer/refund edges recursively. Missing/cross-owner endpoints survive discovery and fail owned-row parity rather than vanish through joins.

Import eligibility is intentionally broader than its retained operation projection. The legacy operation closes refunds from target rows and transfers directly touching the target; its expected transaction IDs are derived independently and checked against the unmodified native context. Eligibility sources are not all claimed to receive accounting effects.

Closure/import contexts are null whenever either native eligibility or FX dependencies blocks. Native predecessor functions are invoked only after those checks. Unsupported sources remain safe metadata, not guessed native totals.

Split inventory includes the selected source, opposite-sign eligible natives and every unsupported/invalid source, including null-pence foreign observations. Native projection IDs are selected before native calculation. An unsupported selected refund has no native context. Unrelated unsupported or FX-linked candidates remain visible without blocking a valid native selection; FX candidate restrictions remain separate per-endpoint data for the subsequent UI integration.

Assignment preparation resolves the actual active native allocation and matching owned refund link. It validates both the original receipt and returned-cash source, rather than only the original allocation endpoint. The historical one-endpoint FX reader remains unchanged.

## Tests and demonstration

`lib/database/native-connected-readers.test.ts` stages the actual predecessor schema and real synthetic reviewed native requests before applying the migration. It compares retained function definitions/OIDs/ACLs, financial history and exact request results. Native nested contexts match predecessor SQL JSON text. Real split approvals build the transitive graph; mixed transfer/refund corruption is explicitly confined to rollback-only fixtures because valid current writers cannot create that overlap.

Checks cover unsupported selected/sibling sources, null native cash, foreign-account GBP-looking rows, import-linked draft roots, missing account/source endpoints, cross-owner endpoints, read-only transaction execution, Storage loss, account-type digest changes, separate zero-cash FX blockers, private role permissions and complete-result bounds. Poison predecessor functions prove blocked paths cannot invoke native arithmetic.

Run `npx tsx scripts/demo-native-connected-readers.ts`. The disposable predecessor upgrade emits five actual contexts: native closure, native split with unrelated foreign candidate, foreign selected refund, unsupported connected sibling, and affected import. Native JSON parity, exact KWD 10.001/null native cash, withheld contexts, unchanged financial history and exact completed-request recovery after account corruption are asserted. All fixtures and target DDL roll back; closed admission and empty retained bank/record state are rechecked. `/tmp/vibecount-native-connected-readers-demo` contains contexts/report and a hash/size manifest. Metadata is not readable hosted evidence.

Final verification passed **740 automated tests and all 17 browser suites**, lint, standalone TypeScript, secret/whitespace checks and a clean production build. Anonymous production smoke returned login 200, split/refund-reversal/assignment/import-reversal pages 307 to login and reconciliation/records exports 401; the server stopped and its port closed. The large embedded payload/catalog stress took about 124 seconds; hosted performance remains an acceptance risk. See implementation progress for full scope. Hosted grants/Auth/PostgREST/Storage and signed-in journeys remain unproven. No hosted migration, bank connection, real financial approval, provider call, send, payment, deployment or filing occurs.

## Integration still required

Current stores must consume only V3 for current preparation while historical parsers/readers stay explicit. Validate exact source counts/stamps, source/native parity and distinct operation/eligibility sets before exposing financial forms. Display native blockers and FX blockers independently, with original units and exact source links. Split forms must preserve unsupported inventory without placing it in native arithmetic. Confirmation must reset on source-context changes, and actions must compare the reviewed source context after retained-request recovery. Complete those routes and their real rendered/browser tests before describing these SQL envelopes as a user-facing feature.

Standalone dimensioned bank exports and the full guarded foreign source/evidence/valuation/classification/posting/correction flow remain subsequent work. Source metadata, these readers and existing private valuations cannot substitute for that workflow.

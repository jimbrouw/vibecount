# Connected source review checkpoint

Current refund split, refund reversal, import reversal and refund assignment pages/actions consume the bounded source-aware SQL envelopes. `lib/records/native-connected-store.ts` validates ownership, source counts, exact native projection membership, separate FX blockers and financial stamps. `native-source-context.ts` reconstructs safe metadata; private transport properties are not forwarded.

Forms bind a separate source SHA-256 digest. A source-only change resets confirmation and fresh actions reject missing, duplicate or stale digests even if the financial stamp is unchanged. Completed owned requests recover first through unchanged financial intents and existing SQL fingerprint checks. Historical V2 readers remain available for explicit replay tests.

The source scope component distinguishes native eligibility, source metadata availability and accounting operation scope. Unsupported selections/connected sources retain original units and source links with no native financial form. Unrelated unsupported split candidates remain visible without blocking a valid native selection. Metadata availability does not certify readable original bytes.

Migration `20261019160000_native_source_parser_eligibility.sql` tightens the private source predicate to require parser/hash metadata. The preceding normal ingestion constraints already prevent missing parser metadata; the corruption test relaxes that constraint only inside a disposable rollback. Function identity and privileges are retained. This is migration 80 locally; no hosted migration was applied.

Verification: 757 automated tests, all 18 browser suites and the 31-test focused group passed. Tests cover actual SQL envelopes, actual page/action modules, source-only confirmation reset, exact unsupported units, fail-closed malformed contexts and old completed requests without the new form field. Independent read-only review found no substantive blocker. Lint, secret scan, whitespace checks, clean production build and TypeScript passed. Synthetic fixtures and inert browser actions do not establish authenticated hosted acceptance.

Run `npx tsx scripts/demo-connected-source-ui.ts` from the repository. It produces `/tmp/vibecount-connected-source-ui-demo/readback.html`, contexts, report and hash/size manifest. Four current stores read actual disposable SQL; seven rendered states show native review and unsupported-source handling. Financial history is unchanged; all fixtures and target DDL roll back. The manifest was independently verified. HTML forms are inert demonstration controls.

See [runnable checkpoint and remaining scope](handover-checkpoint.md) before further implementation. Full foreign ingestion/posting, dimensioned standalone exports and the remaining handover acceptance work are unfinished.

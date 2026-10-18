# Containment of existing parked financial readers

18 October 2026. Compatibility hardening of four already-existing read endpoints. Phase 4 remains parked: no new endpoint, scope, authentication feature, draft capability, MCP financial action or external-currency support is introduced. No migration is added.

## Existing defects and resulting behavior

The existing invoice list converted any compatibility amount through floating-point arithmetic without selecting currency or origin. Null external amounts could appear as zero GBP. It now selects the complete native representation, validates explicit owned native GBP identity through the shared reporting guard and converts the exact decimal amount. External GBP, foreign and malformed metadata cause an unavailable response for the whole selected list; unsupported rows are not silently filtered away.

The existing expense/uncategorised lists omitted `effect_sign`, showing customer/supplier refunds as positive amounts. They now return the signed recognised GBP effect through the shared accounting helper. Positive ordinary records retain their old values and fields. A GBP 30.01 supplier refund is -3,001 expense pence. These are canonical recognised records, not bank observations or foreign invoice originals. Missing signs, malformed precision and unsafe magnitudes are errors.

The existing quarterly P&L view already sums `amount * effect_sign`; its reader now parses those signed totals exactly without applying a second sign. It checks quarter identity, owner/year, uniqueness, nonnegative safe counts, net arithmetic and exact result count. Null totals do not become zero. An empty successful owned query remains distinguishable from a failed/truncated read. The existing estimate caveat remains; no tax/source completeness claim is added.

## Shared read boundary

`lib/mcp/read-boundary.ts` supplies validation/projection only for these existing readers. Internal owner and currency metadata are not added to the response. Related client/category names must be owned, or explicitly public default categories; object/single-array joins normalize safely. Display labels/descriptions use the existing bank-number redaction helper. Pattern redaction is not proof of comprehensive PII removal; these routes select no raw source files, encrypted rows, object paths, keys or original evidence.

Invoice/expense limits retain their existing defaults and maxima (20/50 and 50/100). Malformed, repeated, fractional, nonpositive or excessive limits reject before query. Invoice status accepts only draft/finalised. Lists remain bounded selections, not complete ledgers or exports; returned `count` is the selected count. The quarter query requests an exact count and withholds mismatched coverage.

Every financial read checks database errors, owner/identity and projection validity before returning private/no-store data. Audit insertion returns an explicit success boolean; these read endpoints require success before releasing data. Existing drafting callers retain their prior behavior and are not made retry-safe by that boolean. Missing configuration, failed queries, unsupported representations and failed read audits return generic 503 responses without source rows or provider diagnostics. Existing token/scope denial behavior is retained.

## Acceptance and release limits

`lib/mcp/read-boundary.test.ts` bundles the actual four routes against inert authentication/database fixtures. It proves native wire values/zero drafts, external GBP/USD/JPY/KWD and invalid metadata denial, exact signed refunds, owner/related-owner checks, unchanged positive values, quarter arithmetic/count/uniqueness, bounds, auth denial, genuine empty results, database exceptions/errors and failed audit withholding. The real audit helper is exercised separately against a failed insert. No test creates a real agent session or financial record.

Run `npx tsx scripts/demo-parked-read-containment.ts` to write pure synthetic native/refund/quarter projections and external rejection assertions to `/tmp/vibecount-parked-read-demo`. It makes no database or provider connection; route behavior is tested separately.

Checkpoint verification: 490 automated tests, lint, standalone TypeScript, secret scan and clean production build passed. Independent read-only review found no blocker and reran the seven route tests. Anonymous production reads returned 401 for each changed endpoint; login returned 200, and the temporary server was stopped. No UI changed; the preceding 12 browser suites were not rerun. Prior ignored build output was preserved. These are local checks, not hosted signed-in acceptance.

These changes contain existing financial read assumptions before canonical external capture. Hosted auth/grants, session and audit-list behavior, comprehensive privacy/consent and Phase 4 release scope remain unverified. Existing parked draft-invoice input/partial-write/idempotency issues remain; `draft-record` uses a source type unsupported by the current schema. Do not enable either workflow or expand its schema as part of this containment. Future work needs a separate reviewed Phase 4 plan.

No external invoice canonical row, conversion lot, FX settlement, financial approval, real provider call or hosted deployment is enabled. Full handover work still requires strict external capture/correction and dimensioned financial integration, evidence lifecycle/recovery, durable communications, representative provider/hosted acceptance, independent tax/form review and release isolation.

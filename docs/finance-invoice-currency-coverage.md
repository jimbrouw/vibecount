# Finance plan invoice currency coverage

18 October 2026. Local compatibility prerequisite; external canonical invoices remain disabled. This does not complete M6 or the full handover.

Current successor: [finance bank coverage V3](finance-bank-coverage.md). The V2 contracts and verification below describe the retained historical checkpoint.

## Meaning and versions

Current finance context, snapshot input and result use version 2. The owner-derived context carries the shared complete invoice currency coverage projection and binds it into the context stamp. Native finalised invoices, unsupported external invoices (including external GBP), invalid representations and drafts have separate counts. Original invoice units are document amounts, never cash or GBP valuations. Invoice issue dates do not establish cash-basis tax-year income.

`lib/finance/coverage.ts` wraps the unchanged manual GBP planning engine. The nested scenario, planning rules and selected source metadata retain their original meaning. Unsupported or invalid coverage makes the effective result incomplete and sets current free cash and additional drawings to null. The UI shows these as unresolved and labels entered balances, assumptions and projections as a manual scenario. Pension assets remain outside accessible cash. Complete invoice coverage does not verify balances or establish complete commitments.

The shared `InvoiceCurrencyCoverage` component shows complete counts and bounded unresolved examples. Coverage changes reset confirmation. Missing or malformed coverage prevents preview/save; an explicitly reviewed incomplete plan can still be saved as a draft. Linked bank/card sources must be GBP and appropriate to the asset kind.

Old input-v1 snapshots replay through the retained engine without current data. Current input-v2 snapshots replay against their frozen coverage, date, sources and rules. Hash validation alone is insufficient: verification recomputes the result. Legacy exports keep their old payload; current exports include retained coverage. Exact completed requests recover before live context/date reads. Historical plans are labelled with their saved date and cannot establish current drawings availability.

## Database and migration

`20261018210000_finance_invoice_currency_coverage.sql` follows the complete ordered migration chain through tax/filing coverage. It extends the input-version check, retains the original private context builder and wraps it with current coverage. It does not update saved rows or rules. Private helpers remain unavailable to app/service roles; authenticated reads derive owner, and capture remains service-only.

Fresh capture takes the existing owner reconciliation lock plus `SHARE NOWAIT` table locks on accounts, evidence documents and invoices. The full current context, exact input/result envelopes, source closure, ordinal and coverage must agree. SQL independently enforces coverage eligibility and null gated amounts; deterministic application preparation and retained replay verify scenario arithmetic. Account/document/invoice phantom writes are tested in both commit orders. Stale previews, optimistic forged results, missing gated fields and forged coverage reject atomically.

Deadline plans consume explicit obligations in the retained finance input. They do not turn nested scenario forecasts or withheld drawings into tax bills or reminders. No deadline model or financial posting is changed by this extension.

Before hosted rollout, inspect linked migration history, isolate the release, rehearse complete empty/upgrade replay and coordinated database/object/key recovery, and prove actual Auth/PostgREST/Storage behavior. Local tests do not establish hosted grants or readable source objects. Existing table-level locks may reject a capture during another owner's write; assess load before release. To withdraw the feature, disable current capture/UI entry points while retaining immutable rows and rules.

## Reproduction and acceptance

Run `npx tsx scripts/demo-finance-invoice-coverage.ts`. Actual predecessor SQL captures a legacy v1 plan, applies the forward migration, captures native v2, then captures an incomplete v2 result with four hypothetical external currencies and invalid metadata. Exact old/new request recovery and snapshot replay are asserted. JSON artifacts are written to `/tmp/vibecount-finance-invoice-coverage-demo`.

External candidates exist only in a privileged rolled-back corruption fixture. Synthetic GBP 30,000 cash and GBP 43,055 pension values are not defaults or bank-verified facts. Source IDs, PDF/object metadata and hashes are placeholders, not proof of readable originals. The demo leaves zero financial records and enables no external canonical rows.

Verification for this checkpoint: 483 automated tests, all 12 browser component suites, lint, standalone TypeScript and secret scanning passed. SQL upgrade, owner/anonymous/private grants, unchanged scenario/rules/history, exact retries, stale/forged capture, independent-connection races, route integrity and confirmation reset are covered. A clean production build including TypeScript passed with non-production public Supabase placeholders; prior ignored output was preserved. Anonymous production finance/deadline pages redirected to login (307), export denied access (401), and login returned 200. The temporary server was stopped. These are local anonymous checks, not a signed-in hosted journey.

Remaining work includes parked-consumer containment, strict canonical external capture/correction, dimensioned FX lots/settlements/reversals/exports, foreign accounts, fees/refunds, evidence lifecycle and restore, durable communication recovery, representative provider and hosted acceptance, independent tax/form review and release isolation. This extension creates no real approval, bank connection, provider call, send, payment or filing.

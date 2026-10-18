# Foreign source containment and complete coverage

Next stage of the [foreign-account valuation plan](foreign-account-valuation-plan.md), after private migration `19090000`. Foreign admission remains closed throughout this work. The full destination is operable foreign ingestion/valuation/classification/posting/export/reversal; a permanently blocked foreign branch is not completion.

## Current implementation checkpoint

Migration `19100000` and [bank-source-coverage.md](bank-source-coverage.md) implement raw owner-wide coverage, source currency read-back and initial native classification/merchant/tax-source/ingestion fences. Native imported-source recovery, old function identities/grants and direct-posting restrictions are preserved. Import, merchant-memory and tax-fact pages now withhold unsupported native controls and totals. This completes the initial coverage/UI portion of step 1, not all native consumer containment. Event-only writers and the remaining finance/export/foreign workflow remain required before admission.

Migration `19110000` now implements [operational review V2](operational-bank-coverage.md): distinct raw-source unresolved coverage, explicit unsupported/unavailable year/quarter counters, complete context-bound stamps and service capture freezes. Historical V1 stays explicit replay. Migration `19120000` also implements [tax V3 / filing V4 / bundle V5](tax-bank-coverage.md), with complete connected-source identity, independent withholding/completeness guards and historical replay. Migration `19130000` implements [finance V3](finance-bank-coverage.md): owner-wide bank/account coverage, unchanged manual scenario, independent withheld-cash/drawings guards and retained replay. The remaining step 1 event-only writers and standalone exports are next; this does not open admission.

Migration `19140000` implements [native bank event scope](native-bank-event-scope.md): native settlement events, authoritative transfer/refund/assignment parents, complete duplicate cohorts and recursive import reversal roots. Historical requests and FX logic remain intact. Current reader/graph-envelope containment and standalone dimensioned exports remain next before any admission.

## Findings that drive the ordered work

| Surface | Current risk | Required change before admission |
| --- | --- | --- |
| `app/dashboard/imports/page.tsx`, `TransactionReview.tsx` | Projection omits currency; `Number(null)` becomes zero, with expense sign fallback | Dimensioned source read-back or explicit native-only financial form plus complete visible foreign coverage; no zero fallback |
| `app/dashboard/review/memory/MerchantReview.tsx`, `lib/records/merchant-memory.ts` | Native pence drives category, amount, materiality and bulk decisions | Restrict fresh native applications to full native representation; foreign rows remain visible as unsupported until their reviewed classification contract exists |
| `app/dashboard/tax-prep/facts/page.tsx` | Source chooser omits currency and formats `Number(pence)` as GBP | Dimensioned source metadata and visible eligibility; do not attach unvalued original units as GBP payment facts |
| Receipt/transfer/refund choice views and `loadMatchData` | Native sign filters omit null foreign pence | Keep explicit native eligibility; derive independent full foreign coverage from raw owned observations |
| Duplicate decision/review/export | Date/pence/currency comparison can overlook original foreign amount | Native-only fresh resolution first; later version dimensioned identity; exact retained requests recover before new eligibility checks |
| `financial_review_catalog`, operational review/quarter capture | Null materiality expression can disappear from unresolved counts | Version complete bank coverage and readiness guards; every unsupported/unvalued foreign observation is counted explicitly |
| Source ledger/manifests/reconciliation exports | Source cash assumes GBP; stringified null is neither original value nor valuation | New dimensioned versions retain original amounts, valuation history, recognised GBP effects and explicit coverage; freeze old ledger/manifest/V4 serializer contracts |
| Import reversal context | Current pure model requires GBP and may reject a mixed connected graph | Version foreign blockers/complete effect context before admission; never silently filter related observations |
| Tax calculation / filing | Observations derive from native views and current inputs retain native pence shape | Complete raw-source coverage in new current input versions and independently enforced SQL blockers |
| Finance | Existing currency coverage concerns invoices; foreign bank uncertainty can be absent | Owner-wide bank/account/valuation coverage withholding current free cash/drawings while preserving manual scenario replay |

`minorPence` already rejects null. Preserve that strictness. Filtering a native action's eligible choices is not permission to omit foreign observations from completeness or source history.

## Authoritative bank coverage contract

Build from owned raw `bank_transactions`, account/import/source file/row closure and latest valuation families/revisions, never from `receipt_allocation_balances` or another native-only view. Retain exact original units/currency/ruleset, nullable actual native GBP cash, cash date/year, import/classification/dedupe, recognised record ancestry, latest valuation identity/state/value/currentness and explicit invalid representations.

Use the existing invoice-coverage pattern: exact safe schema, owner identity, complete counts and rows, checked bounds and stable hash/stamp. Include unvalued, provisional, withdrawn, stale, reviewed current, reviewed zero and invalid foreign representations. A zero GBP valuation is not missing; a reviewed valuation is not a recognised posting or tax acceptance. Failed/overflow/partial coverage is unavailable, never an empty successful set.

During this containment checkpoint all foreign representations block current completeness/drawings, including reviewed and reviewed-zero valuations. This is a staging gate only; later complete supported posting/tax provenance must permit valid foreign cases. Personal exclusions and other non-claim cases must eventually resolve without invented GBP valuation. Owner-wide finance coverage also describes foreign accounts without observations. A transaction's valuation cannot value an account's current cash balance.

Scope is explicit: tax-year effects plus connected source/timing exceptions; filing's complete connected context with `in_tax_year`; finance owner-wide. Valuation date never silently moves the cash source between tax years. Original amounts of unlike currencies never add.

## Ordered implementation and compatibility

1. Private authoritative coverage and native eligibility helpers. Guard fresh native classification, merchant application, allocations, transfers/refunds, duplicate review and reversal at appropriate boundaries; preserve request-first completed recovery. Keep old public OIDs/argument contracts. Current readers must expose unsupported scope visibly.
2. Version tax input `/2 → /3`; current filing input `/3 → /4` and bundle `/4 → /5`; finance context/input/result `/2 → /3`. Preserve earlier pure preparers/parsers, saved rows, rules, scenario and artifact bytes. Current entry-point OIDs remain stable through explicit wrappers/private predecessor copies.
3. Bind identical complete bank coverage into every current context/step digest and independent SQL completeness guard. New capture requests cannot omit coverage or submit optimistic totals. Old exact requests recover before live source/head/coverage checks.
4. Extend tax/filing/finance capture freezes before checking new context. Include valuation families/revisions, source files/rows, accounts/imports/observations, retained document registrations/objects and recognised effects. Do not inherit a stamp whose transitive inputs are not frozen.
5. Dimensioned source/reconciliation summary/export contracts and source preview. Every unvalued/excluded/zero/stale row survives export. Add guarded V2 registration/recovery only after readers and all current claims are coordinated.
6. Complete evidence proof, human final valuation/classification/posting, reviewed correction/reversal and full export/tax/finance acceptance before opening foreign admission. Foreign transfers, fees, refunds/credits and invoice-to-foreign-cash matching need their own complete reviewed treatment.

## Verification

Use actual ordered SQL with synthetic foreign fixtures that relax only closed admission guards in disposable transactions. Prove every valuation state is counted, no null foreign row disappears, no original amount is treated as GBP and current optimistic completeness/drawings is withheld. Verify exact old request/snapshot/artifact replay after source/head changes. Test both source/valuation capture commit orders with independent connections, complete paging/overflow, two-owner/service/anonymous boundaries and browser amount/currency labels/reset/pending gates. Then demonstrate the finished source-to-posting-to-export/reversal workflow and representative hosted acceptance separately.

# Evidence-backed FX reconciliation

17 October 2026. Next handover FR1/FR2 implementation plan, following complete GBP shared-refund/import reversal and assignment freshness. The stage A arithmetic and detached preview foundation is now implemented locally; stages B–D remain incomplete. This design creates no financial approval, provider connection or exchange-rate authority.

## Existing boundaries

No FX application approval/import workflow exists. The arithmetic/preview foundation is documented in [fx-arithmetic.md](fx-arithmetic.md). `17110000` constrains account/source currency to GBP; `17130000` constrains invoices to GBP and stores one settlement amount for both capacities. `source-csv.ts` rejects non-GBP; `allocations.ts`, `match-proposals.ts`, transfers/refunds and commercial balances require GBP. Invoice revision fields and legacy money helpers assume two-decimal GBP. `18070000` reporting retains original source cash and GBP effects. Do not relax one check and let other consumers interpret foreign amounts as pounds.

Keep immutable bank observations separate from GBP recognised `financial_records`. Distinguish: foreign document supporting GBP bank cash; foreign invoice settled into a GBP account; genuine foreign-account observation requiring separately reviewed GBP valuation. The first case alone does not complete handover FX reconciliation.

## Architecture and proposed forward changes

1. Add versioned supported currency/exponent rules and exact minor-unit/rational conversion helpers. Initially enable only explicitly reviewed currencies. Retain GBP helpers/contracts; never route arbitrary currency amounts through `decimalToPence`. Rates use bounded exact numerator/denominator, explicit direction, rounding version/remainder and human-readable unit rate. JS uses BigInt; SQL uses exact integer/numeric arithmetic.
2. Preserve original currency/amount, source cash date, value/conversion date, invoice date, fee date and accounting date separately. An immutable reviewed FX decision records GBP valuation, rate/evidence provenance, author/rationale and source versions. Use owned retained evidence or explicitly human-transcribed evidence; never invent a live exchange rate. No new provider is needed.
3. Extend settlement relationships with independent invoice-currency units, receipt-currency units and reviewed GBP valuation. Legacy `amount_pence` retains its historic GBP meaning. Invoice balances become versioned and currency-aware; aggregate unlike currencies separately. Matching adds zero income. Historic request/PDF/export bytes remain unchanged.
4. Foreign-account observations need canonical currency-minor fields; the old source pence field remains a GBP-only compatibility projection. Do not fabricate GBP source cash. All enabled consumers must understand original cash versus valuation before those observations can be approved. Existing unknown/unsupported operations remain explicit exceptions.
5. Documented withheld fees and distinct fee observations require mutually exclusive provenance/capacity. One physical net receipt cannot be counted again as gross income without a separately reviewed gross/fee interpretation. Extend guarded multi-effect posting deliberately; do not relax ordinary uniqueness generically.
6. Add FX dependencies to source review, matching, transfer/refund/credit capacities, import discard, accounting aggregates, tax/filing provenance and cash planning. Reversal must include cross-import dependencies and reset observations once. Historical snapshots retain their old rules and bytes. Version new export/input shapes and preserve old verifiers.

Proposed entities are a supported currency ruleset, immutable FX decision/component/evidence links and explicit reversal/request history, plus additive compatibility fields on existing observations/invoices/settlements. Final DDL follows actual query and lock design. Replay the full chain after `18110000`; do not edit predecessor migrations or create a second ledger.

## Human gate and invariants

Safe atomic catalogs show owned source identities, original amount/currency, settlement amount/currency, conversion direction/date/evidence, fees, rounding and exact GBP effects. Read figures/words and currency names explicitly. Source/selection/rate/date/fee/reason changes reset confirmation. Actions authenticate and reread authoritative sources; client totals are not authority. Govern writes through the existing owner reconciliation lock, deterministic selected-row locks, post-wait stamp checks, immutable method-specific request recovery and all-or-none audit.

A synthetic USD 1,000 invoice settled by a GBP £790 bank observation consumes USD 1,000 entitlement and £790 cash capacity independently; matching posts no second income. A documented £800 gross conversion less £10 withheld fee may support a separately approved gross/fee interpretation, but without evidence the system must not invent those amounts. These are engineering fixtures, not tax-eligibility guidance. Owned cross-currency principal transfers create zero turnover; unexplained differences remain unresolved.

## Delivery and acceptance

A. Build exact currency/rational models, immutable evidence/context design and compatibility tests. Implemented locally in `lib/fx` and private arithmetic migration `18120000`; see [fx-arithmetic.md](fx-arithmetic.md). Evidence/lot/catalog interfaces are models, not persisted financial approval.
B. Deliver foreign-invoice to actual GBP receipt matching with partial/reversal support, currency-separated balances and complete source/reconciliation exports.
C. Deliver foreign-account import, reviewed GBP valuation, classification and reporting, then cross-currency transfers/refunds/credits without fee duplication.
D. Prove tax/filing/cash-plan integration for every enabled case and a complete source-to-export synthetic demo. An evidence-only GBP slice does not satisfy B–D.

Required tests: minor-unit scales; exact rates/directions and bounded overflow; cumulative partial rounding; independent invoice/cash capacity; source/evidence ownership; immutable original preservation; stale review after lock waits; same/fresh/cross-method retries; late rollback; shared dependency reversal; 5/6 April timing; fee double counting; foreign/anonymous denial; complete paged exports; prior request and saved-artifact recovery. Every enabled amount must tie to source and valuation evidence. Hosted authenticated/Storage/large-payload and representative anonymised provider acceptance remain separate release gates.

Before production treatment, supported currencies, conversion evidence policy, gross/fee treatment, cash-basis timing, VAT presentation and foreign-refund treatment require explicitly sourced supported rules and independent tax review. Unsupported rules must withhold treatment rather than assume equivalence or zero. No real account connection, financial action, migration deployment or tax filing is authorised by this design.


## Current local continuation

The initial boundary statements above describe the stage-A checkpoint. Stage B now has reviewed sourced canonical capture, dimensioned lots/settlements/full reversal, durable human-confirmed requests and versioned reconciliation/source/filing outputs; see [reviewed-fx-actions.md](reviewed-fx-actions.md). Stage C has begun with the internal dimensioned parser, while live account/source admission remains GBP-only. The complete [foreign-account valuation plan](foreign-account-valuation-plan.md) requires valuation/posting/coverage/reversal coordination before admission. No stage-C financial or hosted acceptance is implied.

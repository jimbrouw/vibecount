# FX arithmetic and reviewed settlement foundation

17 October 2026. Local handover FR1/FR2 stage A. This implements exact arithmetic and detached preview models, not foreign-currency import, invoice creation, settlement approval, tax treatment or a human FX application workflow. The complete FX feature and full handover remain unfinished.

## Currency and rate contract

`lib/fx/currency.ts` and local migration `20261018120000_fx_arithmetic_foundation.sql` share immutable ruleset `vibecount-currencies/1`. The initial arithmetic catalog contains GBP/USD/EUR at exponent 2, JPY at 0 and KWD at 3. Scales and names were checked against [SIX ISO 4217 List One](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml), published 17 September 2026. The exact downloaded bytes have SHA-256 `33139b438657d1cee116ba737807ea71d19d6de4b90f799a09c56f0cc6a1b0ff`. This is source identification for the checked catalog, not exchange-rate evidence or tax approval. Other currencies, funds, historic codes and provider-specific scale conventions are unsupported until explicitly versioned.

Amounts use bounded exact integer minor units, maximum magnitude 999,999,999,999. Human decimal input must be a string without grouping, symbols, whitespace or exponent notation; extra fractional places reject rather than truncate. Wire minor amounts are safe integers. Rational numerator/denominator are bounded positive canonical decimal strings, reduced by GCD before retention. Rate direction is always `target_major_per_source_major`; conversion multiplies by both currency scales. A derived minor-unit rational is included explicitly in the trace. Same-currency rates must be identity, with fees represented separately.

TypeScript uses BigInt intermediates; PostgreSQL uses exact numeric multiplication, integer `div` and `mod`. It never rounds a finite decimal division before checking the half. Signed nearest-minor rounding uses ties away from zero, with exact product, denominator and rounding-delta numerator retained. JSON outputs contain no BigInt. Decimal and rational inputs are lexically bounded before expensive conversion.

`convertCurrencyTranche` calculates forward portions of one unchanged rate/date lot by subtracting cumulative rounded totals and rejects inconsistent retained prior conversion. A final positive source portion may have zero target units. Arbitrary reversal is not a negative forward portion: retain original approved portions and reverse the required dependencies instead of recomputing someone else's penny.

## Independent settlement review

`fxSettlementReview` accepts strict versioned intent and an owner-derived catalog contract. It checks current receipt version, invoice economic revision, explicit invoice/conversion/valuation evidence revisions, owned immutable source/evidence identities, exact rate/date direction, active conversion-lot identity/version/history, recognised GBP valuation and invoice/cash capacities separately. The source retains cash date, invoice date, conversion date, evidence date and GBP value date separately.

A USD 1,000 invoice can consume USD 1,000 units and £790 actual bank cash. Matching changes recognised income and expense by zero. A foreign receipt additionally requires its exact current owned GBP valuation and valuation evidence. Unlike invoice currencies remain separate rows; only portions of the same observed cash currency are summed. Credits and returned cash determine outstanding from retained units, rather than treating face value as a lifetime allocation ceiling.

Selected conversion-lot prior cash totals cannot exceed the receipt's total previously allocated cash. The future authoritative projection must prove complete lot/history parity, including legacy relationships; pure catalog validation is not database authority. Forward lot history and the cumulative helper preserve final zero-cash portions. Reversed/inconsistent lots and stale evidence reject. Withheld fees, gross-ups and separate-fee treatment remain unsupported here and reject; conversion review cannot invent them.

The result is rebuilt from explicit safe IDs, hashes, dates, currencies, amounts and traces. Raw rows, filenames, bank identifiers, storage paths and arbitrary context fields are omitted; the rationale is redacted. Inputs are not mutated and returned objects retain no mutable source references. `financial_action` is always `preview_only`.

## SQL and compatibility boundary

The forward migration adds only immutable `fx_currency_rulesets` and private arithmetic helpers. The public catalog contains standard currency metadata, with authenticated read policy and service read access, no application writes and immutable update/delete history. All helper execution is revoked from public, anonymous, authenticated and service roles. They are available only to the database owner/future guarded definer writers. No financial action RPC was introduced.

Existing GBP constraints on accounts, observations and invoices remain unchanged. Existing source fingerprints, financial records, invoice PDFs, request results, reporting contracts and saved tax/filing artifacts are not rewritten. No foreign values can enter those paths through this migration. Apply the complete ordered chain after `18110000`; no hosted migration was applied. Preserve immutable rules/history when withdrawing future entry points; do not discard source evidence as rollback.

## Verification

The full suite passed **385 tests**, zero failed/cancelled/skipped. Final evidence/lot aggregate refinements were independently rerun in the **14 focused checks** (13 pure tests and one real ordered-chain SQL/parity test). Lint and a clean production build including TypeScript passed. The generated `.next` cache was preserved before building because of its known macOS cleanup issue; public Supabase build values were non-production placeholders.

Tests cover zero/two/three-decimal scales, explicit direction, near-half rational boundaries, signed symmetry, cumulative conservation across 143 rates, SQL parity across scales and 126 signed tranches, final zero portions, independent capacities, retained cash after returns, exact evidence revisions, missing/foreign/stale sources, unknown/private fields, context order, detached outputs and aggregate lot corruption. SQL tests verify catalog immutability, public-role helper denial and all three existing GBP constraints. A read-only independent reviewer found initial capacity/revision/aggregate gaps; those are fixed and final review found no blocker within this foundation scope.

Run `npx tsx scripts/demo-fx-foundation.ts`. It replays the actual migrations in disposable PostgreSQL, compares private SQL arithmetic with TypeScript, previews USD 1,000 against £790, retains a zero-penny final portion and proves zero financial records were created. Output is `/tmp/vibecount-fx-foundation-demo/synthetic-fx-preview.json`. Document hashes, IDs and reviewed evidence states are synthetic placeholders, not verified financial evidence. No provider/account connection, real approval, hosted migration, payment, send, deployment or filing occurs.

## Next required implementation

Follow [fx-reconciliation-design.md](fx-reconciliation-design.md) stages B–D: immutable reviewed evidence/valuation/lot persistence, authoritative safe catalogs and guarded approval/reversal; additive currency-aware invoice/settlement/source fields; complete balances/consumer/export updates; foreign-account import and cross-currency transfers/refunds/credits/fees; tax/filing/cash-plan provenance and hosted acceptance. Every legacy GBP reader/writer needs an explicit compatibility or currency-aware contract before any currency constraint is relaxed. The current preview must not be wired directly to a financial write. Annual conversion/fee/VAT/tax treatment still needs explicitly sourced supported rules and independent review.

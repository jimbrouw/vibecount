# Dimensioned CSV parser prerequisite

`lib/records/source-csv-v2.ts` implements internal `mapped-csv/2` preparation for the complete [foreign-account valuation plan](foreign-account-valuation-plan.md). It is not connected to application ingestion. Current UI, account constraints, registration/recovery and financial posting remain GBP-only through V1.

## Contract

`parseDimensionedSourceCsv(text, mapping, accountCurrency)` uses the existing strict CSV tokenizer and versioned currency catalog. Its result includes parser/ruleset/account currency and complete original rows with logical number, date, safe description/reference, signed original minor units, exponent and unchanged raw cells. `signedAmountPence` contains actual GBP source cash only; every foreign row has null. No exchange rate, valuation, classification or recognised effect is inferred.

Explicit account currency is mandatory. When no CSV currency column exists, the selected account supplies that declared currency; a mapped currency column must match it on every row. Selected monetary header currency declarations must agree. Foreign headers/amounts require code-based unambiguous representation; currency symbols are rejected, while GBP retains £ support and rejects other Unicode currency symbols.

JPY uses zero decimals, KWD three, and GBP/USD/EUR two. Excess precision, scientific notation, unsupported codes, unsafe bounds, malformed grouping, zero source amounts and ambiguous signs reject. Debit/credit columns must be nonnegative with at most one nonzero; card-charge sign convention is explicit. Entire parsing fails when any row is invalid; no partial successful result is returned. Genuine repeated purchases remain separate observations.

V2 mapping has exact fields and distinct selected columns. GBP delegates the existing V1 normalization and keeps its stricter whole-header currency guard: an unselected USD balance column can still reject a native parse when currency mapping is absent. This compatibility exception is deliberate and tested. Foreign V2 checks the selected monetary columns, allowing an unrelated running-balance currency. V1 parser version, normalization, hashes and registration contracts are unchanged; only its existing calendar validator is additionally exported for reuse.

Raw cells are sensitive preservation data, not a browser/AI DTO. Safe descriptions/references use existing bank-number pattern redaction, which does not guarantee complete removal of personal information. Future registration must separately validate ownership, source/account/import/row closure, currency-aware fingerprints and encryption. Parser output is never proof of source registration or a financial authorization.

## Demonstration

```sh
npx tsx scripts/demo-foreign-source-parser.ts
```

`/tmp/vibecount-foreign-source-parser-demo` contains four separate synthetic USD/EUR/JPY/KWD statement-shaped files and `parsed-originals.json`. Original byte hashes/sizes and all null foreign GBP projections were independently verified. EUR card repayment remains a source observation, not income. USD repeated purchases remain distinct. These are engineering fixtures, not certified bank/card exports. No ingestion, dedupe, valuation, classification, database write or provider call occurs.

Eight new tests cover native V1 output parity, fixture results, exponents, signs, currency mismatch/header confusion, bounds/precision, raw logical rows/redaction and exact mapping/date/schema failure. Independent read-only review found a GBP symbol gap, now fixed, and requested an explicit native header compatibility decision, now documented/tested. Both parser suites pass 15 focused tests.

## Remaining integration

This completes only the parser dependency. The finished foreign-account slice still requires immutable valuation persistence, complete consumer containment and versioned source/tax/filing/finance coverage before foreign admission, guarded ingestion/recovery, separately human-reviewed classification/posting, correction/reversal and full source-to-export verification. See the ordered plan. No foreign units are admitted to existing GBP consumers by this change.


Final local verification: 627 automated tests passed, with lint, standalone TypeScript, secret/whitespace checks and a clean production build. Existing ignored build output was preserved. No UI was changed; the prior reviewed FX checkpoint passed all 15 browser suites. These results do not establish foreign ingestion or hosted acceptance.

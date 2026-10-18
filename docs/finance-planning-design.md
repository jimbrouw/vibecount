# M6 reviewed cash and forecast plan

17 October 2026. Extend existing ledger/invoice/tax infrastructure; no bank connection or financial posting.

The local calculation, immutable revision persistence and review/dashboard/export slice is now implemented and tested; see [finance-planning.md](finance-planning.md) for current migration, verification and remaining scope. This design is not evidence of completed hosted rollout or the full M6 milestone.

1. Store immutable owner-wide cash-plan revisions containing physical assets once, as-of balances, purpose allocations across all years, unpaid obligations and explicit forecast assumptions. Allocations are subsets of cash; pension/restricted assets cannot fund them. Linked accounts/documents must be owned and safe provenance is frozen. Preserve unknown versus zero.
2. Add a separate sourced 2026/27 planning ruleset. Reuse exact tax arithmetic, without fabricating verified ledger/fact records or changing the default 2025 calculator. Support explicitly scoped UK sole-trader cash/non-VAT/no-other-income scenarios; unknown pension basis/eligibility and unsupported cases withhold affected outputs.
3. Show actual cash/debt/pensions, actual tax earmarks, conservative forecast reserve requirement/shortfall, monthly cashflow to tax-year end and conditional drawings headroom. Current cash is never historical invoice receipts plus bank balances. Tax reserve is not a tax payment credit. Protect funded tax once; unknown reserve-year allocation blocks drawings.
4. Forecast future monthly receipts/costs/drawings/pension on explicit 5th-of-month timing through 5 April. Separate 2026/27 annual run-rate tax from known unpaid HMRC obligations, including prior-year balances/current-year POA. A future-year POA illustration is not a demand or cash. Manual obligations must be remaining unpaid and not duplicated in forecast monthly costs/debts.
5. Authenticate and recompute on server, require figures/words read-back and human confirmation, serialize expected ordinals/idempotent requests, capture immutable inputs/results/rules/source hashes, provide safe history/export and dashboard links. Test capacities, ownership, stale changes, exact retry, zero postings, pension exclusion, goldens and browser reset.

A saved plan is a draft planning aid, not advice, filing approval, a bank feed or a payment. Independent tax review, actual provider/evidence operations and full handover acceptance remain separate requirements.

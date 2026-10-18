# Record integrity and explained matching plan

17 October implementation continuation (local work; no deployment). Extends the approved handover audit/plan.

1. Enforce owner-or-shared-default and matching record type for category links in manual records and legacy CSV/PDF staging. Freeze category identity (ID, owner, type/default status), preserving editable labels and annual mapping metadata. Existing bad links remain unchanged for explicit review; future writes must repair them. Prove an upgrade with bad legacy links and actual-role/race tests.
2. Reuse complete keyset reads and reconciliation consistency stamps for receipt/invoice/client candidates. No new ledger or match-posting RPC. Preserve tax-year cash timing and adjacent-year invoice candidates.
3. Add deterministic reference, payer, amount and date proposals, with reasons and visible ambiguity. Amount-only matches do not establish identity. Show material unmatched receipts even when no strong proposal exists. No auto-classification, posting or submission.
4. Proposal selection only drafts existing allocation fields and clears confirmation. Existing `approve_invoice_allocations` checks authoritative capacities, versions and owners at human confirmation.
5. Verify exact named-amount examples, exclusions, partial/current balances, page-cap completeness, owner isolation, stale reads/approval, browser reset and source-linked zero-extra-posting SQL. Document migration, demo and remaining limits.

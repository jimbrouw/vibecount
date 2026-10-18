# M4 reviewed tax facts: implementation contract

17 October 2026. This implements the profile/fact foundation in the approved incremental handover sequence; the deterministic rules engine and M5 filing pack remain subsequent work.

Keep `financial_records` as the self-employment accounting projection. Employment, termination, pensions, other personal income, actual HMRC payment allocations, vehicle elections and trading adjustments are separate typed tax facts. Saving them creates no financial posting and never silently removes overlapping bank treatment.

Add owner/year profile families/revisions, typed fact families/revisions, immutable source links, section completeness attestations and idempotency requests. Use explicit provisional/verified/excluded/withdrawn states. Unknown fields and unreviewed sections are missing, never zero. Verified means the human reviewed typed values against their evidence, not professional certification. A new withdrawn revision removes the fact from current inputs without restoring older approvals.

Each save uses the existing owner reconciliation lock, exact current ordinal, owner/year tax stamp and immutable request ID. The stamp combines current financial provenance with profile/fact/section history. Section confirmations store the current kind-specific fact digest: later edits invalidate them. None requires no active facts; complete requires reviewed active facts with no provisional input. Profile completeness remains separate from collection completeness.

Sources are selected owned preserved documents or normalized bank observations, with hashes and safe metadata snapshots. No raw employment/bank document, original filename, storage path or key is sent to browser-agent or LLM surfaces. Manual entry reads back exact figures and words. Verified monetary facts require a source. Future calculations must block on sources still recognised in the trading ledger when they also represent non-trading facts.

Vehicle facts identify one stable asset family, an explicit actual-cost/mileage election, vehicle type, business-use basis, mileage and linked actual-cost records. Bicycle/e-bike employee mileage cannot be borrowed for sole-trader expenses. Reusing an active actual-cost record across vehicles is blocked; later calculations must substitute mileage for related actual costs, never add both. Actual tax credits require explicit payment identity/year/type; savings balances cannot become credits. No automatic deduction or redundancy exemption is inferred.

Acceptance: owner isolation, strict typed values, exact retry and stale rejection, immutable provenance, all-or-none audit, explicit none versus missing/zero, section invalidation, vehicle/payment overlap guards, human read-back/reset, source hash exports and no new financial postings. Native PostgreSQL must prove competing saves and financial changes cannot accept stale review. Use synthetic facts only. Hosted auth/storage, source preview, restore, full tax rules and form mapping remain unproven.

Implemented foundation and its verification/limits are recorded in [reviewed-tax-facts.md](reviewed-tax-facts.md). This contract does not claim the rules engine or filing pack is complete.

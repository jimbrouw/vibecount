# Reviewed annual merchant-rule rollover

17 October 2026. Extend existing merchant memory; preserve prior-year rule families and all transaction decisions.

1. Derive next-year proposals from latest active year-scoped rules, using owned, clear, retained source observations and unchanged valid category meaning. All-year rules already cover their stated scope and are not annual rollover candidates. Adjacent year only; preserve account scope.
2. Create a separate target-year family using the existing rule validator/save RPC, never supersede the source family. Proposed full target-year dates are explicit assumptions requiring review, not an extension of old approval. Default disabled and provisional/missing evidence; human can explicitly activate a suggestion. Transactions still require separate reviewed application.
3. Append immutable owner-valid source-version/target-version ancestry and request history atomically. Unique source family/target year prevents duplicate repeated rollover. Existing overlapping target-year/all-year active rules require review of the existing rule instead of silently adding another hint.
4. Serialize with the owner reconciliation lock, lock category meaning before stamp validation, compare the pinned source version and current seed state. Exact completed retries recover before mutable reads. Inner rule save and outer rollover audit/request commit or roll back together.
5. Reuse labelled MerchantRuleReview controls with target year/account fixed, complete read-back and confirmation reset. Export ancestry with existing owner-scoped merchant history. Test zero postings, retained prior-year applicability, fresh target-year suggestions, conflicting/foreign/stale inputs, exact retry, rollback and native races.

Deadline reminders are separate M6 work. No sending, production migration, account connection, financial posting or tax certification is authorised by a rollover proposal.

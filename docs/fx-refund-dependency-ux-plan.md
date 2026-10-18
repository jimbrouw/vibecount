# FX refund dependency review — implementation plan

Implemented locally in `20261019060000_fx_refund_dependency_context.sql`; see [implementation and verification](fx-refund-dependencies.md). This document retains the planned scope.

Continue after source/filing provenance. FX allocation/reversal writers remain private. This slice makes existing database restrictions visible before human confirmation; it does not bypass them or treat zero cash as no relationship.

Existing SQL already guards both refund endpoints, complete split nodes, connected refund reversal and native returned-cash assignment approval. `fx_dependency_blockers(owner,nodes)` already projects retained owned blockers. Import reversal already has a versioned context and visible source/lot links. Complete FX reversal review exists but cannot save yet. Preserve these implementations and exact historical request recovery.

Remaining paths and intended scope:

1. Simple refunds: selected original/refund choices currently have no FX blocker metadata. Add an authoritative selected-endpoint dependency read, complete counts/stamp and a blocked review with source and complete-lot links.
2. Split refunds: version the existing split catalog rather than changing old payloads. Add per-transaction FX blockers. An active FX relationship on the selected refund disables the complete split; blocked originals become disabled choices. Unrelated blocked candidates must not suppress valid selections. Use active relationship counts, including positive-original/zero-cash events, rather than combined allocated cash alone.
3. Connected refund reversal: version the existing graph read. Show FX blockers for every connected node and withhold its financial confirmation. Match the database's complete graph scope, including originals outside the current import.
4. Native returned-cash assignment approval: show blockers on the original receipt even when the selected allocation itself is native. Preserve assignment reversal as dependency cleanup; unmatching returned cash must not be blocked merely because another FX lot exists.

Extract/reuse the safe owned blocker parser and display from the import-specific implementation. Preserve native data/read-back when clear. Link each blocker to retained lot review and its exact import/source row. Missing, foreign, incomplete, stale or oversized dependency context withholds approval; failed queries are not empty blocker sets. Explain that a required FX reversal currently has draft review only and cannot yet release the dependency.

Fresh actions must reload authoritative dependency context before review/approval. Retained exact requests recover through existing database request history before current dependency checks. Keep function OIDs, existing grants, old request bytes and native semantics intact.

Acceptance: real SQL upgrade/native parity; bidirectional and outside-import dependencies; zero-cash and fully reversed histories; selected versus unrelated split candidates; graph-wide blockers; safe owner projection/counts/limits; fresh action preflight and historical recovery; browser confirmation withheld/reset on changed context; source links and clear draft-only limitation. Complete this gate before separately designing reviewed FX save/recovery/grants.

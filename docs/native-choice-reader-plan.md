# Native reconciliation choice readers

Continue the full handover after database event fences (migration 78). Foreign admission stays closed. This increment covers direct matching, transfer, refund and duplicate screens; versioned connected graph envelopes and standalone exports follow without enabling foreign writes.

Implemented and verified locally: [native-choice-readers.md](native-choice-readers.md). Full verification passed 728 automated tests and all 17 browser suites, plus lint, type checking, clean build and anonymous production smoke. No new migration was required.

1. Reuse complete owned bank coverage and bracket current rows with both bank and existing financial/group stamps. Match every displayed/selected source to raw identity, date, currency, exact nullable cash and available classification/import metadata. Contradiction or missing coverage is unavailable; a valid unsupported source is a visible distinct state.
2. Retain native matching candidates, but expose all-owner raw coverage and focused unsupported sources. Never infer completeness from the positive native receipt view. Use raw dates to reopen a focused source's year. Native allocation reversal controls require a currently eligible source.
3. Render unsupported list/focused sources with original-unit readback and exact import links, without native arithmetic or financial forms. Check both endpoints of active transfers before reversal, while preserving retained history and source links. Refund history links remain available for complete graph review.
4. Duplicate cohorts remain complete, including unsupported peers. Validate unique IDs, identical raw account/fingerprint identity and peer-count closure before financial readback; withhold the entire selected financial review if any member is unsupported.
5. Prove supported native behavior, null/original-unit/invalid-account cases, hidden positive-view omissions, paging, missing/contradictory metadata and coverage drift; exercise actual rendered pages/forms with inert actions. Preserve historical intent models and request-first recovery. Run full verification, a synthetic demo and production anonymous smoke.

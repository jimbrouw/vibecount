# Reviewed statement overlaps

17 October 2026. Local M1/M2 slice. Not deployed; not completion of the handover.

## Behavior and data

`20261017190000_reviewed_duplicates.sql` adds immutable `duplicate_decisions`, `duplicate_reversals` and idempotency requests, with owner RLS and composite owner/source foreign keys. Direct history writes are denied, including the service role. A bank observation's duplicate status/pointer can change only through reviewed functions. Existing encrypted bytes, rows and normalized source facts stay intact.

At `/dashboard/reconciliation/duplicates`, users can inspect the complete same-account/fingerprint group, including source/row SHA-256, parser, versions, account mask, current financial effects and import status. Each observation has direct review/source links. Fingerprints are review hints, not proof: same-file identical purchases remain clear on ingestion and can both be genuine.

Two explicit verdicts:

- **Duplicate:** point to a clear, active retained observation with matching account, fingerprint, date, amount and currency. Exclude the subject's approved posting, leave its classification Unknown, preserve the retained observation. No chains, cycles or silent canonical promotion.
- **Separate real payment:** clear the overlap flag, preserving current classification/posting. Unknown remains Unknown and needs financial classification separately. The verdict reviews this cohort; it does not approve future matching imports.

Both require evidence/reason, exact figures/words and human confirmation. Changing verdict, retained observation, reason or server snapshot resets confirmation. The stamped group is read completely across server page caps; mixed-state reads suppress review.

Reversal excludes the subject's current approved posting, clears the active identity pointer and returns it to `needs_review` / Unknown. It never restores earlier classifications or relationships. This also works on discarded subject imports, so users can unlink aliases before reversing a retained source. Reopening a source restores no financial approval. Incoming duplicate references and active receipt allocations, transfer pairs or either endpoint of a refund group block identity changes/reversal until explicitly resolved.

A retained source import cannot be discarded while any active duplicate points into it, even if the alias import is discarded. The parent transaction rolls back any earlier attempted financial reversals. Cohort links and incoming history expose the dependent observation for explicit reversal. Identity relationships survive subject import reversal/reopening.

## Transactions and exports

Review/reversal lock owner reconciliation → ingestion's account key → cohort rows in ID order. Ingestion takes no owner lock, so this adds no lock cycle. Idempotency lookup precedes mutable checks; reuse with changed payload rejects. New imports, classifications and relationship changes invalidate old stamps. Identity history/status is included in global export stamps and source-import review summaries.

The safe review view excludes raw encrypted cells, private filenames, object paths and keys. Immutable snapshots preserve both source chains and the complete reviewed cohort. Source ledger CSV and evidence manifest append active identity/retained-observation IDs; existing CSV columns retain their positions. Missing active identity provenance fails export.

`/api/imports/[importId]/export?format=identities` produces a draft JSON identity history for events involving this import as subject or retained source. It includes reversals, original reviewed source hashes/cohort, author/reason and a reproducible SHA-256 over the emitted snapshot. All pages are read under an unchanged global stamp. Explicit allowlists omit descriptions/references, raw source fields and private storage metadata. The snapshot hash checks integrity, not authenticity. Event effects are reviewed snapshots, not additional postings or a locked filing pack.

## Anonymised demo

Use a disposable environment with the existing migration chain plus migration19; never run this against real records as a demonstration.

1. Create a synthetic Starling account. Import `fixtures/synthetic-starling.csv` using date, counter-party, reference and signed Amount (GBP), not balance.
2. Review the £1,500 freelance receipt as Business. Import `fixtures/synthetic-starling-overlap.csv` into the same account. Its receipt is unresolved; recognising it as Business must reject.
3. Open overlap review from the import row. Inspect both receipt file/row hashes. Choose Duplicate, retain the original £1,500 observation, add a source-evidence reason and confirm the zero additional income effect. Total freelance income still includes £1,500 once.
4. Inspect the two software rows from the original source. Both remain clear: matching date/merchant/amount alone did not suppress one. If evidence establishes two purchases, record Separate real payment; existing approved expense treatment is preserved. Do not decide merely from row counts.
5. Export the source ledger, evidence manifest and identity history. Verify both receipt hashes, decision/retained IDs and zero recognised effect on the duplicate. Reimport the exact files: no added observations/postings.
6. Attempt retained-source reversal: it blocks. Follow the dependent observation link, reverse its identity verdict, and verify Unknown/unresolved with no restored posting. If its source was already discarded, identity reversal still works.

## Verification and rollout

The full automated suite passes **130 tests**, zero failed/skipped. Dedicated SQL tests exercise byte-different overlaps, genuine repeated payments, signed effect removal/preservation, exact retries, stale cohorts, discarded alias recovery, retained-import rollback, no chains, cross-owner/anonymous/direct-write denial and allocation/transfer/refund dependencies. Native independent PostgreSQL connections test review versus ingestion in both orders, competing approvals and stale classification. Export tests verify safe provenance, digest reproducibility and missing-provenance rejection. Both browser component suites pass, including duplicate figures/words, verdict/reason/snapshot reset. Final lint and production build pass. A temporary production-server smoke check returned 200 for login, 307 to login for duplicate review, and 401 for unauthenticated identity-history and reconciliation exports. The server was stopped afterward.

Apply the additive schema before dependent UI/export code. Rehearse the full empty/upgrade migration chain and authenticated Supabase behavior first. To roll back availability, disable the new review UI/writes and retain tables/history; do not drop evidence or replay old financial approvals. New source exports require the new pointer/FK metadata: verify PostgREST discovers `transaction_duplicate_owner_fk` in authenticated staging. Local SQL tests cannot prove that HTTP relationship.

Remaining limits: no automatic dedupe or source-ID certainty, cross-account identity or fuzzy matching. Renamed descriptions/different fingerprints need future exception handling; differing sign/currency/account is never silently treated as the same payment. Provider fixtures are synthetic. Real Supabase/Storage/authenticated E2E, source preview/recovery/key lifecycle and retention remain release/M1 work. Match proposals/material exception queue, FX/split refund work, delivery recovery and M3–M6 remain unfinished. No production migration, deployment, bank connection or real financial action occurred.

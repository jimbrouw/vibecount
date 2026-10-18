# Authoritative FX settlement catalog

18 October 2026. Local read-model stage. Financial writers remain private; no hosted migration or real financial approval occurred.

## Owned snapshot and bounds

Migration `20261019020000_fx_settlement_catalog.sql` adds the V1 base; `20261019030000_fx_dependency_review.sql` upgrades the current RPC to V2 with required original/refund-side relationship counts while preserving its OID. The authenticated read-only RPC is `read_fx_settlement_catalog()`. Its stable, owner-derived security-definer body has an empty search path and no caller-supplied owner. One SQL snapshot returns:

- All canonical external invoices/current positive revision IDs, captured invoice fact revision IDs, original totals, active original allocations and actual GBP cash totals.
- All positive GBP observations, including ineligible/unreviewed states, with source/import/version, recognition metadata and combined native/FX allocated cash. No bank descriptions, references or raw cells are returned.
- The existing complete latest-per-family evidence catalog, preserving its currentness, registration and safe document metadata.
- Every persisted conversion lot with retained exact canonical/fact/document/hash/receipt ancestry, documented limits, normalized rate/dates, all-event version, active count and retained original/cash totals. Historical ancestry is separate from current approval choices.

Counts are checked against serialized arrays. Each collection is limited to 10,000; the serialized response is limited to 2,000,000 bytes. Exceeding either bound rejects the entire read. This is not paginated/truncated success, large-history performance certification or an assertion that hosted transport limits are proven. All immutable event detail need not be sent to derive authoritative counters.

## Safe parser and review adapter

`lib/fx/settlement-catalog.ts` rebuilds the safe projection, validates all rows including unselected rows, and checks exact counts, ownership, identities, dates, units, rate direction, current receipt/evidence parity, unique lot families/recipes, invoice/lot original and cash closure and shared receipt cash capacity. Missing recognition fields do not become zero. Retained lot counters distinguish all events from active portions, including zero-cash portions and reversals. `settlement-catalog-store.ts` performs a single authenticated RPC read and rejects failed/missing results.

Current choices derive only from latest usable facts matching the exact canonical captured fact, current document registration and current fully approved GBP receipt meaning. Canonical invoice revision IDs are distinct from invoice fact revision IDs and family IDs. A conversion’s parent must match the canonical captured fact; rate/date/documented original and cash limits are retained independently. Bound lots cannot change their retained recipe or substitute a fresh UUID. A second conversion family with the same bound recipe is blocked, preserving cumulative rounding.

An unbound choice has no saved lot ID. Its form may retain a proposed UUID with version zero; the adapter labels read-back `proposed`. After private approval, it must use the real persisted ID and all-event version. The pure review also rejects proposed lots with existing counters/prior units. This distinction creates no financial authority.

Exhausted original invoice/documented capacities are blocked. Zero available cash alone does not hide a remaining original tranche: cumulative rounding can produce a valid final positive-original/zero-cash allocation. Exact amount review remains authoritative.

Withdrawn evidence, missing objects, changed receipt decisions or changed registrations prevent fresh allocation. Every persisted lot remains in retained history, including active stale lots needed for complete reversal and fully reversed lots whose version cannot reset. Current approval choices never replace that history. Draft human matching/reversal forms and explicit connected import blockers now exist; financial saves remain unavailable pending complete portion, export and filing integration. See [fx-dependency-review.md](fx-dependency-review.md).

## Verification and demo

The ordered SQL fixture exercises predecessor upgrade/read-only parity, canonical/fact/family identity mapping, proposed/persisted read-back, complete projection/count/privacy checks, changed decisions, shared native/FX cash, partial allocations, final zero cash with fully exhausted receipt cash, complete reversal and fully reversed lot reuse. It verifies duplicate recipe rejection, source loss, withdrawal, retained hashes, other-owner emptiness, anonymous/service read denial and continued private financial writer grants. Actual SQL fixtures also exercise the 2 MB payload guard and 10,000-family bound. The payload fixture uses privileged synthetic cloned evidence solely to exercise size limits, not human approval or production history.

Run `npx tsx scripts/demo-fx-settlement-catalog.ts` for `/tmp/vibecount-fx-settlement-catalog-demo`. Actual ordered SQL and synthetic encrypted invoice evidence produce proposed read-back, persisted counter progression, three KWD 10.001 / GBP 25.00 cumulative portions, source-loss blocking and complete reversal to six events/zero active portions. Recognised receipt bytes remain unchanged; only safe synthetic metadata is emitted.

The local PostgreSQL fixtures use the existing minimal Supabase-style bootstrap. They do not establish signed-in hosted Auth/PostgREST/Storage behavior. No public financial matching workflow is enabled.

## Remaining handover work

Before financial writer activation: complete individual portion review, reviewed save/recovery actions, remaining refund/assignment dependency UX, versioned reconciliation/source exports, filing provenance and end-to-end parity. Draft read-back forms and explicit import blockers now exist. Foreign accounts/valuations, fees/credits/refunds and complete tax/finance integration remain separate supported branches. Evidence lifecycle and coordinated database/object/key restore, durable communication recovery, representative provider imports, complete historic evidence, independent annual tax/form review, hosted acceptance and release isolation remain required. This catalog does not complete the full handover or stage B.

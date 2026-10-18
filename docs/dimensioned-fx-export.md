# Dimensioned FX history and reconciliation V4

The current reconciliation download uses `vibecount.reconciliation/4`. This is a relationship/evidence export, not a new accounting posting or a claim that FX tax treatment is supported. Financial allocation and reversal writers remain private, and both review forms still display disabled save buttons.

## Retained review and history

Migration `20261019040000_fx_lot_review_sources.sql` adds the authenticated invoker-safe `fx_lot_export_sources` projection and owner-derived `read_fx_lot_portions(uuid)` read RPC. The view joins exact retained canonical invoice revisions and verified invoice/conversion facts. It does not replace them with latest facts or require current Storage availability. The selected RPC returns every active portion ordered by allocation ordinal, an all-event head, complete count and current financial stamp. More than 10,000 active portions or a response above 2,000,000 bytes fails rather than truncates. No financial grants are added.

`lib/fx/settlement-history.ts` validates safe owned ancestry and frozen snapshots. Complete history requires contiguous all-event ordinals, independently recomputed cumulative conversion tranches and exact descending suffix reversal copies. Active review permits historical ordinal gaps while requiring a complete cumulative active prefix and exact counts/totals. Positive-original/zero-cash portions remain real relationships. Safe DTOs retain the ownership metadata needed for validation again across the server/client boundary.

The reversal page reads both the aggregate catalog and complete selected portions, rejects stamp/head disagreement and displays each active portion in figures and words. Recipe identities, limits, rates/dates and document hashes must agree. Changing reviewed inputs resets confirmation. Source loss or a later withdrawal prevents new eligibility while preserving retained review and complete reversal ancestry.

The retained `receipt_record_id` is an immutable writer-authored reference. The parser verifies its UUID and copied snapshot consistency; it does not independently prove historical record ownership/current availability through another record query. Current recognised-record pointers must not replace historical references after legitimate reversal/reclassification.

## Export contract

V4 reuses raw V3 table cells and escapes CSV exactly once. Retained V2/V3 serializers and frozen byte/hash fixtures stay unchanged. Rows distinguish:

- Existing native events, cash observations, commercial credits, refunds and assignments.
- Once-only original invoice document values, without invented GBP valuation.
- Every FX allocation/reversal, with original currency/minor units and actual GBP cash separately.
- Retained lot counters/capacities and external original-unit balances, explicitly non-additive context.

FX rows include canonical/fact/family/document identities, retained hashes, exact rate/dates, cumulative tranche snapshots, event ordinals, active status and zero recognised income/expense changes. Receipt rows split native, FX and combined allocated cash. Complete source joins, receipt balances, original invoice capacities, native credit/returned-cash balances and active assignment parents/caps are checked before serialization. Refund totals and representative markers are derived from the complete retained link history rather than trusted as independent inputs. Historical reversed parents and valid predecessor relationships remain exportable.

The route owner-pages all event dimensions, safe lot sources, current external balances, native financial relationships, finalised documents and captured source facts. It batches fact IDs, continues paging to exhaustion, brackets every read with the financial stamp and requires a successful export audit. Missing/foreign/inconsistent sources, late-page errors, drift or output above 4,000,000 bytes withhold the whole export. Responses are private/no-store and identify the V4 schema. Source metadata/retained hashes are not assertions of current object availability.

## Verification and demo

`lib/database/fx-history.test.ts` applies predecessors, seeds an actual allocation, then applies the read-only upgrade. It verifies unchanged event bytes/stamp, real SQL DTO parsing and V4 export, three tranches including zero cash, full reversal/reuse counters, exact historical output after withdrawal/object loss, preserved recognised receipt bytes, owner isolation and private writer grants. Pure/route tests cover malformed history, closure gaps, safe projection, complete paging, stale selected reads, audit failure and frozen compatibility bytes. Browser checks exercise every displayed portion, figures/words, confirmation resets and unavailable financial saving.

Run `npx tsx scripts/demo-fx-history-export.ts`. It creates `/tmp/vibecount-fx-history-export-demo` with actual disposable SQL, synthetic encrypted invoice evidence, complete portion review, allocated/reversed CSVs and SHA-256 manifest. KWD 10.001 matches GBP 25.00 in three portions; a native penny shares the GBP 25.01 receipt. Source loss leaves historical CSV bytes unchanged. Complete FX reversal preserves that native penny and recognised receipt history. No real financial approval or external service is involved.

This does not establish hosted Auth/PostgREST/Storage behavior, large-history transport/performance, representative provider formats, independent tax/form correctness or release readiness. Source-ledger/evidence manifests and frozen filing artifacts still require separately versioned FX provenance. Refund/assignment dependency UX and reviewed actions/recovery/grants remain activation gates. Foreign accounts/valuation, fees/credits/refunds and full tax/finance integration remain broader handover work.

Subsequent checkpoint: [source manifest V3 and filing bundle V4](fx-source-filing-provenance.md) now preserve retained FX context locally. Remaining activation work begins with [refund/assignment dependency UX](fx-refund-dependency-ux-plan.md); financial writes remain private.

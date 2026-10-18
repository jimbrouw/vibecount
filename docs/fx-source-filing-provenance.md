# Retained FX source and filing provenance

Local migration `20261019050000_fx_source_filing_provenance.sql` extends preserved evidence context. It does not grant financial allocation/reversal, change recognised ledger effects, value foreign invoices in GBP or enable unsupported tax completeness.

## Contracts and source export

`fx_provenance_lot_sources` is an authenticated invoker-safe view over retained lot sources. It adds database-derived all-event and active-event counts. `parseFxProvenance()` validates those heads against complete ordinal history, verifies retained canonical/fact/receipt ancestry, recomputes allocations/reversals and checks aggregate original entitlement and shared receipt cash across lots. Every lot must belong to one of the selected immutable source observations. The two-megabyte provenance bound rejects oversized context rather than truncating it.

Import `format=manifest` now emits `vibecount.evidence-manifest/3`. It preserves the V2 source snapshot and source-snapshot hash, appends safe complete retained FX context and adds separate FX and whole-snapshot hashes. These are integrity checks, not authenticity signatures or continued object-availability assertions. No raw source text, paths or keys are added. The V2 manifest producer and accounting-only ledger CSV V2 remain unchanged and covered by frozen fixtures.

The route independently pages selected receipt lots and FX events by the same source IDs, with owner filters and batches of at most 100 IDs. This catches missing lot rows as well as missing history; comparing authoritative heads detects omitted trailing reversal pairs. Events are never filtered to active-only or by invoice/current-evidence dates. Before/after financial stamps enclose source/effect/provenance reads, a four-megabyte response bound applies and a successful audit is required before release. Native and FX invoice matching remain relationships rather than new recognised income.

## Filing input V3 and bundle V4

The private current filing-input function emits `filing-pack-input/3`, retaining the existing invoice-currency coverage and adding complete source-scoped FX provenance. Its base connected observations include cross-year originals/counterparts; a relationship's invoice date does not assign its cash to a tax year. Every selected lot retains its entire history, including unused bindings, zero-cash portions, reversals and source-unavailable snapshots. FX events appear once, through explicit FX context rather than native-shaped settlement rows.

Application validation checks current invoice coverage, retained totals, original invoice capacity and exact source cash/date. It derives active native allocations from complete reversal ancestry and reconciles native-plus-FX cash with every receipt balance. Referenced historical receipts remain required after full reversal, and positive source observations cannot silently lose their balances. Old input versions retain their previous validators and output bytes.

Every V3 step digest includes the retained FX context. New bundle `draft-filing-pack/4` freezes it in reconciliation, evidence manifest and calculation trace artifacts; the normalised ledger retains its accounting effects. Saved-pack verification checks trace/evidence context and recomputes the exact reconciliation CSV from frozen inputs in addition to artifact hashes. All seven outputs still share one input hash. Current and retained pack pages show currency blockers, complete context counts, retained hashes and inspection links.

External/FX currency coverage remains explicitly unsupported for tax completion. Neither app assembly nor database capture permits completeness attestation. The new input/bundle have four-megabyte direct-review/capture bounds. Larger-history delivery remains a separate acceptance gap; no partial pack is returned.

## Upgrade and recovery

Apply the reviewed migration after all predecessors and before using the new source view/current filing app. No hosted migration has been performed. The migration copies the V2 input compatibility body to a private helper and replaces the existing entry point in place, preserving OIDs and dependent calls. Capture version checks advance in place. Old capture and step-review requests recover before current-version, payload-limit, source-currentness and locking checks; altered retries reject.

Capture retains its existing input freezes and adds SHARE NOWAIT locks for conversion lots, settlements, invoice revisions, fact families/revisions and Storage objects. Actual independent PostgreSQL connections prove the conflict in both lock orders for every added dependency. These locks are brief capture safeguards, not evidence lifecycle management or a restore system. Financial writer grants remain private; explicit-owner provenance/input helpers are unavailable to application/service/anonymous callers.

## Verification and demo

Frozen manifest V2 and filing bundle V3 bytes/hashes remain unchanged. Ordered SQL tests seed actual predecessor FX captures and review requests, apply the upgrade, verify OIDs/history/retry identity, capture a new incomplete V4 pack, reject optimistic completeness and oversized payloads, preserve source context after withdrawal/object loss and retain all six events after complete reversal. Source route tests use capped pages, unselected same-owner data, missing lots, stale heads, foreign data, late errors, drift, overflow and failed audits. Model tests exercise cross-lot capacities, coherent forged receipt cash, omitted historical references and artifact tampering even with recomputed outer hashes. Current/saved page checks retain currency blockers and display the complete FX scope.

Run `npx tsx scripts/demo-fx-source-filing.ts`. `/tmp/vibecount-fx-source-filing-demo` contains an actual disposable SQL demonstration: source manifest V3, incomplete bundle V4, all seven frozen artifacts, allocated/reversed reconciliation CSVs and artifact hashes. Three KWD 10.001 / GBP 25.00 tranches include a zero-cash portion and share the GBP 25.01 receipt with a native penny. The 2025/26 pack retains that 2026/27 receipt as context with no extra year income. Source loss leaves source-manifest bytes unchanged; saved V4 recovery remains exact after complete reversal. Only synthetic evidence/metadata is used.

This is local verification, not hosted Auth/PostgREST/Storage, large-history performance, representative provider/historic acceptance or independent annual tax/form approval. Remaining financial activation work includes refund/assignment dependency UX and coordinated reviewed actions/recovery/grants. Foreign accounts/valuations, fees/credits/refunds, full tax/finance treatment, evidence lifecycle/coordinated restore, durable communications and release isolation remain broader handover requirements. No real financial approval, account connection, provider send, payment, deployment or filing occurred.

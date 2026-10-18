# FX review surfaces and connected dependencies

18 October 2026. Local review and safety stage. Financial FX approval/reversal writers remain private, and the new forms are explicitly draft-only. No hosted migration or real financial approval occurred.

## Human review and native separation

`/dashboard/reconciliation/fx` uses the actual owner-derived catalog for current evidence choices, independent original/cash capacities, exact original and actual GBP portions, rate/dates, cumulative rounding, documented limits, canonical/fact versions and retained hashes. Read-back states proposed versus persisted lot identity and zero additional income/expense. Confirmation resets when amounts, evidence, reason or authoritative context changes. Exact parsing rejects unsupported precision, differences and guessed fees. Curated validation errors explain missing or inconsistent input. A final positive-original/zero-cash portion remains selectable when the receipt cash is exhausted.

`/dashboard/reconciliation/fx/reversal?lot=…` reviews the complete retained lot’s count, aggregate original/cash release, both resulting balances, rate/dates, evidence identities and hashes. It remains reachable after current source loss or withdrawal; it does not require fresh allocation eligibility. Reversed/empty lots cannot be confirmed again. The checkbox describes the displayed count/evidence/balances; individual active portion detail still needs integration with the forthcoming versioned history/export contract before financial activation.

Both pages authenticate, reject incomplete/foreign context, use semantic labels and stable selectors, and visibly disable financial saving. They register no new financial action endpoints. The local checkbox is a draft review acknowledgement, not a database approval. Invoices, receipt income and money movement are unchanged.

Native reconciliation now reads selected native allocation history through the dimensioned view with an explicit `native_gbp` filter. FX rows have their own exact original/cash read-back and complete-lot links, including zero-cash rows; generic native reversal is not offered for them. Combined receipt capacity remains unchanged. Native pagination does not hide earlier FX dependencies.

## Complete import blocker envelope

Migration `20261019030000_fx_dependency_review.sql` adds authenticated `read_source_import_reversal_context_v2(uuid)`. It derives affected sources from the retained complete native context, all target observations and source-linked effects; this includes refund graph nodes and transfer counterparts in other imports. One stable snapshot returns exact bounded sources and every matching persisted FX lot, aggregating the lot’s whole active original/cash/count and all-event version. Block by relationship existence, including zero cash.

When FX exists, V2 explicitly sets `blocked=true` and `native_context=null`. `lib/fx/dependency-review.ts` validates complete counts, owners, IDs, source closure, currencies and event/count equations, rebuilds safe metadata, and returns a blocker-only review with no native accounting totals. The page displays each original/cash amount in figures and words, exact source links and a complete-lot review link. It explains that saving FX reversal is currently unavailable, so the import cannot yet be unblocked through these draft pages. Native reversal confirmation is absent.

When no FX exists, the V2 envelope carries the unchanged predecessor native context. The strict wrapper verifies source and stamp parity, then uses the existing complete native review. The import action checks this authoritative result before a fresh write; exact retained requests still recover through their unchanged database payload validation. The existing database writer also retains its FX guard and rechecks under the owner lock. Count/payload overflow fails the complete read; no truncation is presented as success.

## Original-receipt refund gap and upgrade

Inspection found that `active_refund_id` identifies the refund cash side, so a Business original can have refund children while its own scalar marker remains null. The predecessor private FX binder/preview omitted this direction. The public split/legacy refund writer checked allocations on refund cash but could create a separate negative effect against an active FX original without changing that original’s bank row. Active-source mutation guards alone did not close this case.

The upgrade:

- Revalidates active refund relationships in **both** directions when binding/revalidating an FX receipt.
- Upgrades the authoritative catalog to `fx-settlement-catalog/2` with required owned `active_refund_count`; allocation choices require zero. Missing metadata is not assumed zero. The retained V1 body is private; the current RPC OID and grants are preserved.
- Adds a complete-node FX check inside the private split helper used by both public refund creation paths, before mutations and after public retained-request recovery.
- Guards complete refund closure and native returned-cash assignment on linked FX originals/receipts.
- Adds owner-locked BEFORE INSERT guards on refund links and reversals, checking both linked endpoints. The reversal guard also closes the legacy single-original path that bypasses the complete-closure helper, and protects future internal callers.

Function identities and public request fingerprints/results remain unchanged. Exact old requests return before fresh checks and do not insert a new relationship. Existing predecessor-valid FX/refund combinations are retained, not rewritten; they require separate reviewed FX reversal before fresh refund changes. Both operations use the existing reconciliation owner lock, preventing new unsupported combinations in either commit order. Every guard includes zero-cash FX.

## Verification and demo

The ordered upgrade fixture reproduces the predecessor combination with a KWD 0.001 / GBP 0.00 lot and a separately imported refund. It verifies unchanged function OIDs, links, recognised rows and exact request recovery; original-side refund count; outside-import blockers; split/legacy/direct-insert rejection; complete and legacy refund reversal rejection; fresh FX rejection; native preview parity after private complete-lot reversal, and exact completed legacy refund reversal/approval recovery after a later fresh FX allocation. Native independent PostgreSQL connections exercise refund-versus-FX approval in both commit orders and a refreshed post-refund FX request.

Model/route tests cover complete/foreign/malformed envelopes, safe projection, no native totals/confirmation while blocked, current-context/stamp checks, unavailable reads, source-loss retained reversal and privacy. The browser suite uses the real components with synthetic metadata and checks figures/words, proposed/persisted identity, edited/refreshed confirmation resets, exact amount mismatch rejection, final zero cash, retained reversal after source loss, source/lot routes and disabled saves. These fixtures do not prove signed-in hosted Auth/PostgREST/Storage behavior.

Run `npx tsx scripts/demo-fx-dependency-review.ts` for `/tmp/vibecount-fx-dependency-demo`. Actual ordered SQL preserves a predecessor refund/zero-cash FX relationship, exposes the connected original outside the refund import without native totals, recovers historical refund results and returns the native import preview after a private FX reversal. All output is safe synthetic metadata. The earlier catalog demo now applies the V2 upgrade as well.

## Remaining activation and full handover work

Complete individual retained portion review, refund closure/split/assignment dependency UX, versioned complete reconciliation/source exports and filing provenance, then connect reviewed server actions, recovery/pending handling and SQL grants together. Do not enable financial writers merely because preview forms exist. Preserve tax/filing/finance unsupported coverage until each branch is supported.

The full handover also retains foreign accounts/GBP valuations, fees/credits/refunds, complete tax/finance integration, evidence lifecycle/coordinated database/object/key restore, durable communications, representative provider and hosted journeys, complete historic evidence, independent annual tax/form review and release isolation. No bank connection, hosted migration, real approval, provider send, payment, deployment or filing occurred.

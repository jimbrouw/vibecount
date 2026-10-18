# Foreign invoice matched to actual GBP cash

17 October 2026. Implementation plan for FX stage B; no writer, foreign invoice row or application approval is created by this document. See [the complete FX design](fx-reconciliation-design.md) and [verified arithmetic foundation](fx-arithmetic.md). Later foreign-account, fee, refund/credit and tax/filing integration remain required; this slice does not redefine full FX completion.

## Reuse and compatibility findings

Use the existing invoice family, immutable revisions and `invoice_settlements`, with independent original-invoice units and actual GBP cash. Existing source accounts/observations and recognised effects remain GBP during B. Never introduce a duplicate accounting ledger or an income posting from matching.

Do not relax `invoices.currency` first. The native revision writer hardcodes GBP, native economic fields mean pence, and invoice balances/sync subtract cash pence from invoice pence. Native revisions require invoices-bucket retained PDFs; encrypted external evidence is a different source contract. The dashboard's recent-invoice selection and project types omit currency, matching reads GBP-shaped balances, reconciliation exports label invoice columns pence, and filing capture retains those same contracts. These must be upgraded or explicitly guarded before a foreign row exists.

## Proposed first supported contract

- Preserved external invoices, with owned original evidence and explicit human review; no fake native PDF and no legacy version-zero bypass. Native foreign invoice generation is not necessary to accept preserved historic evidence and remains separately scoped.
- Support the five foundation currencies consistently, including zero/three-decimal original units. Native GBP writes and old artifact bytes retain their existing pence contract. Do not silently treat KWD minor units as GBP pence.
- Preserve zero-cash cumulative tranches as explicit FX relationships with positive original units. Keep native GBP settlement cash strictly positive. Matching creates no financial record in either case.
- Fee/gross-up, foreign receipts, cross-currency transfer/refund/credit and tax treatment remain unsupported in B; implement them explicitly in C–D, not as an invented rate difference.
- Every import review must discover FX dependencies. Until the full import coordinator can safely reverse the complete FX lot, require an explicit reviewed FX match reversal first, with a reachable blocker and exact source links. No hidden unmatched dependency or partial discard.

## Additive database design to rehearse

1. Extend the existing invoice family with origin, currency ruleset and canonical original minor total, plus foreign-source revision/evidence relationships. Native GBP economic fields remain GBP-only. A foreign revision freezes original currency/amount/document hash, reviewer/reason and exact request result. Prevent direct foreign creation/mutation and preserve deletion guards.
2. Choose the canonical compatibility strategy through SQL rehearsal. Widening the shared two-decimal `amount` type can change PostgreSQL decimal scale and break existing GBP parsers even when values are mathematically unchanged. Preferred candidate: retain the existing GBP amount field as a conditional GBP compatibility value, nullable/unavailable for foreign invoices, and use explicit original minor totals for foreign economics. All old readers must filter/guard currency so null is never silently reported as zero. Do not populate a made-up GBP equivalent. Check constraints/triggers and native writers must preserve existing GBP wire values and snapshots. This needs migration/upgrade fixtures before final DDL.
3. Keep existing settlement `amount_pence` as actual observed GBP cash. Add an FX kind and separate original invoice units/currency, invoice revision, conversion lot/version and immutable proof/rate/date snapshot. Existing GBP history is unchanged. FX-only zero cash needs a strict conditional constraint. Receipt capacity includes both kinds; invoice capacity uses its own units.
4. Persist immutable owned invoice/conversion evidence revisions tied to `evidence_documents` and exact invoice/source versions. Persist conversion lots or derive their current state from immutable active event history. Bind every expected evidence/lot revision in intent and include all new revisions in a complete financial stamp. Prior source/target totals must agree with active retained relationships, not client balances.
5. Introduce dimensioned foreign balances and paid-state synchronization. Keep old pence balance/credit/refund views explicitly GBP-only. Ordinary GBP allocation/credit/refund-assignment writers must reject foreign invoices. Generic reversal must dispatch to lot-aware review or block; arbitrary earlier-tranche removal cannot recalculate later rounding.
6. Atomic owner-derived catalogs return complete bounded source/proof/lot counts and safe metadata. Approval recovers exact historical request before live reads, acquires the owner reconciliation lock, checks stamp, locks invoice/source/effect meaning, rereads/rechecks, recomputes conversion and inserts only settlement/audit/request history. Assert recognised records unchanged. Reversal retains old amounts/rates, source bytes and request results.

## Coordinated consumers before enabling rows

- Currency-aware dashboard/project invoice display, totals grouped by currency and explicit foreign review links; do not quietly remove foreign invoices from all totals.
- Native edit/revision/finalise, PDF/download/share/history and reminders must guard origin/currency or serve the preserved foreign source under its correct evidence contract. No native GBP regeneration or stale send of foreign evidence.
- Receipt allocation balances include FX cash. Existing transfer/refund/duplicate/reclassification guards must continue seeing every active settlement dependency.
- Matching, reconciliation CSV, source manifest and invoice history retain both currencies/amounts, conversion proof/rate/date and zero-cash tranches. Version changed export shapes and preserve historical verifiers/artifact bytes.
- Filing input/source closure, incomplete-pack gating, safe backup export and tax/finance projections must include or explicitly withhold unsupported FX provenance. A legacy partial projection cannot certify completeness.
- Contain pre-existing parked MCP invoice reads/writes so foreign values cannot appear as implicit GBP; do not extend Phase 4 functionality.

## Acceptance sequence

Replay the ordered chain and realistic native/legacy upgrade fixtures. Capture a preserved foreign invoice and reviewed conversion evidence; classify actual GBP cash through the existing gate; match partial/full amounts; prove current original/cash capacities, lot rounding, zero new income, same/fresh/reordered request behavior and late rollback. Reverse complete required lot history and preserve both original evidence and historic snapshots. Produce complete dimensioned source/reconciliation exports. Test foreign/anonymous denial, independent-connection races, missing/foreign/stale proof, 5/6 April dates, GBP-only compatibility and imports with FX dependencies. Add the real human review form and confirmation resets only against the authoritative catalog/writer, then verify signed-in hosted behavior separately.

No provider selection, bank connection, real tax-rate assumption or production migration is needed to implement/rehearse this local contract. Explicitly sourced annual tax/VAT/fee/timing rules and independent review remain production treatment gates.

## Earlier evidence persistence checkpoint

The local document-fact persistence, owner-safe authoritative catalog and current-source/retry/withdrawal contracts are implemented in migrations `18130000` and `18140000` and `lib/fx/document-facts*.ts`. The second migration corrects multi-purpose preview/save registration parity and invalidates pre-upgrade pending context while retaining exact old request results and snapshot bytes. This completes the backend preparation portion only. A human evidence form/action, controlled readable-source workflow and every canonical foreign-invoice/financial settlement/currency-aware consumer step above remain required. See [reviewed FX document facts](fx-evidence-review.md).

## Human review checkpoint

The local human evidence page/action, local-only original hash gate, explicit attestation/read-back and paged immutable history now exist at `/dashboard/reconciliation/fx/evidence`. Migration `18150000` additionally rejects document registration changes during source capture; a native deterministic regression reproduced and fixed the predecessor's incorrect saved provenance. These are evidence preparation, not canonical foreign invoices or FX settlement. The coordinated currency schema, guarded capture/matching/reversal, currency-aware consumers and later foreign-account/fee/tax integration remain required.

## Canonical invoice compatibility sequence

The next coordinated work preserves native `numeric(12,2)` amounts and historical payloads. Add `origin = native_gbp` with nullable external-only original-minor/ruleset/source-fact links; native originals are derived exactly from their existing amount rather than duplicated in a second mutable total. Preserve all old invoice/revision snapshots and timestamps. Keep both GBP currency and native-only origin constraints until every reader is ready for the external branch.

First close native edit/PDF/download/share/history/delivery/paid/reminder boundaries with one strict explicit origin/currency/amount guard. Native revision recovery must retain its existing payload/hash and verify the retained revision's native origin; failed or absent metadata must not become zero GBP. Add native-only relationship guards for settlement/credit/returned-cash/record links and a native revision SQL guard. Prove legacy native capture/recovery and wire values against a predecessor-to-forward migration fixture, plus direct non-native/missing metadata route/action tests with no PDF/provider/writes.

Then add the dimensioned dashboard/project/list/export readers and filing/finance/parked-consumer containment. Only after those are proven should a forward migration replace the native-only branch with a strictly checked external branch, allow null compatibility `amount`, extend immutable revisions with actual evidence contracts and expose reviewed canonical capture (one invoice per evidence family). Preserved external GBP also needs origin guards; currency alone never authorizes native PDF or delivery. Foreign balances/settlement lots and actual FX matching/reversal follow as one coordinated financial slice. These intermediate compatibility changes are prerequisites, not a claim that foreign invoices or FX settlement are enabled.

## Native compatibility checkpoint

The first compatibility stage is implemented in `18160000` and native application boundaries. It adds external-only metadata slots without duplicating native amounts or rewriting old evidence, and guards native actions/documents/reminders and contextual relationships. Both currency and native-only origin constraints keep external rows disabled. The dimensioned consumers, strict external schema/capture and financial settlement work above remain required. See [native invoice compatibility](native-invoice-boundary.md).


## Currency reporting prerequisite checkpoint

The local dashboard and projects now validate explicit native/external amount representations and group original totals by currency, keeping recognised GBP ledger/cash amounts separate. Complete paged reads use financial stamps; unavailable metadata/balances withhold totals. External projections have no native dashboard Storage/actions or ordinary project-tag path. No external rows are enabled. See [invoice-currency-reporting.md](invoice-currency-reporting.md) for tests and remaining balance/export/financial-reader gates.


## Reconciliation export prerequisite checkpoint

Current reconciliation downloads use `vibecount.reconciliation/3`: existing financial columns remain GBP; separate document rows retain original currency, integer units, captured evidence family/revision and source hash. Complete paging and native coverage are checked under the financial stamp; external financial relationships remain unsupported and reject. The V2 serializer remains byte-compatible. External canonical rows remain disabled. See [currency-reconciliation-export.md](currency-reconciliation-export.md); partial-account export, other consumer coverage and actual FX settlement exports still require completion.


## Partial account export prerequisite checkpoint

The existing account JSON route now has a versioned explicit six-table projection, exact currency representations, selected invoice revision metadata, complete paging and a dedicated owner-derived before/after context. It omits source/snapshot/path/credential content and expressly cannot restore an account or certify FX evidence/settlements. See [partial-account-export.md](partial-account-export.md). External canonical rows remain disabled; actual FX capture/settlement and remaining financial-reader coverage are still required.


## Operational review and quarterly coverage checkpoint

The current review and quarter-check paths now consume an owner-derived catalog with complete counts, signed GBP totals, bounded examples, actual native outstanding, original-currency invoice groups and explicit unsupported external/source coverage. AI sharing needs per-request consent and server token revalidation; only generated/numeric metadata is sent. External canonical rows remain disabled. See [financial-review-coverage.md](financial-review-coverage.md); tax/filing/finance closure, native balance isolation, parked-consumer containment and actual FX financial capture remain required.


## Native balance isolation prerequisite checkpoint

Migration `18190000` now restricts the unchanged 24-column GBP balance projection to complete native rows, with matching contextual relationship guards. Actual predecessor/forward RPC history preserves native values, source history, grants and exact retries; malformed/external candidates are excluded rather than interpreted as GBP. External canonical rows remain disabled. See [native-invoice-balances.md](native-invoice-balances.md). Remaining currency coverage in tax/filing/finance and parked consumers must precede strict external capture and actual dimensioned settlements/reversal.


## Tax and filing coverage prerequisite checkpoint

Migration `18200000` wraps the existing authoritative tax/filing input builders with current v2 owner-wide invoice coverage, preserving baseline financial stamps and old saved bytes/retries. Unsupported external GBP/foreign and invalid representations block affected estimates/completeness; all new step digests bind coverage. New V3 packs retain separate original document metadata and coverage evidence. Native-only canonical constraints remain. See [tax-invoice-currency-coverage.md](tax-invoice-currency-coverage.md). Finance's manual GBP scenario snapshot needs a separate versioned extension; parked-consumer containment and all actual external capture/FX financial integration gates remain required.


## Finance coverage prerequisite checkpoint

Migration `18210000` now versions current finance contexts, inputs and results around the unchanged manual GBP scenario. Complete owned invoice coverage binds current review/save; unsupported external GBP/foreign or invalid representations withhold effective free cash and drawings without converting original units or rewriting historic plans/rules/retries. Deadline amounts remain explicit entered obligations. See [finance-invoice-currency-coverage.md](finance-invoice-currency-coverage.md). Parked-consumer containment remains the next prerequisite before canonical external capture/correction; actual dimensioned FX financial integration and other handover acceptance remain incomplete.


## Parked financial read containment checkpoint

The four pre-existing parked financial read routes now validate native invoice identity/exact amounts, signed recognised GBP effects and exact quarter summaries. Unsupported representations, query failures and failed read audits withhold data; related-owner checks and existing bank-number redaction guard returned labels. No new capability, scope, schema or external financial support is added. Parked draft/session/privacy limitations remain release-isolation concerns. See [parked-consumer-containment.md](parked-consumer-containment.md). The next implementation is strict one-family canonical external capture/correction and coordinated dimensioned settlement/reversal, preserving native PDF and historical contracts.


## Retained-source proof prerequisite checkpoint

Inspection before canonical enablement found that local-copy matching/human attestation did not prove retained encrypted bytes could be decrypted. A separate owner-scoped stored-copy check now privately verifies key/context/hash/size/signature and records immutable success/failure metadata. No raw evidence is exposed; exact old checks remain historical after source loss. External constraints stay closed. See [invoice-source-read-checks.md](invoice-source-read-checks.md) and [canonical capture design](external-invoice-capture-design.md). Next is actual guarded one-family capture/correction using current source proof, followed by all dimensioned financial workflows.


## Reviewed canonical external document checkpoint

Migration `18230000` and `/dashboard/reconciliation/fx/invoices` now implement local canonical capture/correction with positive sourced revisions, complete capture-bound private proof and direct-write/delete/origin/history guards. Native row/snapshot/request contracts remain; document capture adds zero accounting or settlement effects. Expanded SQL, real-byte application harness, independent-connection races and browser gates are described in [external-invoices.md](external-invoices.md). Earlier closed-constraint/absent-capture statements above are historical checkpoints. There are now 63 local migrations / 38 untracked additions; hosted state is unverified.

Next is the dimensioned settlement stage already designed above: persisted conversion lots, independent original/cash/GBP capacities, cumulative rounding including zero-cash tranches, coordinated reversal/dependency discovery and complete exports. Existing detached `lib/fx/settlement.ts` must be bound to authoritative canonical source facts and active relationships, not copied into a parallel accounting model. Foreign accounts/fees/refunds/credits, tax integration, lifecycle/restore, durable delivery, provider/hosted acceptance and independent annual review remain required.


## Private conversion-lot binding checkpoint

The detached review now enforces the complete documented original/cash limits, including cumulative prior tranches. Migration `19000000` freezes exact canonical/source/receipt recipes and prevents duplicate family/recipe rounding resets through private, current-source-checked binding. This adds no financial approval or settlement capability and reserves no capacity. See [fx-conversion-lots.md](fx-conversion-lots.md) and [the coordinated persistence sequence](fx-persistence-plan.md). There are now 64 local migrations / 39 untracked additions. Actual dimensioned writer/reversal/catalog/stamp/exports and all later FX/handover scope remain required.


## Private settlement and reversal checkpoint

Migration `19010000` now persists dimensioned events in the shared settlement table, keeps combined actual GBP receipt capacity, derives original external balances separately, and implements private allocation/complete-lot reversal with zero-cash dependencies and current public/owner stamp parity. Native entry-point OIDs, historical row/result contracts and native balance semantics remain. The final current tree passes 536 automated tests and clean production build. Financial entry points remain private pending authoritative catalog, visible human review/blockers and versioned exports; full stage B/C/D and the handover remain unfinished. See [dimensioned-fx-settlements.md](dimensioned-fx-settlements.md). There are now 65 local migrations / 40 untracked additions; hosted state is unknown.

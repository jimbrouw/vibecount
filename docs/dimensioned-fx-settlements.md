# Private dimensioned FX settlement and complete-lot reversal

18 October 2026. Local stage B persistence. **Financial entry points remain private** until catalog, human review, blockers and exports are integrated. No hosted migration or real financial approval occurred.

## Shared relationships and units

Migration `20261019010000_dimensioned_fx_settlements.sql` extends existing `invoice_settlements`; it does not create a second accounting ledger. `amount_pence` always means actual observed GBP cash. Existing rows acquire `settlement_kind='native_gbp'` and null new metadata; native cash remains strictly positive. Only the strict FX branch permits zero cash alongside positive original units, exact canonical revision, conversion lot, monotonic event ordinal and immutable dimensional snapshot.

The original active allocation view keeps its column contract and includes both kinds. Existing receipt sums therefore count native and FX cash together; EXISTS-based classification/refund/transfer/duplicate dependency checks also see zero-cash FX. A separate `active_dimensioned_invoice_allocations` view exposes the new fields. The native 24-column balance view remains isolated and unchanged. `external_invoice_settlement_balances` reports original entitlement/outstanding separately from actual GBP cash, deriving settlement state without mutating external/native PDF, paid or delivery fields. No original document amount becomes a GBP valuation.

Only the settlement relationship trigger becomes dimension-aware. Credits, returned-cash assignments and financial-record invoice links remain native-only. External corrections retain their existing settlement-history prohibition.

## Private approval

`approve_fx_invoice_allocations(jsonb)` uses the existing exact intent model and one to 50 distinct invoice portions. The initial persisted contract is preserved external invoices matched to already-approved GBP receipts, no fees or foreign-account valuation. Intent normalization checks exact fields/types, bounded units/counters/dates, canonical UUIDs, rational rates and deterministic invoice ordering.

It authenticates ownership, recovers identical requests before current sources, locks the owner reconciliation boundary and source tables, checks the full evidence/financial stamp, and binds each exact current lot recipe. It verifies canonical/fact/family/receipt versions and derives prior counters from retained active events. The settlement trigger independently recomputes the snapshot and tranche, enforces documented limits plus independent invoice and shared receipt capacities, and checks monotonic event order. Late failures roll back all new lots, allocations and request history. Matching creates zero financial records and changes zero recognised income/expense.

Snapshots retain source/record/import identities, observed cash and recognised GBP receipt value, cash/value/conversion/evidence dates, currency rules, normalized rate, documented limits and exact cumulative rounding. Repeated zero-cash portions still consume original entitlement and advance lot history. Unlike original currencies are never summed.

Exact request recovery uses immutable method-specific SHA-256 fingerprints in existing settlement request history. Changed or cross-method requests reject. Historical recovery does not restore current source eligibility. A new approval cannot use a lost, withdrawn or superseded source or a changed receipt/effect.

## Reversal and mutation boundaries

`reverse_fx_conversion_lot(uuid,text,text,uuid)` releases the complete active lot in descending allocation order, copying exact historical dimensions and rounding snapshots. A trigger rejects earlier-portion removal while later active portions remain. Reversal requires current reviewed context, not live source eligibility, so it works after evidence withdrawal or object loss. Its exact result recovers before current context. Audit failure rolls back every child reversal and request.

There is a 10,000-active-portion review limit. Approval also enforces that limit so it cannot create a lot beyond the current complete-reversal capacity. Large-history performance/hosted payload acceptance is still a release check; the bound is not performance certification. Advanced suffix review remains separate.

Generic native reversal instructs callers to use complete FX reversal. Completed native requests still recover first. Fresh legacy import reversal rejects active FX on any affected source before presenting native pence balances; a dimensioned blocker catalog and reachable human reversal page remain required before activation. The current generic unavailable screen is not the final FX review UX.

Database guards block updates/deletion of active FX receipts/imports and changes, inserted effects or new links affecting their recognised records. They check old and new source identities under deterministic owner locks. Zero cash blocks by relationship existence. Direct effect edits racing approval either serialize before review and invalidate context, or wait and reject after settlement commits. Raw source loss/withdrawal can invalidate current evidence without rewriting settlement history or preventing reviewed reversal.

## Stamps and compatibility

Current public and private owner-derived financial stamps include lot/evidence/source provenance while retaining the exact old value for owners with no lot history. Old v19/v21 subexpressions and saved request/artifact meanings remain intact. Compatibility bases are copied, and current functions are replaced in place to preserve function OIDs, view dependencies and ACLs; renaming the old public function would leave a tax view bound to the private predecessor.

Evidence-only review now compares its zero-effect assertion with the preserved accounting/commercial base. Its two full evidence freshness checks remain intact. Evidence provenance can invalidate review context while recognised amounts remain unchanged. Public/owner stamp parity and a dependent tax view are explicitly exercised.

## Verification and demo

Ordered predecessor/forward tests prove native row/view/event bytes and old allocation/reversal recovery, stable entry-point OIDs, owner stamp parity, partial and mixed KWD/USD batches, cumulative limits, exact retries, late allocation/reversal/batch rollback, old/new record-link guards, private grants/owner isolation, complete source-loss reversal and restored independent balances. An actual zero-cash allocation blocks mutation/import reversal even when summed cash is zero. A final zero-cash tranche succeeds with the receipt cash exhausted by native allocations.

Native independent connections prove identical/competing requests, native/FX competition for one receipt, record changes in both commit orders, allocation versus reversal, and stale-review rejection. These tests use a disposable local PostgreSQL cluster and Supabase-style schema shim, not hosted Auth/PostgREST/Storage.

Run `npx tsx scripts/demo-fx-settlements.ts` for `/tmp/vibecount-fx-settlement-demo`. Actual ordered SQL links KWD 10.001 to GBP 25.00 within a previously approved GBP 25.01 synthetic receipt. Three cumulative portions preserve a final positive-original/zero-cash allocation; one penny remains unallocated. Exact approval recovers after object loss; complete reversal releases both capacities and preserves recognised receipt bytes and native row values. Only safe metadata is emitted. Invoice encryption is real on synthetic PDF-shaped bytes; bank transport is fixture metadata. This is not actual human review or full hosted settlement/export acceptance.

## Remaining activation and full handover gates

Add the authoritative complete catalog/current lot versions, dimensioned app read-back, visible connected-source blockers, reviewed matching/reversal forms, versioned reconciliation/source export integration and filing provenance before granting the financial writers. Retain explicit unsupported tax/filing/finance coverage until each financial branch is integrated. UI routes and browser behavior are unchanged by this persistence step; preceding browser results are historical.

The full goal also retains foreign accounts/valuations, fees/credits/refunds, tax integration, evidence lifecycle/coordinated restore, durable communications, representative provider/hosted journeys, independent tax/form review and release isolation. This private persistence step does not complete stage B or the handover.

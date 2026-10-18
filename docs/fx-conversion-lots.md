# Private persisted conversion-lot bindings

18 October 2026. Required stage B foundation; **not a financial settlement workflow**. No public approval RPC, matching UI or allocation is enabled by this change.

## Evidence capacity and authoritative binding

The detached settlement review previously checked rate/date and invoice/receipt availability without limiting a lot to the portions documented by conversion evidence. `FxEvidence` now requires original/cash portion limits. The review checks that the complete documented conversion matches its rate, fits the original invoice/observed receipt, and bounds cumulative prior-plus-new original/cash amounts. Exact tranche and independent invoice/receipt capacity checks still apply. Results include documented limits and remaining amounts. Unknown or missing limits reject. Currency amounts are never added across unlike units.

Migration `20261019000000_fx_conversion_lot_bindings.sql` adds immutable `fx_conversion_lots`. Each recipe binds:

- An owned canonical external invoice and exact positive canonical revision, plus its captured invoice fact revision.
- A latest verified conversion fact/family/document and the exact approved GBP receipt decision it certifies.
- Supported currency rules, original/cash limits, normalized rational rate, conversion/evidence dates and safe frozen source ancestry.

The private `bind_fx_conversion_lot` helper authenticates owner identity, takes the existing reconciliation lock and SHARE NOWAIT source locks, validates current canonical/evidence/registration/object state and complete approved Business GBP receipt provenance, and recomputes exact conversion. The full proof limits must fit original invoice and observed receipt. Repeated exact binding preserves its ID; changed source identity rejects. A unique conversion family/revision and unique canonical/receipt/document/rate/date recipe prevent independent lots resetting cumulative rounding. A static insert trigger independently checks immutable source closure and rejects forged rates/limits/dates/snapshots/ancestry.

The helper is invoker-only and execution is revoked from anonymous/authenticated/service roles. Table writes are also revoked; authenticated SELECT is owner-scoped and service SELECT remains operational. An enclosing reviewed financial RPC must eventually call the helper inside the same transaction as allocation. There is no standalone human action that treats creating this recipe as settling or reserving money.

## Currentness and remaining integration

An existing lot is history, not authority to allocate. Fresh helper use revalidates sources even when the ID already exists; supersession, withdrawal, source loss or changed receipt decisions can invalidate it without rewriting history. Future exact financial request recovery belongs before fresh binding. It must remain available after source loss and cannot depend on the binding helper returning live eligibility.

A bound lot **reserves no cash or invoice capacity** and creates no settlement or recognised effect. Current schema still rejects external financial relationships. Existing financial stamps, native views and historical artifacts are unchanged because this step creates no financial event. Before activation, the writer/catalog must derive counters from immutable active events, include lot/FX/evidence state in public and owner-derived stamps, combine native/FX receipt capacities, integrate zero-cash dependencies, preserve reversal history and update exports. A canonical correction can leave old recipes as stale history; the future writer must bind the exact current canonical revision. Lot replacement/generation under changed source proof needs explicit reviewed lifecycle design rather than resetting counters.

See [the persistence sequence](fx-persistence-plan.md) for remaining approval/reversal/catalog/export stages and the full handover scope. Foreign accounts/valuations, fees/credits/refunds, complete tax integration, evidence lifecycle/restore, communications and hosted/independent acceptance remain unfinished.

## Verification and synthetic demonstration

SQL tests replay actual predecessor/forward migrations, preserve an already recognised GBP receipt, bind KWD original units to documented GBP cash, reject duplicate rounding recipes, verify owner/anonymous/service grants and immutability, reject privileged forged recipes, retain positive-original/zero-cash evidence, and reject fresh use after receipt reclassification, conversion withdrawal or parent supersession. Native independent connections prove same/different lot contention and source-object deletion in both commit orders. No lot creates a settlement.

Pure review tests cover cumulative evidence limits independently of invoice/receipt availability, malformed/missing limits, exact foreign scales and final zero-cash tranches. These models do not establish a persisted foreign-account valuation feature.

Run `npx tsx scripts/demo-fx-conversion-lots.ts` for `/tmp/vibecount-fx-conversion-lot-demo`. Actual ordered SQL and synthetic evidence bind KWD 10.001 to documented GBP 25.00 within an already approved GBP 25.01 receipt. A second recipe has positive original units and zero cash. Duplicate reset and fresh use after source loss reject. Existing income remains byte-for-byte unchanged, and zero settlements are created. Safe scalar metadata only is exported. The invoice encryption is real on synthetic PDF-shaped bytes; bank transport uses fixture metadata. This does not prove hosted Auth/Storage, PDF rendering, human source review or the full settlement/reversal/export journey.

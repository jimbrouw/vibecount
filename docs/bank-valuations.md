# Private foreign-bank GBP valuation persistence

Migration `20261019090000_private_bank_valuations.sql` implements the persistence prerequisite in the [foreign-account valuation plan](foreign-account-valuation-plan.md). This is not foreign ingestion or financial activation. No hosted migration, real evidence review or financial approval occurred.

## Existing observation model, closed admission

Two nullable fields extend existing `bank_transactions`: `original_signed_minor` and `source_units_ruleset`. No rows are backfilled. Native GBP retains its actual non-null pence and null foreign fields. The future foreign representation requires a supported non-GBP code, nonzero bounded original units, explicit currency ruleset and null GBP pence. Foreign units can never be stored as pounds.

The existing account/transaction **GBP-only checks and source pence NOT NULL remain intact**. They keep the foreign branch unreachable through the current schema/application. The existing source-immutability function retains its identity and protects both new fields. No current parser, ingest function, writer grant or native financial core is replaced.

Only disposable fixtures temporarily remove those admission guards to test actual future foreign shapes. The demo does so in a transaction that is rolled back, then verifies the production constraints and empty history are restored. This is not a production migration strategy or permission to bypass review.

## Immutable valuation histories

- `bank_valuation_families`: one owned family per observation.
- `bank_valuation_revisions`: ordinal/predecessor, provisional/reviewed/withdrawn state, captured decision version, exact rate/method/dates, source/document snapshots, signed GBP value and complete conversion trace, human original-read attestation, author, rationale and request.
- `bank_valuation_requests`: exact normalized intent and retained result.

All histories are immutable, owner-readable under RLS and deny direct caller writes. Every new writer/helper is private and revoked from authenticated, anonymous and service roles. `record_bank_valuation(owner,intent)` is an invoker core, not an application endpoint. A later narrowly reviewed wrapper must derive the owner from authenticated context; no browser action is enabled here.

`bank-valuation-intent/1` accepts exact typed fields and `documented_rate/1` with a positive original-to-GBP rational rate, valuation date and evidence date. These dates remain distinct from immutable source cash date. The recorder derives the GBP amount from original signed units with existing exact integer arithmetic. Positive and negative original direction is retained. A nonzero original may legitimately round to zero GBP; it remains a reviewed zero valuation, not missing information and not a fabricated positive posting.

**Valuation creates no classification, financial record, settlement or cash movement.** Human-reviewed rate/evidence is not tax treatment, private byte verification or posting authorization. Classification and any nonzero recognised accounting effect must be separately reviewed in the later full workflow. Method/version names do not establish a tax-approved rate policy.

## Closure, freshness and recovery

The private source helper independently joins owned transaction/account/import/source-file/source-row identities. Account currency must match the actual observation; source row/import and source file/account/hash must close exactly. Parser V2, supported ruleset, bounded date/row/file, active import, clear dedupe and available retained source object are required. Transfer/refund tags cannot masquerade as ordinary valuation sources. Registered PDF/image evidence comes from the existing safe document projection; paths, keys, filenames, descriptions and raw rows are excluded from valuation snapshots.

Fresh writes bind exact current decision version, head ordinal and private context stamp under the owner reconciliation lock and SHARE NOWAIT table freezes. The private stamp covers only the explicitly frozen source, registration, valuation and financial-dependency inputs. It does not inherit unrelated invoice/tax/FX fact dependencies. Static insert closure independently recomputes source, normalized rate, sign, value and trace. Deferred request/revision closure rejects missing requests, missing revisions and contradictory result/intent history.

Approved recognised effects and active settlement, transfer or refund relationships block a fresh successor/withdrawal until separately reviewed reversal. This prevents valuation correction from silently rewriting accepted accounting. The recorder itself does not reverse any dependency.

Exact completed requests recover before mutable sources, source availability or current head. A changed intent under the same ID rejects. Withdrawal copies prior exact source/data/conversion snapshots and remains possible after object loss when no financial dependency needs release. Nothing is deleted or inferred anew.

`bank_valuation_source_current` requires the latest reviewed head, matching immutable economic identity, active source availability and exact retained evidence registration. It deliberately ignores later classification decision-version increments: future classification must check the captured version before posting, but its own version increment cannot invalidate the same linked economic valuation. Currentness is a metadata predicate, not proof that bytes were read or an accounting/tax approval.

## Verification and demonstration

The focused SQL/native/model run passes **17 tests**. Actual predecessor upgrade preserves source-guard OID, native GBP source fields/timestamps, recognised records and existing ingest/classification/FX-core definitions/grants. Tests exercise owner/role boundaries, every private helper grant, exact retry, stale version/head/stamp, account/import/row/currency closure, signed and zero conversion, source loss, withdrawal, immutable histories, privileged forged revisions, deferred orphan rejection and approved-effect blockers.

Independent PostgreSQL connections prove same-request owner-lock serialization, source deletion versus valuation in both orders and decision mutation versus valuation in both orders. The decision-first case observes the existing source-update advisory lock, then verifies stale review rejection after commit. These are real competing privileged writers; permission denial is not used as lock evidence.

Run:

```sh
npx tsx scripts/demo-bank-valuations.ts
```

`/tmp/vibecount-bank-valuations-demo` contains safe synthetic history and an independently hashable manifest. KWD -10.001 at 2.5 yields GBP -25.00; a successor rate yields zero; withdrawal after object loss retains the exact source and trace. JPY 1 at 0.005 demonstrates GBP 0.01 under the tie rule. Real synthetic source encryption and a separate retained PDF hash/signature check pass, without implying the recorder performed those checks. The demo creates zero accounting/classification/settlement effects, rolls back every fixture/guard change, and verifies closed admission afterward.

## Migration, limits and remaining work

Apply only after reviewed predecessors and compatible application scope. This additive prerequisite retains old request/snapshot/artifact bytes and native pence meaning. After use, preserve request/revision/source/key ancestry and repair forward rather than destructively dropping history.

Table locks freeze database metadata, not external object bytes indefinitely. `available` proves a storage metadata row, not authenticated readable bytes. A later full-intent private byte check must separately use bank `sourceContext` and document `documentContext`, recorded keys, hash/size verification and key/plaintext wiping. Existing invoice capture/settlement proofs cannot authorize a bank valuation posting.

The complete next steps remain versioned source/tax/filing/finance coverage and native-consumer containment, guarded V2 ingestion/recovery, valuation evidence proof, final human classification/posting, corrections/reversal and full end-to-end export acceptance. Foreign transfers, fees, cross-currency credits/refunds and invoice matching require separate complete treatment. Representative formats, hosted Auth/PostgREST/Storage, large-history performance, coordinated restore and independent annual tax review remain unproven.


Final local checks: **644 automated tests passed**, zero failed/cancelled/skipped; lint, standalone TypeScript, secret/whitespace checks and clean production build including TypeScript passed. Previous ignored build output was preserved; public build values were non-production placeholders. No UI changed, so prior browser results are not claimed as a new execution. Next: [complete source coverage and containment](foreign-source-containment-plan.md).

# Reviewed FX financial actions and exact recovery

Local migration `20261019080000_reviewed_fx_requests.sql` activates narrowly scoped authenticated FX matching and complete-lot reversal through a saved review and a separate final human confirmation. It reuses the existing private financial cores and fingerprints. No hosted migration or real financial approval was performed.

## User journey

1. Select the current owned receipt/invoices/lots or complete retained reversal. Review original units, GBP cash, dates, rates, sources, capacities, cumulative tranches and reason in figures and words.
2. Confirm **Save review and continue**. This freezes the full exact intent and SQL-derived safe snapshot. Preparation creates no source proof, conversion lot, financial request, settlement or recognised posting.
3. The saved request page displays frozen values without editable financial fields. A separate checkbox and **Confirm exact FX match** or **Confirm complete FX reversal** submits only the saved request ID plus confirmation.
4. New matching reloads authoritative current review and privately verifies both retained invoice and conversion evidence. SQL independently checks current state and a verified, exact full-intent proof no older than five minutes and not future-dated. Complete reversal checks every retained active portion, including positive-original/zero-cash portions; current object availability is unnecessary for releasing the relationship.
5. The same page displays verified completed, cancelled or awaiting-confirmation state. Preparation uncertainty explicitly says that step attempted no financial action. Execution uncertainty stays attached to the exact saved ID, with checking/retry instructions rather than a replacement ID.

One unresolved FX review per owner is enforced under the reconciliation lock, across complete history rather than a capped list. A separate explicit cancellation can release an uncompleted review so current sources can be reviewed under a new ID. Cancellation is immutable and cannot succeed after a financial result. The execute and cancel forms share a pending lock; neither can be submitted through the UI while the other is pending. SQL serializes their outcomes independently.

## Persistence and grants

- `fx_reviewed_requests`: immutable owned kind, complete normalized intent, SQL-derived `fx-reviewed-snapshot/1`, author and server time.
- `fx_reviewed_request_cancellations`: immutable owned cancellation ancestry.
- `prepare_fx_reviewed_request`, `commit_fx_reviewed_request`, `cancel_fx_reviewed_request`, and safe single/index readers: authenticated-only SECURITY DEFINER functions with empty search paths and derived `auth.uid()` ownership. No anonymous or service execution.
- Direct caller writes to the new tables are denied. The original `approve_fx_invoice_allocations` and `reverse_fx_conversion_lot` cores and private helpers remain ungranted.
- `settlement_requests` remains financial completion authority. Preparation or source proof is never completion. Readers verify the retained core payload hash agrees with the full saved intent before reporting completion.

Fresh preparation/commit acquire the owner reconciliation lock and source/financial table locks. Exact saved preparation recovers before current sources. Exact completed execution dispatches the original core before cancellation/proof age/current-source checks, retaining the original request fingerprint and unchanged result. Private proof recording, preparation and cancellation do not change financial stamps.

Verified/unavailable proofs are immutable. An expired, future-dated, failed or changed proof cannot be replaced under the old request ID; the user cancels the uncompleted review and reviews current sources. An uncertain financial response must first inspect the same retained request, not cancel or mint a competing result. Cancellation and commit races have a single serialized outcome.

## Application boundaries

`lib/fx/reviewed-request.ts` strictly validates frozen allocation/reversal snapshots, exact source closure, receipt and invoice capacities, all portion dimensions/tranches and retained results. Primitive enum types are required. Allocation/reversal results must match the saved intent, heads, IDs, full portion counts and zero recognised effects. Forged totals or coherent-looking altered receipt dimensions reject.

`reviewed-request-store.ts` handles owned recovery before mutable preflight. Fresh allocation verifies sources through the existing server-only byte checker; completed retries skip catalog, key and object access. Cookie-authenticated server actions accept bounded exact form fields and redirect uncertainty to the same request. Failed history, proof, audit or malformed response cannot produce a claimed completion.

`/dashboard/reconciliation/fx/requests` reads owner-scoped history with UUID keyset paging and independently loads a selected saved request. The pending pointer derives from complete history. Current match/reversal pages withhold fresh forms when the index fails or an unresolved request exists. The frozen client form receives safe metadata only. No raw bytes, filenames, storage paths, encryption keys or signed URLs are exposed.

## Verification and reproducible demo

Local verification: **619 automated tests passed**, zero failed/cancelled/skipped; **all 15 browser suites passed**. **43 focused SQL/native checks passed**, including actual independent-connection preparation and cancellation/commit races in both orders. Lint, standalone TypeScript, secret scan, whitespace and clean production build including TypeScript passed. Prior ignored build output was preserved; build used public non-production Supabase placeholders.

Coverage includes predecessor upgrades and unchanged core OIDs/bodies/grants, zero-effect preparation, duplicate/new request handling, immutable cancellation, proof age/future/unavailable rejection, true confirmation, foreign/service/anonymous/direct-write denial, malformed retained snapshots/results, lost preparation response, committed-but-lost execution response, same-ID recovery without duplicate events, shared pending/reset gates, zero-cash portions and source-loss reversal. Existing native and source/filing export tests remain green.

Run:

```sh
npx tsx scripts/demo-reviewed-fx-actions.ts
```

The disposable actual ordered SQL demo uses synthetic encrypted evidence and writes `/tmp/vibecount-reviewed-fx-demo`. Authenticated reviewed wrappers allocate KWD 10.001 / GBP 25.00 in three portions including a zero-cash final portion, sharing a GBP 25.01 receipt with a native penny. It proves exact completed allocation retry after source loss, full retained reversal and retry, six retained FX events, unchanged recognised receipt/native penny, source manifest V3 and incomplete frozen filing bundle V4. All seven artifact hashes/sizes/retained bytes and both CSV hashes were independently verified. The pack remains **Draft — not submitted to HMRC**, without completeness attestation.

Anonymous production smoke: login 200; FX matching/reversal/saved requests/evidence pages 307 to login; reconciliation, evidence manifest and filing exports 401. The first smoke request used a nonexistent manifest URL and returned 404; rerunning the actual parameterized route verified 401. The temporary server was stopped and port closure checked. These are auth-denial checks, not hosted signed-in acceptance.

## Migration and remaining risks

Review/apply only after all selected predecessors and deploy the compatible application together. This additive migration preserves financial core identities, fingerprints, native history, prior serializers and frozen artifacts. After financial use, retain request/cancellation/settlement ancestry and repair forward instead of destructively dropping history.

There are 72 local migrations, 47 untracked; hosted schema/grants remain unknown. Hosted Auth/PostgREST/Storage, representative signed-in acceptance, real evidence readability/treatment and large-history performance remain unproven. Cryptographic byte verification is point-in-time evidence, not proof of tax treatment or continuing availability. Table locks cannot freeze external object bytes indefinitely. The request index scans complete request history for integrity; validate realistic owner volumes before release. Complete saved payloads are bounded and must fit hosted transport limits.

Foreign-account observations/GBP valuation, fees/cross-currency credits/refunds, full tax/finance treatment, evidence lifecycle/coordinated restore, durable communications, complete historic facts, independent annual tax/form review and release isolation remain handover work. This local reviewed FX activation does not complete the Finance OS.

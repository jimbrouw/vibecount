# Native invoice compatibility before external capture

18 October 2026. Implements the first compatibility step in [the foreign invoice plan](fx-foreign-invoice-plan.md). This does **not** enable preserved external or foreign-currency canonical invoices. All existing source accounts, bank observations and invoices still have their explicit GBP constraints, and new native-only origin checks additionally reject external rows.

## Model and migration

`20261018160000_native_invoice_boundary.sql` adds `origin` (default `native_gbp`) and nullable external-only `original_total_minor`, `currency_ruleset_id`, `source_fact_revision_id` and `source_fact_family_id` to the existing `invoices` family. Owner-composite source FKs and a partial unique owner/fact-family index prepare one canonical invoice per evidence family. Native rows must keep these extra fields null. Their original GBP total continues to come from their existing amount; there is no duplicated mutable minor total that can go stale during native draft edits.

The existing `numeric(12,2)` amount and non-null constraint remain. No amount, update timestamp, old snapshot, request hash, old result or artifact body is rewritten. `invoice_revisions` gains native origin and nullable source metadata with a native-only completeness check. Future baseline snapshots captured through the existing `to_jsonb(inv)` path will naturally include the newly added native/null fields; this does not change already-stored snapshot bytes.

A private trigger boundary rejects non-native or foreign invoice references for settlements, credits, returned-cash assignments and contextual financial-record inserts/reassignments. The native revision RPC explicitly checks native/GBP identity while retaining its original payload construction, request hash and saved result. Trigger execution remains available through its table operations; direct execution is revoked for application/service/anonymous roles.

## Application boundary

`lib/invoices/native.ts` requires explicit `native_gbp` origin, GBP currency and a bounded exact non-null amount. Missing metadata and external origin fail, including an external GBP candidate with a plausible legacy amount. This guard is used before native edit, VAT/PDF revision, download/share, history, sent/paid/delete mutations, reminder scheduling/disabling, cron draft generation and retained reminder sending. Owner reads fail on database/auth errors. The shared action reader normalizes Supabase object/array client joins.

Native retained PDF recovery additionally checks invoice identity, origin and the retained snapshot's GBP unit before accessing Storage. It keeps the existing review hash and recovers prior bytes before mutable seller settings. Native PDF endpoints do not sign an encrypted external source as if it were a generated invoice PDF. Unsupported edit/history screens link to evidence review without rendering a GBP editor or native VAT history.

## Verification and synthetic demo

The predecessor-upgrade test creates an actual reviewed native invoice through the old RPC, saves its row/snapshot/result/stamp, applies the forward migration and verifies the unchanged values, exact numeric wire scale and old retry. A zero draft still edits its one native amount. Direct external metadata and null native amounts reject. Deliberately hostile external candidates are seeded only inside a disposable rolled-back constraint-relaxation fixture to prove native RPC and all relationship insert/reassignment guards; these candidates are not supported canonical captures. Two-owner reads and private helper grants are checked.

Action/page/route tests cover successful native behavior and rejection of foreign/external GBP/missing units/null amounts, failed owner reads and authentication before mutations, PDF rendering/upload and provider calls. Existing native revision/VAT/legacy-confirmation and exact-recovery checks remain. The arithmetic foundation test now checks each explicit GBP-only boundary separately rather than counting all constraints that mention GBP; the new native constraint adds another legitimate GBP predicate.

Run `npx tsx scripts/demo-native-invoice-boundary.ts` for the actual disposable SQL upgrade demonstration. It writes `/tmp/vibecount-native-invoice-demo/compatibility.json` and README: GBP 120.00 remains exact, the old snapshot hash/result/stamp are unchanged, non-native changes reject, and there are zero accounting or settlement rows. Object/PDF hashes, identities and attestation values are synthetic metadata placeholders; this is not proof of a readable original or hosted acceptance.

## Rollout and remaining work

Apply/rehearse the ordered migration chain before deploying application code that selects `origin`. This checkout has not applied migrations to a hosted database. On rollback, return the affected application entry points to a compatible version; retain immutable history and avoid destructive table rollback. Existing unrelated changes and parked Phase 4 work remain preserved.

Before enabling external rows, still implement and verify:

1. Dimensioned dashboard/project/direct invoice lists and complete exports; explicit foreign coverage for tax/filing/finance/quarterly readiness; containment of parked native-only consumers.
2. A strict external completeness branch, conditional null GBP compatibility amount, immutable original units and deletion/economic/source guards. Keep native wire values and existing artifact verifiers unchanged.
3. Source revision/family equality, invoice fact kind, current verified source and captured currency/amount consistency; the current separate owner FKs alone are not that full proof.
4. Reviewed one-family canonical capture and corrections using actual preserved evidence in immutable invoice revisions, not a generated native PDF or version-zero bypass.
5. Explicit GBP-only balance/sync/credit/refund/allocation boundaries plus dimensioned balances, lot-bound FX settlement/reversal, zero-cash tranches, source dependencies and grouped reporting.
6. Foreign accounts, fees, FX refunds/credits and tax/filing/finance integration, followed by hosted authenticated/Storage/large-context acceptance and independent treatment review.

These are required continuations of the full handover, not optional substitutes. No real financial approval, send, payment, bank connection, deployment, hosted write or filing occurs in this step.

Checkpoint checks: 418 automated tests and all 11 browser suites passed. The final mixed-case identity refinement passed all 30 focused SQL/model/route checks; identity comparison normalizes case while retaining the exact original request/hash payload. Lint, clean production build/TypeScript, secret scan and changed-file whitespace passed. Independent read-only application and schema reviews found no blocker within this native-only compatibility scope.

Final anonymous production checks: native edit/history returned 307 to login, download/share/PDF returned 401, and login returned 200. The temporary server was stopped. These checks do not establish hosted authenticated acceptance.


Later prerequisites now present locally include native-only balance scope, original-currency reporting/export, tax/filing/finance coverage and containment of the four existing parked financial reads. See [parked-consumer-containment.md](parked-consumer-containment.md). The remaining external capture/schema/revision and dimensioned financial gates above still apply; parked drafting, deployment scope and full hosted acceptance remain unresolved.


Subsequent canonical capture: migration `18230000` conditionally enables preserved external documents with null GBP/native PDF/VAT fields and positive sourced external history. Native values/history/request contracts and native-only financial relationships remain. Earlier native-only/non-null descriptions above refer to the prerequisite migration, not the current complete local chain. See [external-invoices.md](external-invoices.md). Financial FX settlement remains unavailable.

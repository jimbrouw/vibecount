# Runnable handover checkpoint

The repository contains implemented local slices across M1–M6. The complete handover is **not accepted or deployment-ready**. Passing isolated tests and synthetic demos does not prove one authenticated import-to-export journey against Supabase. This checkpoint makes the implemented work inspectable before another implementation cycle.

## Run and inspect

From the repository root, with the existing installed dependencies:

```sh
npx tsx scripts/rehearse-evidence-restore.ts
npx tsx scripts/demo-foreign-accounting.ts
npx tsx scripts/demo-connected-source-ui.ts
npx tsx scripts/demo-tax-bank-coverage.ts
npx tsx scripts/demo-finance-bank-coverage.ts
npx tsx scripts/demo-bank-dimensioned-exports.ts
```

| Output | What it demonstrates | Limit |
| --- | --- | --- |
| `/tmp/vibecount-evidence-restore/report.json` | Full disposable database snapshot restored with four ciphertext objects, retained keys, source rows/names and preserved approval | Synthetic local restore; hosted consistency and operational recovery remain unverified |
| `/tmp/vibecount-foreign-accounting-demo/` | Current V4 tax → V5 filing capture, V6 seven-artifact bundle and server-rendered foreign accounting readback | Disposable synthetic SQL; incomplete tax facts/reviews; foreign admission closed |
| `/tmp/vibecount-connected-source-ui-demo/readback.html` | Actual SQL/store source scopes rendered through current review components; native forms and exact unsupported originals | Forms are inert; no signed-in browser flow |
| `/tmp/vibecount-tax-bank-coverage-demo/artifacts/` | Seven draft filing artifacts, original currency dimensions, unresolved-source blocking, immutable replay | Synthetic incomplete tax inputs; no real tax acceptance |
| `/tmp/vibecount-finance-bank-coverage-demo/` | Current finance coverage and suppression of dependent figures when bank evidence remains unresolved | Synthetic SQL; not a verified balance or drawings recommendation |
| `/tmp/vibecount-bank-dimensioned-exports-demo/` | Ledger V3, manifest V4 and reconciliation V5 keep original bank units, complete valuation history and accounting effects separate | Synthetic SQL/serializers; authenticated hosted downloads remain unverified |

Each demo uses a disposable database and records its verification output. Inspect the accompanying report and manifest alongside the rendered/exported artifacts. These scripts deliberately preserve predecessor/replay coverage; they are engineering demonstrations, not replacement production entry points.

Two additional illustrative examples can be regenerated with `npx tsx scripts/demo-filing-pack.ts /tmp/vibecount-checkpoint/filing-pack` and `npx tsx scripts/demo-finance-plan.ts /tmp/vibecount-checkpoint/finance-plan`. These exercise retained earlier contracts with invented facts; use the current coverage demos above to assess unresolved sources.

`npm run dev` starts the application using local configuration. A usable signed-in journey requires the configured Supabase schema, Auth and Storage to match these local migrations and evidence encryption configuration. This checkpoint does not apply migrations to that service. Start with `/dashboard/imports`, then reconciliation, expense review, tax preparation and finance. Do not treat a locally rendered login page as proof of those authenticated workflows.

## Remaining acceptance work

| Scope | Implemented locally | Evidence or implementation still required |
| --- | --- | --- |
| M0 architecture/release | Audit, reuse plan, schema history and tests | Isolate/review the large uncommitted delivery; confirm hosted migration baseline and coordinated restore |
| M1 import/evidence | Native CSV normalization, provenance, dedupe, encrypted document intake, source review and verified document/bank-original downloads | Representative Starling/Nationwide/Amex exports; hosted readable-original acceptance; retention/deletion and hosted key/object/database recovery; guarded foreign admission |
| M2 reconciliation | Native matching, partial allocations, transfers, refund/credit history, FX evidence, source guards and dimensioned standalone exports | Complete foreign bank lifecycle, fees and cross-currency transfers/refunds/credits; hosted export acceptance |
| M3 expense decisions | Classification history, mixed use, memory, bulk review and rollover slices | Prove complete evidence-backed journey and foreign classification/posting/correction/reversal with separate human confirmations |
| M4 tax | Versioned deterministic calculations, facts, source coverage and reviewed foreign accounting capture | Independently reviewed annual rules and form scope; actual complete historic facts, not assumed missing zeroes |
| M5 filing pack | Resumable reviews, versioned draft bundles and seven exports with foreign decision/valuation ancestry | Current year/form mapping acceptance and one authenticated source-to-export run with independent recalculation and all material exceptions resolved |
| M6 Finance OS | Dashboard calculations, reserve separation, forecasts, rollover and deadline slices | Verified cash/buffer inputs, durable communication intent/attempt/outcome handling, provider uncertainty and representative user journey |
| Cross-cutting release | Local tests, browser component suites, build, auth smoke | Hosted Auth/PostgREST/Storage isolation and policies; real backup/restore; release review and deployment acceptance |

P2 OCR, accountant locking and retirement scenarios remain advanced scope; MTD evaluation is separate. No bank connection, payment, provider send or tax filing is implied by this checkpoint.

## Next delivery order

1. Review this checkpoint against the handover's actual user journey; keep the remaining list visible.
2. Continue from the [dimensioned standalone exports](dimensioned-bank-exports.md) to the guarded foreign source lifecycle. Group ingestion, evidence review and separately confirmed posting/reversal as a coherent user workflow with a single acceptance checkpoint.
3. Close readable evidence/recovery and representative provider ingestion gaps; run the signed-in import → reconcile → classify → calculate → export acceptance case on a designated test environment.
4. Complete independent tax/form review and verified historic inputs before claiming the requested draft pack complete. Finish operational communications and release acceptance.

Use focused checks during each coherent change and one complete verification run at its delivery gate. The latest full local run covered 794 automated tests in about 189 seconds: 793 passed and one reminder scheduler mock still expected the former separate writes. That mock was updated for the atomic draft RPC; all 11 reminder delivery/recovery tests then passed, including independent PostgreSQL connections and real SDK signature validation with synthetic events. The production build and targeted lint passed. The earlier 21 browser suites passed before these reminder changes; the new delivery-history page has server-rendered coverage, while its hosted signed-in journey remains unverified. These counts describe regression coverage, not percentage completion of the product.

Document and bank-original download implementation and focused acceptance evidence are recorded in [document-original-access.md](document-original-access.md). Downloads remain explicit human requests and do not approve financial facts.

Durable reminder draft/claim/outcome handling is now implemented locally; see [reminder-delivery.md](reminder-delivery.md) for migration and verification notes. Signed provider evidence now reconciles new tagged attempts and is visible in paginated delivery history. Legacy untagged sends, attempts without provider evidence and hosted acceptance remain outstanding. Evidence retention policy is now explicit-request deletion only; the dependency-aware deletion workflow remains outstanding.

An owner-scoped deletion impact preview is available from Imports. It discovers shared ZIPs, duplicate copies and raw ciphertext counts without deleting anything. The [deletion plan](evidence-deletion-plan.md) lists the remaining dependency, availability, concurrency, removal and restore-suppression gates.

The deletion availability foundation is implemented locally in migration 94. Private targets block original-download authorization and re-registration while preserving source bytes and history; native PostgreSQL tests verify concurrent download/target ordering. Deletion remains disabled pending native tax/financial approval fences, complete scope confirmation, ciphertext removal and restore suppression. See [evidence-deletion-plan.md](evidence-deletion-plan.md).

Migration 95 adds local native tax/merchant/financial approval safeguards for targeted evidence, with current tax sources marked unresolved and historical source snapshots preserved. Withdrawal and exclusion remain available. 39 focused checks passed, including concurrent approval/target ordering. Complete indirect dependency coverage, saved-pack freshness, deletion execution and restore suppression remain outstanding.

Migrations 96–97 reject recovery replay for targeted originals and remove targeted documents from current cash/deadline planning catalogs and captures, preserving historical snapshots. Recovery and planning checks passed (8 + 25). Before deletion can be enabled, filing-only evidence availability and in-flight remote upload/restore coordination still require implementation alongside scope confirmation, erasure and backup suppression.

Migration 98 adds explicit current document availability to filing inputs (v6) and bundles (v7), including year-batch-only evidence. Missing or deletion-targeted originals invalidate source reviews and block completeness without rewriting calculated amounts or historical packs. SQL and deterministic model guards are tested; in-flight Storage operations and the deletion/restore workflow remain outstanding.

Combined verification through migration 98: the full `npm test` run passed all 807 tests (199 seconds), targeted lint passed, and the production build passed. The first build attempt hit the known stale `.next/build` ENOTEMPTY error; its terminated cache was moved to a temporary backup and the clean build succeeded. Logs: `/tmp/vibecount-post-availability-suite.log`, `/tmp/vibecount-post-availability-build.log`, `/tmp/vibecount-filing-availability-lint.log`. No hosted migrations or provider operations were performed.

Migration 99 records durable admission/completion for every source/document/recovery upload. Unresolved operations block deletion across duplicate content paths; no timer clears them. The preview displays this blocker. Twenty-five focused tests, TypeScript and lint passed, including both native PostgreSQL race directions. Pre-rollout worker draining and unknown-outcome reconciliation remain operational requirements; confirmed deletion/erasure and restore suppression are still not enabled.

Migration 100 adds a private atomic deletion-request boundary and safe review fingerprint/disclosure. Four focused checks passed, including shared ZIP targets, rollback, stale financial dependencies and direct-writer concurrency; TypeScript and lint passed. Application roles cannot call the writer, and the UI remains preview-only. Requests in tests do not scrub ciphertext or remove Storage objects; those gates and restore suppression remain outstanding.

Migration 101 adds private confirmed-request ciphertext scrubbing with immutable audit counts and exact retry behavior. Eleven focused database checks passed: selected raw/name copies are cleared, unrelated ciphertext and financial history are preserved, audit failures roll back, and rehydration is rejected. Storage erasure, per-object outcomes and restore suppression remain outstanding; public confirmation remains disabled. The user reconfirmed explicit-request deletion only, with no scheduled deletion. No hosted migration or real evidence removal was performed.

Migration 102 adds private per-object removal admission and immutable absent/failed/unknown outcomes. The worker protocol requires provider absence verification and durable outcome recording, without retrying a remote call after uncertainty. Nine focused checks passed, including native concurrency and database rejection of false absence while metadata remains. No production provider adapter or route is enabled. Restore suppression and independent ledger durability remain the next gates; see the deletion plan for the quarantined restore design.

Migration 103 adds private deletion-intent replay with a versioned manifest and independent expected digest/checkpoint. A complete disposable pre-request database backup was restored and later intent replayed: initially available originals became unavailable, restored ciphertext was scrubbed, unrelated evidence and financial history survived, and injected failure rolled replay back. Request/restore suites, TypeScript and lint passed. Replay explicitly remains not-ready until physical restored objects are removed and verified. Independent ledger persistence and hosted quarantine remain unproven; public deletion stays disabled.

The restore rehearsal now also exercises per-object removal against a separate synthetic store of encrypted bytes. Failure keeps suppression incomplete, retry removes the targeted objects, unrelated bytes remain exact, and fresh verification detects a reappearing object despite a prior successful outcome. The verifier checks ledger identity, remaining ciphertext/metadata, unresolved uploads and durable outcomes before independently checking provider absence. It certifies manifest suppression only, not hosted readiness. TypeScript and lint passed.

The standard non-deletion backup rehearsal was rerun through all 103 migrations: 114 tables, four encrypted originals, eight source rows, three encrypted filenames, two keys and one approved financial record survived full dump/reload. Missing/corrupt objects and missing retained keys were rejected; owner isolation passed. Report: `/tmp/vibecount-evidence-restore-current/report.json`. No hosted environment was changed.

Combined regression gate through migration 103: all 830 tests passed in 197 seconds. Log: `/tmp/vibecount-deletion-full-suite.log`. This includes confirmed requests, scrubbing, removal uncertainty and old-backup replay alongside existing accounting/tax regressions. It does not establish independent deletion-ledger durability or hosted acceptance. A designated non-production Supabase/Vercel environment has been requested for the signed-in acceptance run.

The subsequent [2025/26 form mapping review](form-mapping-review-2025-26.md) found and corrected negative net/adjusted tax amounts being shown in profit boxes. Mapping v2 uses positive amounts in SA103S box 32 and SA103F boxes 65/77. Loss elections remain unresolved and block completeness; retained v1 packs remain unchanged. This source check does not replace independent tax review or the outstanding historic evidence.

Mapping v3 additionally omits expense boxes when a reviewed trading allowance is selected, following the annual short/full notes, while preserving actual costs in the ledger. Fourteen focused filing checks passed, including unchanged historical artifact reconstruction. Loss carry-forward tax/NI treatment remains blocked pending its own reviewed branch; the handover's full acceptance scope is still incomplete.

Read-only hosted inspection now establishes a different baseline: 28 applied Supabase migrations, including four receipt migrations absent locally, and no development branches. The four definitions are captured as fixtures. A disposable 107-migration rehearsal passed and preserved all existing fields of three synthetic paid/unpaid/refund receipts. This does not yet prove their integration with vNext reporting and approvals. Vercel access returned 403; the same-scoped CLI had no credentials and its login prompt was canceled. See [hosted-baseline-review.md](hosted-baseline-review.md). No hosted state was changed.

The follow-up receipt reporting assertion reproduced £35 instead of £5 after upgrade (unpaid cost included; refund sign lost). Local migration 104 corrects quarter/reporting views using shared cash-effect semantics without changing record history. The combined 108-migration rehearsal passes and is now part of `npm test`; six native refund/projection tests pass. Direct tax/finance consumers and legacy confirmation compatibility remain release gates. This correction is not deployed.

Migration 105 extends receipt cash compatibility to current operational review
and quarterly capture. The hosted rehearsal proves £10 paid minus £5 refund
produces £5 rather than £35 with a £20 unpaid receipt. Unpaid evidence remains
visible with an exclusion label; raw receipt history and the retained V1 catalog
remain unchanged. Focused hosted/parser, operational coverage and route checks,
TypeScript and lint passed. Direct tax inputs/source freshness, tax-prep,
projects and records exports still need receipt-aware projections; see
[hosted baseline review](hosted-baseline-review.md). No hosted migration or
release acceptance is implied.

Migration 106 closes receipt tax-source freshness: new explicit reviews capture
safe receipt dimensions, older receipt sources require re-review, and payment
changes invalidate current review without rewriting saved provenance. Current
source amounts use the shared cash projection. The 110-migration hosted fixture,
tax fact/capture/bank-accounting and evidence-approval checks passed locally;
calculation record totals and the remaining direct readers still need migration
to receipt-aware semantics. See [hosted baseline review](hosted-baseline-review.md).

Migration 107 adds explicit receipt-aware tax input V5, deterministic cash
recognition, database candidate-total checks and saved result recalculation.
Current filing review and normalized ledger exports carry the corrected effects;
historical inputs retain their semantics. The 111-migration synthetic hosted
path now reaches all seven draft artifacts, with £5 in both tax candidates and
ledger export. All 27 focused regression checks passed. Legacy tax-prep,
projects and standalone record readers remain outstanding, as do the broader
hosted acceptance and handover requirements listed above.

Migration 108 aligns the remaining known live receipt readers (records display,
project totals, records JSON/CSV and legacy tax-prep) with the shared cash effect.
The local hosted-schema rehearsal now applies 112 migrations. Full regression
passed: 838 tests in 198 seconds; production build passed. Final narrow label and
excluded-row validation adjustments passed focused tests, TypeScript and lint.
Receipt compatibility now reaches the current financial/tax/draft-export paths,
but authenticated hosted HTTP acceptance and the broader incomplete handover
items remain. See [hosted baseline review](hosted-baseline-review.md).

Migration 109 fixes an existing hosted receipt-refund correction defect and
rejects inconsistent existing refund families during preflight without changing
their records. The 113-migration rehearsal exercises explicit receipt confirmation,
retry, 30% allocation, manual matching and rejected original corrections. Five
independent PostgreSQL lock races passed. Canonical bank-linked receipt enrichment
and hosted signed-in acceptance are still unproven; the full handover remains
incomplete. See [hosted baseline review](hosted-baseline-review.md).

## Private hosted GBP acceptance completed — 18 October 2026

The user froze feature work and authorized a separate $0 Supabase test project.
A separate protected Vercel project now runs the isolated release. Real hosted
browser acceptance passed import, explicit classification, exact original-file
download, duplicate reimport, synthetic invoice matching without duplicate income,
records/reconciliation exports and second-user isolation. Live production's
Vercel deployment and 28-migration Supabase baseline are unchanged. The only
application repair was an explicit same-owner attachment FK hint in records
export, required by real PostgREST. See
[private-preview-acceptance-2026-10-18.md](private-preview-acceptance-2026-10-18.md)
for the URL, safe local test-login location, evidence and scope. Do not resume
open-ended feature work: the latest user instruction is to keep the live app
safe and deliver/test this private version. The complete original handover is
not thereby accepted or ready for production promotion.

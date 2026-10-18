# VibeCount engineering handover

Updated: 18 October 2026 (Europe/London).

## Read this first

The private test app is running and its synthetic GBP import-to-export journey has passed. The original `handover2.md` specification is **not complete** and this is **not a production release**.

The user's latest delivery constraint is to stop adding features, protect the live app, fix demonstrated blockers and keep time/token use bounded. Do not restart open-ended implementation from older plans. The next step below is a recommendation, not authorization to build every outstanding item.

## Code and recovery

- Workspace: `/Users/standard/Developer/vibecount`.
- Current branch: `codex/session-backup-2026-10-18`.
- Private backup repository: https://github.com/jimbrouw/vibecount-private-backup
- Verified recovery checkpoint: `6c30f26639ee9c30ddfc80be13202b8c54f0dc78`.
- Backup remote: `private-backup`; original public remote: `origin` (`jimbrouw/vibecount`).
- The checkpoint preserves 801 changed/new source, migration, fixture, test and documentation files. This document is a subsequent update.
- The original public branch `claude/vibecount-ai-agents` remains at `5cb31c6`. Do not push this handover or personal financial scenarios to the public repository.
- Local environment files, credentials, browser sessions and deployment secrets are excluded. A source backup is not a database, Storage or encryption-key backup.
- The local Supabase CLI version cache remains modified outside the checkpoint; it is not application work.

## Environments: keep them separate

| | Private test | Live production |
|---|---|---|
| App | https://vibecount-private-test.vercel.app | https://vibecount-jims-projects-b7cb6c2e.vercel.app |
| Vercel project | `vibecount-private-test` / `prj_4HsGcxALjmvHQNk2kijYl6Iu0w8j` | `vibecount` / `prj_XjqoAX8mMF1G589I6Tgu7qnVzvRR` |
| Supabase ref | `xgpozyxnckwetlxqners` | `lazorvlkgxgzdgflzhjm` |
| Applied migrations at last verification | 113 | 28 |

The separate Supabase test project was explicitly approved only after a $0/month quote. No plan upgrade was authorized. Branching was unavailable on the Free plan. No live data was copied.

Last verified live deployment: `dpl_AH61dvFRFtyc2rHVABJnmoaWz8e4`. No live deployment promotion, database migration or production environment change occurred during the private acceptance work.

**Root `.vercel/project.json` points at the live project.** Never deploy this workspace blindly. The test release was built from a separate snapshot whose project link points at the test project. It excludes parked agent/MCP endpoints, cron jobs, local secrets and production-provider credentials. The full checkpoint contains additional work that was not shipped in that snapshot.

Private test protection uses Vercel SSO with `deploymentType: all`. Anonymous stable-alias requests were verified to redirect to Vercel sign-in. Keep this protection enabled.

Test VibeCount credentials are in the ignored, owner-readable `.vercel/private-test-login.json`. Do not paste or commit its contents. Vercel sign-in and VibeCount email/password sign-in are separate gates. Google OAuth is not configured on the test Supabase project; preview-only `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false` hides that option with an explanation. Unset configuration retains the existing Google UI.

## What exists

The existing stack is Next.js 16 App Router, TypeScript, Tailwind and Supabase Auth/Postgres/RLS/Storage. Reuse its invoice, records, review, authentication and export surfaces. Read the relevant installed Next.js documentation before changing framework code.

Implemented foundations include immutable source preservation, import observations, duplicate handling, explicit classification review, invoice/payment allocation, source provenance, reviewed tax facts, versioned calculations, draft filing artifacts and cash planning. Their presence does not establish completion of all supported financial cases.

There are 109 canonical local migrations plus four captured hosted receipt migrations. Together they replay as the 113-migration private baseline. The captured migrations are under `fixtures/hosted-baseline/`; do not rewrite deployed history or assume live matches a fresh local schema.

Recent receipt work aligns paid/unpaid/refund cash effects across reports, tax inputs and direct readers, and prevents inconsistent or excessive receipt refunds, including concurrent changes. Migration 109 preflight rejects invalid existing refund families rather than silently modifying them.

## What was demonstrated

The hosted private journey used synthetic data and explicit review:

1. Imported three CSV rows: £1,000 income, £125.50 business cost and £24 personal cost.
2. Approved only the two business records. Records showed £874.50 net.
3. Downloaded the original through its explicit confirmation gate; bytes matched the uploaded source and SHA-256 manifest.
4. Reimported identical bytes without duplicating the two approved records.
5. Created/confirmed a synthetic £1,000 invoice and generated its PDF without sending email.
6. Matched the £1,000 receipt: invoice outstanding and receipt unallocated balances became zero; income stayed £1,000.
7. Downloaded records JSON/CSV, source ledger, decisions, manifest and reconciliation exports.
8. Verified a second authenticated user could not read the first user's records, imports, source rows or source files.

Visible browser checks also passed login, dashboard, Records, tax preparation and cash planning with no browser error/warning logs. Missing tax/cash facts remained unresolved.

No real financial approvals, customer email, payment, bank connection or tax filing were performed.

Hosted acceptance found and fixed an ambiguous PostgREST attachment relationship in `app/api/records/export/route.ts`: the query now explicitly selects `record_attachments_record_same_user_fk`. The later sign-in fix changes only login/signup display when the private flag is false.

## Verification and its limits

- The full suite passed 838 tests before migration 109 and the final export/login fixes; the production build passed at that checkpoint.
- Migration 109 subsequently passed focused hosted-upgrade and receipt checks, including five native PostgreSQL concurrency races.
- The export fix passed its focused route test and hosted downloads.
- The login display fix passed lint, the deployed build and visible browser checks.
- Do not describe the earlier full suite as covering all subsequent changes. Do not rerun every check without a concrete reason.

Detailed acceptance: `docs/private-preview-acceptance-2026-10-18.md`.

Local artifacts currently include `/tmp/vibecount-private-acceptance/` and `/tmp/vibecount-private-browser-check.jpg`. `/tmp` is temporary, not durable recovery storage. Browser-state files and test setup files there contain secrets and must not be shared.

The isolated release snapshot path is recorded in `/tmp/vibecount-private-preview-path`; its release manifest records source hashes. Private database setup is under `/tmp/vibecount-private-test-db`. Check these still exist before relying on them.

## Recommended next bounded task

Prove one representative 2025/26 bank file through the existing review flow to a draft export in the private app. Agree that scope before implementation. Use representative redacted/synthetic bank formats first; real personal data requires the user's deliberate selection and review.

Acceptance should establish: source preserved, dates/amounts parsed correctly, duplicate/transfer/refund ambiguity visible, only explicitly reviewed business amounts included, export totals independently reconciled, and unresolved tax facts clearly identified. Fix only blockers encountered in that journey. Record the outcome and stop for review.

After that, expand acceptance to Starling, Nationwide, Amex and invoice inputs, then independently verify the 2025/26 draft tax pack. Do not estimate liability from missing facts treated as zero.

## Still incomplete / release gates

- Representative multi-bank and invoice-file acceptance for the actual 2025/26 workflow.
- Independent annual tax calculation and SA100/SA102/SA103 mapping review; complete evidenced tax facts and independently reconciled draft pack.
- Full foreign-currency lifecycle, including fees, cross-currency refunds and transfers.
- Canonical bank-linked receipt attachment/enrichment compatibility; do not duplicate postings to attach evidence.
- Verified accessible cash, buffers, tax reserves and unresolved reminder/provider delivery cases.
- Durable evidence-deletion ledger, hosted key/object/database restore acceptance and recovery proof. Public deletion remains disabled.
- Advanced OCR, accountant locking and retirement work are not complete. MTD is separate; draft exports are not filing software.

No production promotion until the relevant migration, recovery and financial acceptance gates are proven. The private synthetic success does not certify the entire product.

## Non-negotiable operating rules

- AI drafts; humans confirm financial changes. Preserve explicit review/read-back gates.
- Money uses exact arithmetic; distinguish invoiced, received, taxable profit and accessible cash. Use net profit.
- Keep missing facts distinct from reviewed zero. Show tax caveats in UI/API/exports.
- Never expose raw bank PDFs, unredacted bank details, encryption keys or credentials to LLM/browser surfaces.
- Preserve evidence and audit history. Evidence deletion is by explicit user request only; no scheduled deletion.
- Do not add Phase 4 MCP/browser-agent capabilities to the release. Do not enable automatic invoicing, sending, payments or HMRC submission.
- Keep secrets out of Git; use the private backup for sensitive documentation. Do not connect it to deployment automation without a deliberate release decision.

## Supporting documents

- `handover2.md`: original product specification and private personal scenario; not a completion report.
- `docs/milestone-0-audit-and-plan.md`: architecture audit and original plan.
- `docs/handover-checkpoint.md`: chronological engineering record; later entries supersede older local-only/blocked status.
- `docs/hosted-baseline-review.md`: hosted schema compatibility and upgrade evidence.
- `docs/private-preview-acceptance-2026-10-18.md`: current hosted acceptance and auth/privacy fixes.
- `docs/deployment-readiness-2026-10-18.md`: earlier readiness assessment, partly superseded by private hosted acceptance.


## Private import usability update — 18 October 2026

The user authorized simplifying the private import screen. It now leads with file selection, a payment-count/date/total preview and explicit confirmation. Column controls, source diagnostics and document tools are collapsed by default. The exact `Outflow_GBP` expense header is recognised using the retained positive-outflow mapping; unambiguous ISO dates are suggested automatically. Existing spreadsheet claim labels do not approve records.

The user's local reviewed-expenses CSV was tested locally and in the signed-in browser: all 701 rows parsed, with £15,893.96 outflows and no inflows, spanning 6 April 2025–3 April 2026. This is a file total, not an allowable-expense calculation. It combines three account labels. Import remains blocked for this combined file in both UI and server action; the current source ledger expects one account per import. Use each bank/card's original CSV separately. No real rows were imported or approved. Supporting combined-account imports is a separate scope decision.

Hosted synthetic single-account preview, explicit confirmation and duplicate reimport passed without new transactions. Invalid calendar dates remain blocked. Nine focused parser/route checks, TypeScript, lint and the deployed build passed; the full suite was not rerun. The existing browser test script was adjusted to open the newly collapsed column controls, but was not executed as a separate suite in this update. Browser warning/error logs were empty.

Private deployment: `https://vibecount-private-test-abt6kwqc7-jims-projects-b7cb6c2e.vercel.app`, assigned to the stable private alias. Only the isolated test project was deployed; live deployment remained `dpl_AH61dvFRFtyc2rHVABJnmoaWz8e4`. No database migrations or auth/protection changes were made. Local screenshot: `/tmp/vibecount-simplified-import.jpg` (contains private preview data; do not publish).


## Combined-account expenses import — 18 October 2026

The user subsequently authorized splitting the reviewed-expenses spreadsheet automatically. This supersedes the earlier one-account-file restriction for this guided flow. The existing single-account action still rejects mixed sources; the new explicit group action imports only the group confirmed on its own card.

The private preview now shows Starling (323 rows, £7,495.20 out), Amex (273 rows, £5,714.01 out) and Nationwide (105 rows, £2,684.75 out). The user must select an existing GBP source account or add its label/provider/last-four identifier, then confirm that group's account, dates and amounts. No real group has been imported or approved; the visible browser is left on these unconfirmed cards. Synthetic account labels in the dropdown are test fixtures, not the user's real bank accounts.

Implementation uses `grouped-csv/1` and canonical `mapping.accountScope` in the existing recovery plan. Each account retains the entire original encrypted file/hash and only its original logical row numbers; normalisation/fingerprints stay unchanged. No derived replacement CSVs or database migrations are needed. Recovery explicitly supports the grouped parser and reconstructs the scoped plan. Unknown/blank account labels reject; owner/currency checks and pre/post-registration scope checks prevent another group being silently treated as the same import. Different groups cannot share a selected destination. New label creation uses a deterministic owner-scoped ID to make retries safe.

Verification: 16 focused parsing/grouping/recovery checks passed, including exact-original decryption, original row identities, altered-scope/owner rejection and retained legacy plan shape. TypeScript, lint and deployed build passed. Hosted browser testing created only three explicitly named synthetic source accounts and imported four synthetic observations across three groups, all Unknown/unapproved. Database checks confirmed original rows [2,5], [3], [4], correct account scopes and signs. Reimporting Starling returned already imported, with counts unchanged. Original download was byte-identical; grouped ledger export succeeded. Replacing a same-named file cleared prior results/confirmations. The picker waits for hydration so an early selection cannot be lost. Browser warning/error logs were empty. Approved financial records remained at the two earlier synthetic records. Full regression/UI suites were not rerun; the existing UI fixture action stub was updated for the new export.

Final private build: `https://vibecount-private-test-52jvjc77z-jims-projects-b7cb6c2e.vercel.app`, assigned to the stable private alias. No live code/environment/database changes. Local screenshot: `/tmp/vibecount-grouped-import-review.jpg`; keep it private.

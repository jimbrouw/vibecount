# VibeCount LLM Coder Handover

Last updated: 2026-05-29 18:46 BST

## Start Here

- Repo: `/Users/standard/Developer/vibecount`
- Branch: `codex/phase-3-invoice-reminders`
- Remote branch: `origin/codex/phase-3-invoice-reminders`
- Production URL: `https://vibecount-teal.vercel.app`
- Vercel project: `jims-projects-b7cb6c2e/vibecount`
- Supabase project: `lazorvlkgxgzdgflzhjm`
- Vercel CLI checked: `54.6.1`

Read these before making changes:

- `AGENTS.md`
- `spec.md`
- `tasks.md`
- `HANDOVER.md`

Important boundary: do not build Phase 4 MCP/browser-agent features on this branch.

## Non-Negotiable Product Rules

- AI drafts; humans confirm. AI never commits.
- No silent invoice finalisation.
- No silent record approval.
- No silent invoice/reminder sending.
- No payment processing.
- No HMRC submission.
- Records/tax prep are review aids, not filing software.
- Say "MTD-ready records", not "HMRC-recognised MTD software".
- Use net profit language, not gross profit.
- Every tax estimate surface/export must include caveat/estimate wording.
- Raw bank PDFs and unredacted bank details must not be exposed to LLM prompts or browser-agent surfaces.

## Current Production State

Production is currently deployed and aliased to:

`https://vibecount-teal.vercel.app`

Latest pushed commits on this branch:

- `c017c7d Clarify bank PDF extraction failures`
- `b086a4e Prevent bank PDF import crash`
- `378e035 Document production records schema migration`
- `bc3b42b Add records category fallback`
- `10761c5 Fix records import QA issues`
- `9a5667c Clarify tax estimate caveats`
- `de2075e Harden human review gates`
- `6f1f85e Add agent-native selectors`

Production has been promoted after the bank PDF crash fix.

## What Was Verified By User

User confirmed:

- Google sign-in works after production promotion.
- Voice invoice creation works.
- Voice playback/read-back works.
- Invoice PDF download works.
- Records category dropdown works on production.
- CSV import now stages rows correctly for review.

Screenshots showed:

- Category dropdown populated with income/expense categories.
- Manual record review state now says `Needs review`.
- CSV import shows rows staged as `Needs review` with Approve/Discard controls.

## What Was Fixed Recently

### Records Category Dropdown

Problem:

- Production had no record categories, so the category dropdown showed only grey optgroup labels.

Fix:

- Added `lib/records/categories.ts` fallback/self-heal helpers.
- Records page now renders fallback options if Supabase returns no category rows.
- Saving a fallback category creates the real user-owned category before inserting the review record.
- Production Supabase now has the proper Phase 2 records migrations and 10 default categories.

### Review Gates

Fixes already made:

- Invoice PDF route requires `humanConfirmed: true`.
- Manual records are created as `review`, not directly approved.
- Reminder automation creates pending drafts instead of sending emails.

### CSV Import

Problem:

- CSV initially failed with `Could not create the CSV import.`
- Cause: live Supabase was missing the Phase 2 records schema.

Fix:

- Applied production Supabase migrations for:
  - `record_categories`
  - `record_imports`
  - `financial_records`
  - `financial_record_changes`
  - `record_attachments`
  - `record_exports`
  - `csv_import_rows`
  - `bank_statement_import_rows`
- Verified live tables exist and default category count is 10.
- CSV parser supports common bank headers including `Transaction Date`, `Details`, `Paid In`, `Paid Out`, debit/credit aliases, and category fallback.

### Bank PDF Import

Problem:

- Uploading a bank PDF crashed the page with a server error.
- Vercel logs showed `ReferenceError: DOMMatrix...`.

Fix:

- `app/dashboard/records/actions.ts` now installs minimal server-side DOM globals before loading `pdf-parse`.
- PDF extraction is caught and redirected to a normal Records error banner instead of crashing.
- User-facing error now says:
  `Could not extract text from this PDF. Some bank-exported PDFs are password-protected, image-only, or use locked text. Try a bank CSV export or statement text file.`
- Sanitized warning logs include only error name/message, not statement contents.

Current limitation:

- Bank-exported PDFs can still be unreadable if they are password-protected, image-only, or use locked/custom text encoding.
- CSV bank exports are the reliable Phase 2 path.
- OCR is not implemented and should not be added casually; it has privacy/security implications and moves toward later-phase work.

## Production Supabase Notes

Live Supabase project `lazorvlkgxgzdgflzhjm` originally only had older invoice/client tables.

On 2026-05-29 the Phase 2 records migrations were applied using the Supabase connector:

- `phase_2_digital_records_foundation`
- `phase_2_secure_records_storage`
- `phase_2_csv_import_review`
- `phase_2_bank_statement_import`

Verified tables:

- `record_categories`
- `record_imports`
- `financial_records`
- `financial_record_changes`
- `record_attachments`
- `record_exports`
- `csv_import_rows`
- `bank_statement_import_rows`

Verified default categories: 10.

Release QA found the live database was missing the committed Phase 3 schema
migrations. Applied on 2026-05-29 using the Supabase connector:

- `phase_3_quotes_services`
- `add_invoice_payment_links`
- `repeating_invoice_templates`
- `invoice_delivery_reminders`

This fixed settings save failures caused by missing `payment_link_provider` /
`payment_link_url` columns and aligned production schema with the current branch.

## Release QA Pass — 2026-05-29 18:46 BST

Scope:

- Branch `codex/phase-3-invoice-reminders` at latest pushed state before fixes.
- Local dev server: `http://localhost:3002`.
- Authenticated QA user created with Supabase admin for the pass.
- Browser runtime fallback: in-app Browser plugin was listed but unavailable
  (`iab` could not be acquired), so Playwright Chromium was used.

Commands passed after fixes:

```bash
npm run lint
npm test
npm run build
```

Browser/API flows verified:

- Login/auth reaches the protected dashboard.
- Settings loads and saves successfully.
- Typed invoice shows figures and words, requires confirm, downloads PDF, and
  exposes reminder preparation rather than sending.
- Voice transcript extraction works; continue remains disabled until mandatory
  spoken read-back completes, then routes into the normal invoice preview.
- Manual record creation starts in `Needs review`, then Approve changes status.
- CSV import stages rows for review; one income row and one expense row were
  approved and committed.
- Bank statement text import redacts account identifiers, stages rows for
  review, and commits only approved rows.
- Tax prep shows estimate/net-profit/caveat wording and exports a CSV containing
  the caveat and net-profit wording.
- Due reminder route writes a pending `invoice_reminders` draft with
  `sent_at = null` and no provider message id.

Release blockers fixed:

- Manual record category default selected the first sorted category, which could
  be an expense while the record type default was income. The default now uses
  the first income category when no explicit value is supplied.
- Server-action review buttons used button `name/value`, which React warned
  could be overridden for function actions. Review/import status now travels in
  hidden inputs, and manual Approve/Exclude buttons are standalone forms.

Vercel status checked:

- Latest preview before this fix was Ready:
  `https://vibecount-qtzitagjd-jims-projects-b7cb6c2e.vercel.app`
- Latest production deployment before this fix was Ready:
  `https://vibecount-h6me6bn5z-jims-projects-b7cb6c2e.vercel.app`
- Preview URL returned HTTP 401 due to Vercel deployment protection.
- Stable production alias `https://vibecount-teal.vercel.app` returned HTTP 200.

Phase 4 exclusion check:

- Targeted search found no `/api/mcp`, `get_pl_summary`, `list_expenses`,
  `finalise_invoice`, browser-agent login, or stored BYO provider key
  implementation on this branch.

## Verification Commands

Run before committing meaningful changes:

```bash
npm test
npm run lint
npm run build
```

Known build warning:

- Next.js warns about multiple lockfiles and inferred workspace root.
- This warning existed before the latest fixes.

Known audit issue:

- `npm audit --omit=dev --audit-level=high` still reports vulnerabilities through `@vercel/config`/`path-to-regexp` and `next`/`postcss`.
- Do not run `npm audit fix --force`; it suggests breaking downgrades.

## Current Known Issues / Next QA

1. Bank PDF import:
   - Ask user to retry once after `c017c7d`.
   - Then check Vercel logs for sanitized line `Bank statement text extraction failed`.
   - If extraction still fails, recommend CSV/text export for Phase 2.

2. CSV review flow:
   - Verified in release QA: staged rows can be approved and committed for one
     income row and one expense row.

3. Tax prep:
   - Verified in release QA: approved records feed tax prep, caveat/estimate
     wording remains visible, net profit language is present, and export includes
     caveat/net-profit wording.

4. Payment reminders:
   - Verified in release QA: enabling reminders prepares draft follow-up, and
     the due-reminder route creates pending reminder draft rows rather than
     sending email.

5. Voice:
   - User says sign-in, voice invoice, playback, and PDF download work.
   - Formal 20-sample Whisper sub-gate remains incomplete in `tasks.md`.

## Do Not Do Next

- Do not add `/api/mcp`.
- Do not add browser-agent login.
- Do not add `get_pl_summary`, `list_expenses`, or `finalise_invoice` MCP tools.
- Do not wire autonomous bank/OCR processing into LLM prompts.
- Do not send reminders automatically.
- Do not bypass review states for records/imports.

## Useful URLs

- Production: `https://vibecount-teal.vercel.app`
- Records: `https://vibecount-teal.vercel.app/dashboard/records`
- Vercel project: `https://vercel.com/jims-projects-b7cb6c2e/vibecount`
- Supabase project: `https://supabase.com/dashboard/project/lazorvlkgxgzdgflzhjm`

## Suggested Next Prompt For Another LLM Coder

```text
Continue VibeCount Phase 2/3 hardening on branch codex/phase-3-invoice-reminders.
Read AGENTS.md, spec.md, tasks.md, HANDOVER.md, and LLM_HANDOVER.md first.

Start with records QA:
1. Check sanitized Vercel logs for the latest bank PDF import retry.
2. If PDF extraction still fails, keep the graceful error and document CSV/text as the supported Phase 2 path.
3. Verify CSV staged rows can be approved/committed and then appear in Records summaries and Tax prep.
4. Keep all review gates: no silent invoice finalisation, record approval, reminder send, payment, or HMRC/tax-prep acceptance.

Do not build Phase 4 MCP/browser-agent features.
Run npm test, npm run lint, npm run build before committing.
Commit and push each completed fix.
```

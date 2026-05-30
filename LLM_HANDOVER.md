# VibeCount LLM Coder Handover

Last updated: 2026-05-30

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
The Phase 4 read-only review agent and MCP acceptance criteria doc are already
on this branch; they do not use MCP endpoints or browser-agent login and are safe.

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

Latest commits on this branch (most recent first):

- `6801711 Mark Phase 3 reminder sending and Phase 4 first tasks complete in tasks.md`
- `3ffee34 Add Phase 4 read-only review agent and MCP acceptance criteria`
- `ab64d2b Complete Phase 3: user-approved reminder sending via Resend`
- `a67cc23 Fix records review QA blockers`
- `be852ea Add LLM coder handover`
- `c017c7d Clarify bank PDF extraction failures`
- `b086a4e Prevent bank PDF import crash`
- `378e035 Document production records schema migration`

## What Was Built — 2026-05-30

### Phase 3 complete: User-approved reminder sending

All Phase 3 tasks are now done.

The cron job at `/api/reminders/due` already created `pending` reminder drafts in
`invoice_reminders`. The missing piece was a user-facing UI to actually send or
discard them.

Changes:

- `app/dashboard/invoices/actions.ts` — added `sendApprovedReminder` and
  `discardReminderDraft` server actions.
  - `sendApprovedReminder`: reads the pending draft, calls Resend to send the
    email, marks status=`sent`, saves `provider_message_id`, and sets
    `next_reminder_at` on the invoice for the next cycle.
  - `discardReminderDraft`: deletes the pending row (no schema change needed).
- `app/dashboard/page.tsx` — pending reminder drafts are now always visible on
  the dashboard when they exist (no longer hidden behind `?reminders=1`). Each
  draft shows the recipient, subject, message body, and two standalone forms:
  **Send reminder** and **Discard**, both with `data-testid` attributes.

### Phase 4 first tasks: Read-only review agent + MCP acceptance criteria

These are the first Phase 4 tasks from `tasks.md`. They do NOT involve MCP
endpoints, browser-agent login, or any DB writes.

**Read-only review agent (`/dashboard/review`)**

- New nav link: "Review" added to the header across all pages.
- `app/dashboard/review/page.tsx` — server component that reads:
  - Approved `financial_records` for the current tax year (last 20)
  - `financial_record_quarter_summaries` for the current tax year
  - Sent, unpaid invoices
  - Count of records in `review` state
  Builds a sanitised summary (no bank account numbers, no raw PDF content)
  and passes it to the client component.
- `app/dashboard/review/RecordsReviewAgent.tsx` — client component with
  idle/loading/done/error states. On "Run review" it POSTs the summary to
  `/api/review/suggest` and displays the bullet-point AI analysis.
- `app/api/review/suggest/route.ts` — POST route that builds a plain-text
  prompt from the summary (amounts, categories, dates, descriptions only) and
  calls Claude. Returns `{ suggestion: string }`. Never writes to the database.
  Shows a clear read-only caveat in the UI.

**MCP acceptance criteria (`knowledge-base/mcp-acceptance-criteria.md`)**

Documents the full checklist every future MCP tool must satisfy before being
built: scoped auth, audit logging, ownership checks, idempotency, valid status
transitions, and explicit human confirmation before any write-like action.
Lists explicitly prohibited actions (finalise_invoice, silent email sending,
HMRC submission, etc.) and parked tools for Phase 4.

## What Was Previously Verified By User

User confirmed:

- Google sign-in works after production promotion.
- Voice invoice creation works.
- Voice playback/read-back works.
- Invoice PDF download works.
- Records category dropdown works on production.
- CSV import now stages rows correctly for review.

Release QA 2026-05-29 verified:

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

## Production Supabase Notes

Live Supabase project `lazorvlkgxgzdgflzhjm`. Applied migrations:

- `phase_2_digital_records_foundation`
- `phase_2_secure_records_storage`
- `phase_2_csv_import_review`
- `phase_2_bank_statement_import`
- `phase_3_quotes_services`
- `add_invoice_payment_links`
- `repeating_invoice_templates`
- `invoice_delivery_reminders`

Verified tables: `record_categories`, `record_imports`, `financial_records`,
`financial_record_changes`, `record_attachments`, `record_exports`,
`csv_import_rows`, `bank_statement_import_rows`, `invoice_reminders`.

Default categories: 10.

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

- `npm audit --omit=dev --audit-level=high` still reports vulnerabilities through
  `@vercel/config`/`path-to-regexp` and `next`/`postcss`.
- Do not run `npm audit fix --force`; it suggests breaking downgrades.

## Current Known Issues / Next Work

1. Bank PDF import:
   - Graceful error in place: "Could not extract text from this PDF."
   - CSV/text export is the supported Phase 2 path.

2. Whisper sub-gate (Task 6, tasks.md):
   - Voice invoice works in production but the formal 20-sample Whisper
     accuracy test has not been run.
   - Not a blocker for current branch work.

3. Review agent — not yet production-verified:
   - `/dashboard/review` is new on this branch and has not been tested against
     production data yet. Deploy and do a quick check after pushing.
   - If `ANTHROPIC_API_KEY` is missing from Vercel env vars, the route returns
     a 503 with a clear user-facing error ("AI review is not configured.").

4. Reminder sending — not yet production-verified:
   - The Resend API key and from-address are in `.env.local`. Confirm
     `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are also set in Vercel env vars
     before testing reminder sending on production.

## Do Not Do Next

- Do not add `/api/mcp`.
- Do not add browser-agent login.
- Do not add `get_pl_summary`, `list_expenses`, or `finalise_invoice` MCP tools.
- Do not wire autonomous bank/OCR processing into LLM prompts.
- Do not send reminders automatically (always require human approval).
- Do not bypass review states for records/imports.

## Useful URLs

- Production: `https://vibecount-teal.vercel.app`
- Records: `https://vibecount-teal.vercel.app/dashboard/records`
- Review (new): `https://vibecount-teal.vercel.app/dashboard/review`
- Vercel project: `https://vercel.com/jims-projects-b7cb6c2e/vibecount`
- Supabase project: `https://supabase.com/dashboard/project/lazorvlkgxgzdgflzhjm`

## Suggested Next Prompt For Another LLM Coder

```text
Continue VibeCount Phase 3/4 work on branch codex/phase-3-invoice-reminders.
Read AGENTS.md, spec.md, tasks.md, HANDOVER.md, and LLM_HANDOVER.md first.

Production check after latest push:
1. Verify RESEND_API_KEY and RESEND_FROM_EMAIL are set in Vercel env vars.
2. Verify ANTHROPIC_API_KEY is set in Vercel env vars.
3. Test /dashboard/review loads and the AI review returns findings.
4. Test a pending reminder draft can be sent or discarded from the dashboard.

Remaining Phase 4 tasks (see tasks.md Phase 4 direction):
- Browser-agent login with short-lived scoped sessions (parked — do not build here).
- Proposals, contracts, e-signatures (parked — do not build here).
- All write-like MCP tools remain parked until acceptance criteria are met
  (see knowledge-base/mcp-acceptance-criteria.md).

Do not build Phase 4 MCP/browser-agent features.
Run npm test, npm run lint, npm run build before committing.
Commit and push each completed fix.
```

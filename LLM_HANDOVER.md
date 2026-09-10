# VibeCount LLM Coder Handover

Last updated: 2026-06-01 (session 5 — Supabase migration verified applied)

## Start Here

- Repo: `/Users/standard/Developer/vibecount`
- Active branch: `claude/vibecount-ai-agents`
- Remote: `origin/claude/vibecount-ai-agents`
- Production URL: `https://vibecount-teal.vercel.app`
- Vercel project: `jims-projects-b7cb6c2e/vibecount`
- Supabase project: `lazorvlkgxgzdgflzhjm`

Read these before making changes:

- `AGENTS.md`
- `spec.md`
- `tasks.md`
- `HANDOVER.md`

---

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
- Glossary content is static, curated, and accountant-reviewed — never LLM-generated.

---

## Branch Strategy

| Branch | Purpose |
|---|---|
| `codex/phase-3-invoice-reminders` | Phase 2/3 hardening — the "main production" branch |
| `claude/vibecount-ai-agents` | Phase 4 features — current working branch |

`claude/vibecount-ai-agents` branches from `codex/phase-3-invoice-reminders` and adds Phase 4 on top.

**PR open:** https://github.com/jimbrouw/vibecount/pull/3
Target: `codex/phase-3-invoice-reminders`
Last commit: `4295cea`

---

## What Was Built — Session 4 (2026-06-01)

All features below are on branch `claude/vibecount-ai-agents`.

### Companies House client lookup

- `app/api/companies-house/search/route.ts` — server-side proxy to Companies House API
  - GET `?q=...` — Basic auth with user's API key from settings
  - Returns up to 5 active companies: `{ name, company_number, address, status }`
- `app/dashboard/invoices/new/InvoiceBuilder.tsx`
  - Debounced CH search on client name input (400ms)
  - Dropdown shows suggestions; selecting one fills name, address, company number
  - Stored address shown below input when filled
- Schema: `clients` now has `address`, `company_number`, `vat_number` columns
- Schema: `user_settings` now has `companies_house_api_key` column
- Invoice PDF renders client address below "To: [name]" (up to 4 lines)
- `VAT no: {n}` rendered on PDF only when user is VAT-registered

⚠️ **User todo:** Get a free CH API key at developer.companieshouse.gov.uk, add to Settings → Client intelligence.
⚠️ **Not yet wired:** `VoiceInvoiceBuilder.tsx` still lacks CH autocomplete — see Known Issues.

### Supabase Storage PDF backup (invoices)

- `supabase/migrations/20260531010000_invoice_pdf_storage.sql`
  - Private `invoices` storage bucket; 10 MB limit, PDF only
  - RLS: users can only read/write `{their_user_id}/*`
- `app/api/invoices/pdf/route.ts` — after PDF generation, uploads to `invoices/{userId}/{number}.pdf`, saves `pdf_path` on the invoice row (best-effort, never blocks invoice creation)
- `app/api/invoices/download/route.ts` — GET `?id=...` → 5-min signed URL, redirects as download
- `app/api/invoices/share-url/route.ts` — GET `?id=...` → 30-day signed URL, returns JSON

### Email invoice button (mailto with Supabase signed URL)

- `app/dashboard/EmailInvoiceButton.tsx` — client component
  - Only renders when `hasPdf: true`
  - On click: fetches 30-day signed URL, builds pre-filled mailto, opens email client
  - Subject: `Invoice INV-2026-0042 — £2,500.00`
  - Body includes amount in figures + words, download link (valid 30 days), due date, payment terms, optional payment link
- `app/dashboard/page.tsx` — shows "Download PDF" and "Email invoice" for invoices with `pdf_path`

⚠️ **Known bug:** Email invoice button only appears for invoices created after the Storage migration was applied (those with `pdf_path` set). Pre-existing invoices have `pdf_path = null`. See Known Issues #1.

### Phase 4 agent infrastructure

- `supabase/migrations/20260530140000_agent_sessions.sql`
  - `agent_sessions`: `token_hash` (SHA-256), `scopes text[]`, `expires_at`, `revoked_at`
  - `agent_actions`: immutable audit log (tool, scope_used, params_summary, result_status)
- `lib/mcp/auth.ts` — `generateToken()`, `hashToken()`, `validateAgentToken()`, `logAgentAction()`
- `app/api/mcp/session/route.ts` — POST create, DELETE revoke, GET list active sessions
- MCP tools at `app/api/mcp/tools/`:
  - `get-pl-summary` — read P&L summary for a period
  - `list-expenses` — list expense records
  - `list-invoices` — list invoices
  - `list-uncategorised` — list uncategorised records
  - `draft-record` — write-draft to `financial_records` (lands in review, never approved)
  - `draft-invoice` — write-draft to `invoices` (lands in draft status)
- `app/dashboard/settings/AgentAccess.tsx` — scope picker, generate 15-min token (shown once), revoke sessions, link to audit log
- `app/dashboard/agent/audit/page.tsx` — last 100 agent actions

### Glossary content (27 terms)

- `lib/glossary.ts` — replaced placeholders with 27 founder-approved terms
- 5 terms annotated `// VERIFY (accountant decision)`:
  - Trading Allowance (£1,000 threshold current?)
  - Class 2 NICs (voluntary rate / personal NI record)
  - Annual Investment Allowance (current cap)
  - Use of home (flat vs proportional actual bills)
  - VAT Flat Rate Scheme (sector %)
- Glossary does not launch until accountant review is done

### Proposals + contracts + e-signatures

- `supabase/migrations/20260530110000_proposals.sql` — proposals + proposal_line_items
- `supabase/migrations/20260530120000_contracts.sql` — contracts
- `/dashboard/proposals` — create, status flow, PDF download, convert to invoice
- `/dashboard/contracts` — list, download PDF, mark sent/signed
- `app/dashboard/contracts/SignatureCanvas.tsx` — draw or type signature; on confirm POSTs to `/api/contracts/sign`
- `app/api/contracts/sign/route.ts` — embeds PNG signature into contract PDF, marks signed

### Projects / scope tracking

- `supabase/migrations/20260530130000_projects.sql` — `projects` table, `project_id` FK on invoices and financial_records
- `/dashboard/projects` — create, tag invoices/records, budget progress bar, status flow

### Review agent + batch categorisation

- `/dashboard/review` — reads approved records + sent invoices, calls Claude for analysis
- `app/api/review/suggest/route.ts` — read-only, never writes to DB
- `app/api/records/batch-suggest-categories/route.ts` — one Claude call for all uncategorised records
- `BatchCategorisePanel.tsx` — checkbox table, user unticks disagreements before applying
- `app/dashboard/records/SuggestCategoryButton.tsx` — inline per-record AI category suggestion

---

## Known Issues

### 1. Vercel crons need manual setup ⚠️

`vercel.json` was removed to fix Hobby plan deployment errors. Crons must be set up manually.

**User todo:**
- Vercel Dashboard → Project Settings → Crons
- Add `/api/reminders/due` — `0 8 * * *` (08:00 daily)
- Add `/api/invoices/repeating/run` — `0 7 * * *` (07:00 daily)

### 2. Quote/proposal PDF migration applied ✅

`supabase/migrations/20260601000000_quote_proposal_pdf_storage.sql` has been applied to production Supabase.

Verified on 2026-06-01:
- `supabase migration list --linked` shows `20260601000000` on both Local and Remote.
- `supabase db query --linked` confirms `public.quotes.pdf_path` and `public.proposals.pdf_path` both exist as `text`.

Previously fixed (commit `4295cea`):
- ~~idempotency_key bug in draft-record and draft-invoice MCP tools~~
- ~~Email invoice button missing on pre-existing invoices (on-demand PDF generation)~~
- ~~Companies House not wired into VoiceInvoiceBuilder~~
- ~~PDF backup missing from quote and proposal routes~~

---

## Production Supabase — Applied Migrations

All of the following have been applied to `lazorvlkgxgzdgflzhjm`:

- `phase_2_digital_records_foundation`
- `phase_2_secure_records_storage`
- `phase_2_csv_import_review`
- `phase_2_bank_statement_import`
- `phase_3_quotes_services`
- `add_invoice_payment_links`
- `repeating_invoice_templates`
- `invoice_delivery_reminders`
- `20260530100000_quarterly_readiness_checks.sql`
- `20260530110000_proposals.sql`
- `20260530120000_contracts.sql`
- `20260530130000_projects.sql`
- `20260530140000_agent_sessions.sql`
- `20260531000000_client_details.sql`
- `20260531010000_invoice_pdf_storage.sql`
- `20260601000000_quote_proposal_pdf_storage.sql`

To check/apply future migrations, use an authenticated Supabase CLI session:

```bash
supabase migration list --linked
supabase db push --linked
```

Do not paste long-lived Supabase access tokens into this handover, chat, or commits. If a token has already been exposed, rotate it in Supabase.

---

## Required Vercel Env Vars

These must exist in Vercel (Production + Preview + Development):

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://lazorvlkgxgzdgflzhjm.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Published anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side admin client |
| `ANTHROPIC_API_KEY` | Server-side only |
| `RESEND_API_KEY` | For reminder sending |
| `RESEND_FROM_EMAIL` | From address for reminders |
| `CRON_SECRET` | Shared secret for cron routes |
| `NEXT_PUBLIC_POSTHOG_KEY` | Analytics |
| `NEXT_PUBLIC_POSTHOG_HOST` | `https://app.posthog.com` |

---

## Pending Work (ordered)

### Before merging PR

1. Resolve the Phase 4 boundary decision before merging: either revise `AGENTS.md`/handover docs to allow this scoped Phase 4 PR, or split Phase 2/3 hardening from Phase 4 MCP work.
2. Merge PR #3: https://github.com/jimbrouw/vibecount/pull/3

### User todos (owner: Jim)

- Get Companies House API key at developer.companieshouse.gov.uk → add to Settings → Client intelligence
- Set up 2 Vercel crons in dashboard: `/api/reminders/due` at `0 8 * * *`, `/api/invoices/repeating/run` at `0 7 * * *`
- Confirm Vercel env vars: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ANTHROPIC_API_KEY`, `CRON_SECRET`
- Run Whisper sub-gate: record 20 real invoice amounts, verify Whisper accuracy before voice goes to production users
- Accountant review of 5 glossary terms (see tasks.md parallel track)

### Branch merge

- `claude/vibecount-ai-agents` needs PR → `codex/phase-3-invoice-reminders` or `main`
- Run `npm run lint && npm test && npm run build` before creating PR
- Check for outstanding migrations after merge with `supabase migration list --linked`

---

## Verification Commands

```bash
npm run lint
npm test
npm run build
```

Known build warning: Next.js warns about multiple lockfiles and inferred workspace root — pre-existing, not introduced by recent changes.

Known audit issue: `npm audit --omit=dev --audit-level=high` reports vulnerabilities through `@vercel/config`/`path-to-regexp` and `next`/`postcss`. Do not run `npm audit fix --force` — it suggests breaking downgrades.

---

## Do Not Do

- Do not add `/api/mcp` browser-agent login flow (Phase 4 parked)
- Do not add `finalise_invoice` or any tool that silently approves/sends
- Do not send reminders, invoices, or emails without explicit user approval
- Do not bypass review states for records or imports
- Do not expose raw bank PDFs or unredacted account numbers to LLM prompts
- Do not write LLM-generated glossary content — static, accountant-reviewed only
- Do not say "HMRC-recognised MTD software" — say "MTD-ready records"

---

## Useful URLs

- Production: `https://vibecount-teal.vercel.app`
- Vercel project: `https://vercel.com/jims-projects-b7cb6c2e/vibecount`
- Supabase project: `https://supabase.com/dashboard/project/lazorvlkgxgzdgflzhjm`
- Supabase env vars: `https://vercel.com/jims-projects-b7cb6c2e/vibecount/settings/environment-variables`

---

## Suggested Next Prompt For Another LLM Coder

```text
Continue VibeCount Phase 4 work on branch claude/vibecount-ai-agents.
Read AGENTS.md, spec.md, tasks.md, HANDOVER.md, and LLM_HANDOVER.md first.

All code fixes are done. PR #3 is open:
https://github.com/jimbrouw/vibecount/pull/3

Before merging:
1. Resolve the Phase 4 boundary decision:
   - either revise AGENTS.md/HANDOVER.md/tasks.md to allow the scoped Phase 4 MCP work in this PR, or
   - split Phase 2/3 hardening from Phase 4 MCP work.

2. Supabase migration status is already verified:
   - 20260601000000_quote_proposal_pdf_storage.sql is applied remotely
   - public.quotes.pdf_path exists as text
   - public.proposals.pdf_path exists as text

3. Smoke-test key flows after deployment:
   - Create an invoice → PDF backs up → Download PDF and Email invoice both appear
   - Click Email invoice on an old invoice (no pdf_path) → generates on demand → mailto opens
   - Voice invoice with a company client name → CH suggestions appear → address pre-fills in typed preview
   - Download a quote PDF → no error, pdf_path saved on row
   - Agent settings → generate token → audit log shows the action

4. Set up 2 Vercel crons in the dashboard (Hobby plan, manual setup):
   /api/reminders/due          →  0 8 * * *
   /api/invoices/repeating/run →  0 7 * * *

5. Confirm Vercel env vars are set: RESEND_API_KEY, RESEND_FROM_EMAIL, ANTHROPIC_API_KEY, CRON_SECRET

Jim still owns:
- Companies House API key (developer.companieshouse.gov.uk → Settings → Client intelligence)
- Accountant review of 5 flagged glossary terms
- Whisper sub-gate (20 real invoice amounts) before voice is promoted
```

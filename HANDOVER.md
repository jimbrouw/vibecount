# VibeCount — Handover Document

_Last updated: 2026-05-29_

---

## What this project is

VibeCount is a freelancer invoicing tool built for people who find finance admin overwhelming — specifically dyslexic/dyscalculic users and creatives. Two hero features for v1:

1. **Structured Invoice Creation** — voice first (speak an invoice), never voice only (typing is a full equal path). Mandatory read-back of amounts in figures and words before the user confirms.
2. **Explain Simply** — a static, accountant-reviewed glossary of tax/accounting terms in plain English.

**Spec:** `/spec.md` — read this before making any product decisions. The principles section (Section 3) overrides everything.
**Task list:** `/tasks.md` — ordered build plan, do not skip ahead.
**Validation result:** `/validation-result-v2.md` — the extraction prompt was proven at 93% accuracy. Voice is safe to build.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend + routing | Next.js 16 (App Router, TypeScript, Tailwind) |
| Auth + database | Supabase (Auth + Postgres + Storage) |
| AI extraction | Anthropic `claude-sonnet-4-6` — use `SYSTEM_PROMPT` from `validation_gate_v2.py` verbatim |
| Speech (Task 6 only) | Whisper |
| PDF | Server-side with `pdf-lib` |
| Hosting | Vercel (auto-deploys from `main`) |
| Analytics | PostHog |

---

## Repos and URLs

| Thing | URL |
|---|---|
| GitHub | https://github.com/jimbrouw/vibecount |
| Snapshot repo for current Phase 2/3 work | https://github.com/jimbrouw/vibecount-phase-3-invoice-reminders |
| Vercel project | https://vercel.com/jims-projects-b7cb6c2e/vibecount |
| Live URL (stable alias) | https://vibecount-teal.vercel.app |
| Latest Vercel Preview | https://vibecount-nrdh9zfjq-jims-projects-b7cb6c2e.vercel.app |
| Latest Vercel Preview inspect | https://vercel.com/jims-projects-b7cb6c2e/vibecount/BxXVNTZ9HTF48cE2AZADoTWZjup8 |
| Vercel env vars page | https://vercel.com/jims-projects-b7cb6c2e/vibecount/settings/environment-variables |
| Supabase project | https://supabase.com/dashboard/project/lazorvlkgxgzdgflzhjm |

---

## Current status as of 2026-05-29

- Current working branch: `codex/phase-3-invoice-reminders`
- Worktree was clean before deployment.
- Current branch has been pushed to the existing repo as
  `origin/codex/phase-3-invoice-reminders`.
- A separate private snapshot repo was created and pushed with this branch as
  `main`: https://github.com/jimbrouw/vibecount-phase-3-invoice-reminders
- Vercel Preview deployment is ready:
  https://vibecount-nrdh9zfjq-jims-projects-b7cb6c2e.vercel.app
- Preview is behind Vercel deployment protection and returns `401` unless the
  tester is authorised on the Vercel project.
- Verification immediately before deployment:
  - `npm run lint` passed
  - `npm test` passed
  - `npm run build` passed
- Vercel CLI on this machine is outdated (`54.5.1`; latest seen `54.6.1`).
  Upgrade with `npm i -g vercel@latest` or `pnpm add -g vercel@latest`.

## What's been built

### ✅ Task 0 — Skeleton live

- Next.js 16 app scaffolded with TypeScript + Tailwind
- Packages installed: `@supabase/supabase-js`, `@supabase/ssr`, `posthog-js`, `posthog-node`
- Supabase client helpers created:
  - `lib/supabase/client.ts` — browser client
  - `lib/supabase/server.ts` — server component client
  - `lib/supabase/middleware.ts` — session refresh for proxy
- `proxy.ts` — Next.js 16 proxy (replaces middleware) wired up, protects `/dashboard`, redirects logged-in users away from auth pages
- `.env.local` and `.env.local.example` present with all keys
- Git repo initialised on `main`, pushed to GitHub
- Connected to Vercel, auto-deploys on push to `main`
- Hello world page live at https://vibecount-teal.vercel.app

### ✅ Task 1 — Auth

- `app/login/page.tsx` — email + password login form
- `app/signup/page.tsx` — signup form, handles both "email confirmation required" and "straight through" cases
- `app/dashboard/page.tsx` — server-side protected page, shows user email, redirects to `/login` if not authed
- `app/dashboard/LogoutButton.tsx` — client component, calls `supabase.auth.signOut()` then redirects
- `app/auth/callback/route.ts` — handles Supabase email confirmation redirect, exchanges code for session
- Home page (`app/page.tsx`) updated with "Create account" and "Sign in" links

### ✅ Task 2 — Schema

- Supabase migrations added under `supabase/migrations/`
- `public.clients` — saved client entity with zero-friction inline-create shape: `id`, `user_id`, `name`
- `public.invoices` — user-owned invoice rows with `client_id`, `number`, `invoice_date`, `description`, `amount`, `payment_terms`, `status`, `pdf_path`
- `public.glossary_terms` — static Explain Simply glossary seed rows
- Row-level security enabled on all three public tables
- Client and invoice policies restrict reads/writes to the signed-in user
- Glossary terms are read-only to app users and public-readable for the static Explain Simply UI
- Supabase security advisor is clean after migration
- Verified by inserting and reading a test invoice in Supabase, then cleaning it up

### 🟡 Task 3 — The Spine (typed invoice → PDF)

Implemented locally:

- `/dashboard/invoices/new` protected page with typed invoice form
- Live editable preview beside the form
- Client name uses saved-client model: exact normalized match or inline create on confirm
- Amount appears in figures and words in the form preview
- `/api/invoices/pdf` authenticated route validates the user, creates/reuses client, inserts finalised invoice row, generates a server-side PDF, and returns it as a download
- `pdf-lib` added for server-side PDF generation
- Dashboard now links to "Create invoice"
- Google sign-in added on login and signup once Supabase/Google OAuth is configured
- Invoice date defaults to today's date in UK format (`day/month/year`)
- Payment terms default to 30 days

Verified:

- `npm run lint` passes
- `npm run build` passes
- Unauthenticated `/dashboard/invoices/new` redirects to `/login`
- Unauthenticated `/api/invoices/pdf` returns `401`
- Logged-in browser flow reaches `/dashboard/invoices/new` and `POST /api/invoices/pdf` returns `200`

### ✅ Task 4 — Explain Simply

Implemented locally:

- `/dashboard/glossary` protected page loads glossary terms from Supabase
- Searchable glossary browser with tap-to-expand term cards
- Display rule is implemented: official term stays visible, explanation and example expand beneath it
- Dashboard layout now provides glossary data to logged-in routes

Verified:

- `npm run lint` passes
- `npm run build` passes
- `/dashboard/glossary` is included in the build output

### ✅ Task 5 — Accessibility layer

Implemented locally:

- Shared accessibility provider for logged-in routes
- Floating accessibility controls for large text, relaxed spacing, and plain-language mode
- Read-aloud buttons for invoice amount summary and invoice preview summary using Web Speech API
- Plain-language helper notes added to dashboard, invoice creation, and settings
- Money displays on the dashboard now show figures and words, not figures only

Verified:

- `npm run lint` passes
- `npm run build` passes

Pending final check:

- Browser-test the accessibility toolbar and read-aloud controls in a logged-in session

### 🟡 Task 6 — Voice path

Implemented locally:

- `/dashboard/invoices/voice` protected voice-entry page
- `/api/voice/draft` authenticated route that accepts either recorded audio or an edited transcript
- Whisper transcription via OpenAI `audio/transcriptions`
- Structured extraction using the validated `SYSTEM_PROMPT` from `validation_gate_v2.py`
- Ambiguous amount hard-stop with candidate selection
- Mandatory spoken read-back before continuing
- Confirmed voice draft hands off into the existing typed invoice preview flow

Verified:

- `npm run lint` passes
- `npm run build` passes
- `/api/voice/draft` and `/dashboard/invoices/voice` are included in the build output

Remaining before this task can be called done:

- add `OPENAI_API_KEY` for Whisper transcription
- run the Whisper sub-gate with real founder recordings
- browser-test the logged-in voice flow end to end

### 🟡 Settings groundwork

Implemented locally:

- `user_settings` migration added with RLS
- `/dashboard/settings` protected page and `/api/settings` read/write route
- Settings form for legal name, address, contact details, bank details, VAT, invoice prefix, payment terms, and late-payment wording
- Invoice creation now reads saved defaults from `user_settings`
- PDF generation now uses saved sender identity, bank details, VAT details, invoice prefix, and late-payment wording
- Private UTR storage is supported in settings but intentionally not shown on invoices

### ✅ Phase 2 — MTD-ready records foundation

Implemented on the current branch:

- Unified `financial_records` model for income and expenses, not separate
  `income_records` / `expenses` tables
- Default and user record categories with SA103 mapping support
- Source import tracking through `record_imports`
- Generated `tax_year_start` and `tax_quarter` columns in the database
- Quarter summary view: `financial_record_quarter_summaries`
- Audit-friendly record change logging
- Secure records storage support:
  - record attachments
  - private signed attachment URLs
  - export history
  - delete/export routes
- `/dashboard/records` with manual record entry, review, tax-year selection,
  threshold tracker, quarterly summaries, CSV import, bank import, and exports
- CSV import staging via `csv_import_rows`; only approved rows are committed
  into `financial_records`
- Bank statement import prototype via `bank_statement_import_rows`; raw PDFs
  are not stored by default and rows are reviewed before commit
- `/dashboard/tax-prep` plain-English Self Assessment preparation page
- `/api/tax-prep/export` accountant review export
- Agent-native selector pass completed across auth, dashboard navigation,
  invoice creation and voice confirmation, records/manual review, CSV and bank
  import review controls, records exports, tax-prep export, settings, and
  invoice status/reminder confirmation controls.

Important implementation note:

- Do **not** add new `income_records` and `expenses` tables from older planning
  notes unless a future migration plan proves the unified `financial_records`
  model is blocking the product.
- Phase 2 is now a stabilisation and verification phase, not a from-scratch
  schema build.

Latest selector-pass verification:

- `npm run lint` passed
- `npm test` passed
- `npm run build` passed
- Local Playwright check against `http://localhost:3002/login` and
  `/signup` confirmed the auth selectors render in the browser.

Latest review-gate audit:

- Invoice PDF creation now requires the invoice UI to send
  `humanConfirmed: true` after the review button is pressed.
- Manual financial records are created with `status = review`; approval happens
  only from the review list/import review controls.
- Due invoice reminder automation now writes pending reminder drafts and disables
  the due reminder rather than sending email from the cron route.
- `npm run lint`, `npm test`, targeted guardrail searches, and `npm run build`
  pass after the audit changes.

Latest tax estimate verification:

- Tax-prep UI labels the calculation base as net profit and shows visible
  estimate-only caveat copy: not tax advice, not a filing calculation, and not
  a tax return submission.
- Tax-prep CSV export now includes an estimate/review-pack caveat row and
  `suggested_value_estimate` header wording.
- Targeted searches confirm no app/lib usage of gross-profit wording in tax
  estimate surfaces; `npm run lint`, `npm test`, and `npm run build` pass.

Latest records/import QA fixes:

- Records now self-heal missing category seed data by creating user-owned
  fallback income and expense categories when no usable categories are present.
- CSV import accepts common bank/spreadsheet headers such as details,
  debit/credit, paid in/paid out, and stages rows for review.
- Bank statement import now extracts text from text-readable PDFs before
  redaction/parsing; scanned image-only PDFs still need CSV or text export.
- CSV and bank file inputs are styled as explicit choose-file controls.
- Payment reminders page now explains that VibeCount prepares reminder drafts
  for human review rather than silently emailing clients.

### ✅ Phase 3 — Commercial invoice workflow groundwork

Implemented on the current branch:

- Left-sidebar dashboard shell with centralised navigation in
  `app/dashboard/DashboardShell.tsx`
- Quotes and reusable services
- Quote status flow and quote-to-invoice conversion
- Payment link settings and invoice rendering support
- Repeating invoice templates
- Invoice delivery/reminder database support and reminder copy utilities

Remaining Phase 3 caution:

- User-approved invoice sending / automated follow-up reminders should remain
  strictly user-approved. Do not silently send invoices or reminders.

---

## Incomplete / needs doing before moving forward

### ✅ Env vars added to Vercel

Vercel now has these variables across Production, Preview, and Development:

| Variable | Value (from `.env.local`) |
|---|---|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_Oluky7SEjng36pBB0CFMUw_oEwlLlvf` |
| `ANTHROPIC_API_KEY` | your `sk-ant-api03-...` key — server side only |
| `NEXT_PUBLIC_POSTHOG_KEY` | `phc_vj8Y8ybvQs2A5zfKgWrfsaEknPNQzWaA82EiSmyJK8zL` |
| `NEXT_PUBLIC_POSTHOG_HOST` | `https://app.posthog.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://lazorvlkgxgzdgflzhjm.supabase.co` |

Verified with `vercel env list` on 2026-05-26. Production was redeployed after the env change, and the stable alias is live at `https://vibecount-teal.vercel.app`.

### ✅ Supabase auth callback URL configured

In Supabase dashboard → **Authentication → URL Configuration**:
- **Site URL:** `https://vibecount-teal.vercel.app`
- **Redirect URLs:** include:
  - `https://vibecount-teal.vercel.app/auth/callback`
  - `http://localhost:3000/auth/callback`
  - `http://localhost:3002/auth/callback`

Google OAuth also needs this Supabase callback URL registered in Google Cloud:
`https://lazorvlkgxgzdgflzhjm.supabase.co/auth/v1/callback`

### ✅ Founder decision for Task 2

Task 2 used the recommended model: **Client is a saved entity with zero-friction inline create.**

No separate client-management flow is part of MVP.

---

## Remaining tasks

### Task 3 — The Spine (typed invoice → PDF)
Implementation is in place and logged-in PDF generation has been verified locally.

### Task 4 — Explain Simply (static glossary UI)
Implementation is in place and builds cleanly. Glossary terms can also be opened
from supported finance labels inside the app, not only on the glossary page.

Remaining before launch:
- founder-written glossary content
- accountant review of glossary wording

### Task 5 — Accessibility layer
- Large-text mode, spacing controls, plain-language toggle
- Read-aloud (Web Speech API) for amounts and invoice summary
- Confirm figures+words+chunking from Task 3 applied everywhere money appears

Done when: accessibility toggles work, money is always shown figures + words everywhere.

### Task 6 — Voice path (uses the validated extraction prompt)
- **Whisper sub-gate first:** record ~20 real invoice amounts, run audio → Whisper → extraction. If Whisper mangles numbers badly, keep voice behind typing.
- Mic capture → Whisper → extraction (using `SYSTEM_PROMPT` from `validation_gate_v2.py` verbatim) → draft
- **Mandatory read-back** (figures + words + spoken). Cannot be skipped.
- If `amount_ambiguous` is true → hard stop, show candidates, user must pick/confirm. Never auto-trust.
- Confirmed draft flows into the same preview/PDF flow from Task 3.

Done when: speak an invoice → ambiguous amounts force a choice → lands in Task 3 preview flow.

### Task 7 — Tone, metrics, polish
- Done in code:
  - Tone pass applied across the public, auth, and invoice flows without using the banned claims from spec Section 10.
  - PostHog hooks added for `voice_invoice_attempt`, `invoice_draft_completion`, `pdf_invoices_generated`, `glossary_term_opened`, `failed_voice_attempt`, and `manual_entry_usage`.
  - Small visual pass pushed the main cards and panels further into the British green / warm cream direction.

### Phase 2 note — MTD-ready records are now implemented and need verification

- `knowledge-base/making-tax-digital.md` now captures the verified HMRC position as
  of 27 May 2026.
- MTD is no longer a vague Phase 3 awareness note.
- Phase 2 now has the **MTD-ready records** foundation implemented without
  claiming HMRC-recognised compliance:
  - unified structured income / expense records
  - secure per-user cloud record storage
  - attachment storage with signed access and export/deletion paths
  - CSV import with review before commit
  - privacy-first bank statement PDF import prototype
  - quarterly summaries
  - threshold tracking
  - tax estimate support
  - plain-English Self Assessment prep for SA103S / SA103F
- Direct HMRC submission should remain later until the records model and user
  workflow are proven.
- Near-term Phase 2 work should focus on verification and hardening:
  - add any missing `data-testid` selectors
  - verify HMRC quarter boundaries with real test rows
  - verify CSV approve/reject/commit behaviour
  - verify bank statement redaction and no raw PDF persistence
  - confirm every tax estimate UI/API/export includes disclaimer copy
  - verify figures-and-words formatting on tax-prep money values
- `knowledge-base/bank-statement-import.md` captures the bank PDF idea:
  extract transactions, redact before LLM/database use, suggest categories, and
  commit only user-approved rows into records.
- `knowledge-base/self-assessment-plain-english.md` captures the tax return prep
  idea: map HMRC sole trader questions to simple language, VibeCount data
  sources, and exportable accountant review packs before attempting filing.

### Phase 3 note — commercial workflow is partly implemented

- Phase 3 has started adding the lightweight Xero/SoloPad-style workflow around
  the current invoice product:
  - branded quotes and invoices
  - saved services / line items
  - quote-to-invoice conversion
  - hosted payment links
  - repeating invoice drafts
- User-approved payment follow-up reminders are the remaining risky area:
  keep reminder generation and sending explicitly user-approved.
- Keep the data model reusable so proposal and contract documents can inherit
  client, service, scope, price, and payment-term data later.
- `knowledge-base/freelancer-operating-system.md` captures the smart document
  direction and the guardrail against becoming a full project-management suite
  too early.

### Records QA note — category fallback

- The records page now self-heals missing category seeds and also renders
  fallback manual category options if production still returns no category rows.
- Saving a manual record from a fallback option creates the real user-owned
  category before inserting the review record.
- Production Supabase initially only had the older invoice/client schema, so CSV
  import failed at `record_imports`. On 29 May 2026, the Phase 2 records
  foundation, secure records storage, CSV import review, and bank statement
  import migrations were applied to project `lazorvlkgxgzdgflzhjm`.
- Verified live tables now exist for `record_imports`, `csv_import_rows`,
  `bank_statement_import_rows`, `financial_records`, attachments, exports, and
  10 default categories.

### Phase 4 note — agentic tax copilot

- `knowledge-base/agentic-tax-copilot.md` captures the later agent idea.
- Agent/MCP work on branch `claude/vibecount-ai-agents-1i5ob` is Phase 4 work
  and should stay parked until Phase 2 records are stable and verified.
- Treat Hermes-style autonomy as inspiration, not the immediate architecture.
- The first agentic version should be read-only: inspect approved records, explain
  issues, and create a review queue.
- Later versions can suggest draft actions and write only after explicit user
  approval.
- Hard boundary: no silent HMRC submission, invoice sending, expense approval,
  or record changes.
- MCP tools such as `get_pl_summary`, `list_expenses`, browser-agent login, and
  `finalise_invoice` are future Phase 4 acceptance criteria. Do not build or
  merge them as part of Phase 2.
- Any future `finalise_invoice` tool needs audit logging, ownership checks,
  idempotency, valid status transitions, short-lived scoped tokens, permission
  gating, and per-action confirmation before external testing.
- Creators Base-style proposals, contracts, e-signatures, client portals, and
  scope tracking belong here unless they directly support Phase 3 quotes,
  invoices, payments, or records.

---

## Important rules (do not forget)

- **AI drafts. Humans confirm. AI never commits.** The read-back is the safety gate, not the confidence colour.
- **The amount field always requires human review** — even a green confidence badge does not remove this.
- **No LLM-generated glossary content** — static, human-written, accountant-reviewed only.
- **No auto-sending invoices, no payment processing, no reminders** — user sends the PDF themselves.
- The spec's NO list: no bookkeeping, no banking integrations, no expense OCR, no tax filing, no CRM, no spreadsheet migration, no AI finance checking, no payment chasing, no automated delivery tracking, no LLM-generated glossary.
- Phase 2 can now introduce bookkeeping-adjacent digital records, but keep the
  claim as **MTD-ready records**, not HMRC-recognised MTD software.
- Use **net profit**, not gross profit. VibeCount does not currently model
  cost of sales.
- Every tax estimate surface must include caveat/disclaimer copy. Treat tax
  estimates as planning aids, not filing-accurate calculations.
- Do not duplicate the records schema with separate `income_records` and
  `expenses` tables unless there is a deliberate migration away from
  `financial_records`.

---

## Local dev

```bash
cd /Users/standard/Developer/vibecount
npm install
npm run dev        # starts at http://localhost:3000
```

`.env.local` is present with all keys. Do not commit it (it is gitignored).

To deploy a preview manually: `vercel deploy --yes`.

To deploy production: `vercel deploy --prod` or push to `main` if the project is
configured to auto-deploy production from `main`.

Latest production deployment promoted on 2026-05-29:
`https://vibecount-teal.vercel.app`

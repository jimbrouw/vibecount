# VibeCount — Handover Document

_Last updated: 2026-06-02_

---

## What this project is

VibeCount is a freelancer finance tool built for people who find finance admin overwhelming — specifically finance-anxious creatives (designers, developers, photographers, writers). The founder built it to solve their own problem first (strong founder-market fit). The strategic play is to be the emotional wedge between "free but confusing" tools and complex products like Xero or FreeAgent. Agent-native and mobile-first are the medium-term direction; broader sole traders (plumbers, tradespeople) are a later expansion.

Two hero features for v1:

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
| PDF | Server-side — library TBD at Task 3 |
| Hosting | Vercel (auto-deploys from `main`) |
| Analytics | PostHog |

---

## Repos and URLs

| Thing | URL |
|---|---|
| GitHub | https://github.com/jimbrouw/vibecount |
| Vercel project | https://vercel.com/jims-projects-b7cb6c2e/vibecount |
| Live URL (stable alias) | https://vibecount-teal.vercel.app |
| Vercel env vars page | https://vercel.com/jims-projects-b7cb6c2e/vibecount/settings/environment-variables |
| Supabase project | https://supabase.com/dashboard/project/lazorvlkgxgzdgflzhjm |

---

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

### ✅ Phase 2 — MTD-ready records (complete as of 2026-06-02)

**What was built (commit `4eb4c85`, branch `claude/vibecount-ai-agents-1i5ob`):**

- **DashboardShell** — centralised nav component extracted from 6 copy-pasted pages. Nav links: Invoices, Records, Tax Prep, Explain Simply, Agent, Settings. `data-testid` on every nav link.
- **`financial_records` table** — unified income/expense records with `bigint amount_pence`, GENERATED STORED `tax_year_start` and `tax_quarter` columns, RLS.
- **`record_imports` table** — staging for CSV + bank PDF rows pending approval, `raw_row jsonb` stores only `{ date, description, amount_pence, direction }` — no account data.
- **Migration:** `supabase/migrations/20260529200001_add_financial_records.sql` — **must be applied to live Supabase project before shipping**.
- **API routes:** `GET/POST /api/records`, `PATCH/DELETE /api/records/[id]`, `GET /api/records/summary`, `GET /api/records/export`, `POST /api/records/import`, `POST /api/records/import/[id]/approve`, `POST /api/records/import/[id]/reject`, `POST /api/records/bank-import`, `GET /api/tax-prep/export`.
- **Pages:** `/dashboard/records` (records dashboard with quarterly summary, tax estimate, MTD progress, CSV + PDF import), `/dashboard/tax-prep` (SA103S/F prep pack, accountant checklist, export download).
- **Tax estimate (`lib/tax/estimate.ts`):** 2026/27 rates — personal allowance £12,570, basic 20%, higher 40%, Class 4 NI **6%** (cut from 9% April 2024), Class 2 NI abolished. Disclaimer on every surface.
- **MTD thresholds (`lib/records/mtd-thresholds.ts`):** £50k → 6 Apr 2026, £30k → 6 Apr 2027, £20k → 6 Apr 2028. No HMRC compatibility claimed.
- **Bank import privacy:** REDACT_PATTERNS strips account numbers, sort codes, IBAN, card numbers, balances before any LLM call. Raw PDF never stored.
- **data-testid pass:** added to login, invoice builder, record form, and all nav links.

**Phase 2 open items (before pushing `claude/vibecount-ai-agents-1i5ob` → `main`):**

1. Apply migration `20260529200001_add_financial_records.sql` to live Supabase project (Supabase dashboard → SQL editor, or `supabase db push`)
2. Verify glossary copy with accountant before launch
3. Whisper sub-gate (Task 6 carry-over) — 20 real founder recordings

**Key constraints that must not be changed:**

- Class 4 NI rate = **6%** (never 9%)
- `AMOUNT_ESTIMATE_DISCLAIMER` must appear on every API response and UI surface that shows a tax figure
- `/dashboard/tax-prep` must never suggest users can file from it — it is a review pack
- Bank PDF: redact before LLM, never store raw PDF, `raw_row` has no account data
- MTD copy: always include "Check GOV.UK for current thresholds" — no HMRC recognition claim

### Phase 4 note — agentic tax copilot (branch: `claude/vibecount-ai-agents-1i5ob`)

MCP server, BYOK chat, and API key management are already built on this branch. Do not merge until Phase 2 records are on production and verified. See `knowledge-base/agentic-tax-copilot.md` for the read-only → draft-action → approval-action progression.

Hard boundary: no silent HMRC submission, invoice sending, expense approval, or record changes without explicit user confirmation + audit log.

---

## Important rules (do not forget)

- **AI drafts. Humans confirm. AI never commits.** The read-back is the safety gate, not the confidence colour.
- **The amount field always requires human review** — even a green confidence badge does not remove this.
- **No LLM-generated glossary content** — static, human-written, accountant-reviewed only.
- **No auto-sending invoices, no payment processing, no reminders** — user sends the PDF themselves.
- The spec's NO list: no bookkeeping, no banking integrations, no expense OCR, no tax filing, no CRM, no spreadsheet migration, no AI finance checking, no payment chasing, no automated delivery tracking, no LLM-generated glossary.

---

## Local dev

```bash
cd /Users/standard/Developer/vibecount
npm install
npm run dev        # starts at http://localhost:3000
```

`.env.local` is present with all keys. Do not commit it (it is gitignored).

To deploy manually: `vercel --prod` or just push to `main` (Vercel auto-deploys).

# VibeCount — Handover Document

_Last updated: 2026-05-26_

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

---

## Incomplete / needs doing before moving forward

### 🔴 Env vars not fully in Vercel

Only `NEXT_PUBLIC_SUPABASE_URL` is in Vercel (Production + Development only, not Preview).

**These are missing from Vercel** — add at https://vercel.com/jims-projects-b7cb6c2e/vibecount/settings/environment-variables (tick all three environments for each):

| Variable | Value (from `.env.local`) |
|---|---|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_Oluky7SEjng36pBB0CFMUw_oEwlLlvf` |
| `ANTHROPIC_API_KEY` | your `sk-ant-api03-...` key — server side only |
| `NEXT_PUBLIC_POSTHOG_KEY` | `phc_vj8Y8ybvQs2A5zfKgWrfsaEknPNQzWaA82EiSmyJK8zL` |
| `NEXT_PUBLIC_POSTHOG_HOST` | `https://app.posthog.com` |

Also edit `NEXT_PUBLIC_SUPABASE_URL` to add the Preview environment.

### 🔴 Supabase auth callback URL not configured

In Supabase dashboard → **Authentication → URL Configuration**:
- **Site URL:** `https://vibecount-teal.vercel.app`
- **Redirect URLs:** add both:
  - `https://vibecount-teal.vercel.app/auth/callback`
  - `http://localhost:3000/auth/callback`

Without this, email confirmation links will not work.

### 🟡 Founder decision needed before Task 2

**Client model — confirm before building the schema:**

The spec recommends (and the tasks.md has as the default): **Client is a saved entity with zero-friction inline create.**

- On invoice creation, type or speak a client name
- System fuzzy-matches existing clients
- If matched → links to existing client (makes repeat invoicing fast)
- If no match → creates a new client inline from just the name, no separate flow
- No CRM, no required fields beyond name

Alternative: plain freetext string (simpler schema, loses repeat-client matching).

**Say "confirmed" or "use freetext" before Task 2 starts.**

---

## Remaining tasks

### Task 2 — Schema
Create Supabase migrations for the 4 tables. Row-level security so users only see their own data. Seed placeholder glossary terms.

**Tables:**
```sql
User        -- handled by Supabase Auth (auth.users)
Client      -- id, user_id, name
Invoice     -- id, user_id, client_id, number, date, description, amount,
            --  payment_terms, status (draft|finalised), pdf_path
GlossaryTerm -- id, term, explanation, example  (static seed data)
```

Done when: tables exist, RLS on, can insert/read a test invoice.

### Task 3 — The Spine (typed invoice → PDF) ← most important task
This is the backbone of the product. Build it before voice.

- Typed invoice form: client (inline create), date, description, amount, payment terms. Invoice number auto-generated.
- Preview screen — all fields editable.
- **Amount shown in figures AND words** (`£8,500` + "eight thousand five hundred pounds") with number chunking. This is core accessibility, not polish.
- Human confirm → generate server-side PDF → download.
- Optional: copy email text.
- No auto-send, no payment tracking.

Library choice for PDF: not decided. Consider `pdf-lib`, `@react-pdf/renderer`, or Puppeteer. Pick at implementation time — the spec deliberately left this open.

Done when: a user types an invoice and downloads a correct, professional PDF.

### Task 4 — Explain Simply (static glossary UI)
- Load from static JSON or seeded GlossaryTerm table.
- Display rule (mandatory): official wording → simple explanation → example. Official wording always visible, never replaced, never hidden.
- Tap-to-expand on any term.
- **Dependency:** founder writes 20–30 terms, accountant reviews them. Feature does not launch until review is done. Start this content work immediately — it's the only external dependency.

Done when: tapping a tax term shows plain-English explanation beside the official wording.

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
- Apply tone rules from spec (see spec Section 10). Banned words: "guarantee", "ensure", "will never", "safe to spend", "prevents", "eliminates".
- PostHog events: voice attempts, draft completion, PDFs generated, glossary opens, failed voice attempts, manual-entry usage.
- Visual polish: British green / warm cream / foil green palette.

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

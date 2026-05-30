# /specs/002-vibecount-mvp/tasks.md

# VibeCount MVP — Phase 1 Build Plan

Status: Validation gate PASSED. Cleared to build.
Framework: spec-kit (this is `tasks.md`) + GSD posture.
Read `spec.md` first. This file is the ordered work.

---

## Agent rules (Claude Code)

- Build in the order below. The spine (Task 3) comes before voice (Task 6) on purpose.
- Do not build anything in the spec's NO list.
- `[FOUNDER DECISION]` = stop and confirm before coding it.
- One task in progress at a time. Ship it working, then move on.
- GSD: smallest correct thing first. No abstraction you don't need today.

---

## Locked decisions (from spec + validation gate)

- **Stack:** Next.js · Supabase (Auth + Postgres + Storage) · server-side PDF · Vercel · PostHog.
- **Extraction prompt:** VALIDATED. Use the `SYSTEM_PROMPT` block from
  `validation_gate_v2.py` verbatim. It returns `amount`, `amount_ambiguous`,
  `amount_candidates`. Do not rewrite it.
- **Extraction model:** `claude-sonnet-4-6` confirmed working. Haiku
  (`claude-haiku-4-5-20251001`) is the cheaper option — test it on the v2 gate
  before committing, but do not block the build on it.
- **Speech:** Whisper (Task 6 only).
- `[FOUNDER DECISION — confirmed]` **Client = saved entity, zero-friction
  inline create.** On invoice creation, match the typed/spoken name to an existing
  client; if no match, create one inline from just the name. No separate "add client"
  flow.

## Data model (4 nouns — keep it minimal)

- **User** — auth + accessibility prefs.
- **Client** — id, user_id, name. (Per decision above.)
- **Invoice** — id, user_id, client_id, number, date, description, amount,
  payment_terms, status (draft / finalised), pdf_path.
- **GlossaryTerm** — id, term, explanation, example. Static seed data.

---

## Tasks

### Task 0 — Skeleton live
- [x] Next.js app, Supabase project, deploy to Vercel. A "hello world" page live on a URL.
- [x] Env vars wired (Supabase keys, Anthropic key server-side only, PostHog).
- **Done when:** the empty app loads on its Vercel URL.

### Task 1 — Auth
- [x] Supabase Auth: sign up + log in + log out.
- **Done when:** a user can create an account and reach a logged-in empty dashboard.

### Task 2 — Schema
- [x] Migrations for the 4 tables above. Row-level security so users only see their own data.
- [x] Seed `GlossaryTerm` table (placeholder rows for now; real content in the parallel track).
- **Done when:** tables exist, RLS on, you can insert/read a test invoice.

### Task 3 — THE SPINE (typed invoice → PDF) ← build this before voice
- [x] Typed invoice form: client (inline create), date, description, amount, payment terms.
      Invoice number auto-generated.
- [x] Preview screen — all fields editable.
- [x] Amount shown in **figures and words** (£8,500 + "eight thousand five hundred pounds")
      with **number chunking** (commas). This is core, not polish.
- [x] Human confirm → generate server-side PDF → download. Optional: copy email text.
- [x] No auto-send, no payment tracking, no reminders. User sends it themselves.
- **Done when:** a user types an invoice and downloads a correct, professional PDF.
- **Why first:** proves data model → invoice → PDF end to end with zero AI risk.
- **Verification note:** implementation is in place. Unauthenticated protection is
  verified, and a logged-in browser flow generated and downloaded a PDF.
- **Settings integration note:** saved invoice defaults are now wired into the
  invoice flow and PDF output: legal/trading name, address, contact details,
  default payment terms, bank details, VAT settings, invoice numbering, late-payment
  wording, and private UTR storage.

### Task 4 — Explain Simply (static glossary UI)
- [x] Load glossary from static JSON / seeded table. No live LLM.
- [x] Display rule: official wording → simple explanation → example. Official wording
      always visible, never replaced.
- [x] Tap-to-expand on any term in the app.
- **Done when:** tapping a tax term shows its plain-English explanation beside the official one.

### Post-Task 4 follow-up
- [x] Replace seeded placeholder glossary content with plain-English draft terms.
- [ ] Verify glossary copy against final approved wording before launch.

### Task 5 — Accessibility layer
- [x] Large-text mode, spacing controls, plain-language toggle.
- [x] Read-aloud (Web Speech API) for amounts and the invoice summary.
- [x] Confirm figures+words+chunking from Task 3 are applied everywhere money appears.
- **Done when:** the accessibility toggles work and money is always shown figures + words.
- **Verification note:** `npm run lint` and `npm run build` pass. Browser verification of the
  new controls is still pending.

### Task 6 — Voice path (uses validated prompt) + Whisper sub-gate
- [ ] **Whisper sub-gate first:** record the founder saying ~20 real invoice amounts
      (accents, pounds+pence, "eight fifty", "a ton"), run audio → Whisper → the v2
      extraction. If Whisper mangles numbers badly, keep voice behind typing and stop here.
- [x] Mic capture → Whisper → validated extraction prompt → draft.
- [x] **Mandatory read-back** (figures + words + spoken). Cannot be skipped.
- [x] If `amount_ambiguous` is true → **hard-stop**: show the candidates and make the
      user pick/confirm. Never auto-trust an ambiguous amount.
- [x] Confirmed draft flows into the SAME preview/PDF flow from Task 3.
- **Done when:** a user can speak an invoice, the ambiguous ones force a choice, and the
      result lands in the existing preview/PDF flow.
- **Verification note:** implementation is in place and builds cleanly, but this task is
  not complete until `OPENAI_API_KEY` is added and the Whisper sub-gate plus logged-in
  browser testing are run.
- **Founder check:** voice-to-invoice is confirmed working. The formal 20-sample
  Whisper sub-gate remains the launch-readiness check.

### Task 7 — Tone, metrics, polish
- [x] Apply the tone rules from the spec across core copy.
- [x] PostHog events (track-only, no targets): voice attempts, draft completion,
      PDFs generated, glossary opens, failed voice attempts, manual-entry usage.
- [x] Visual polish to the British-utility direction (green / cream / foil green).

---

## Parallel track (start now, has an outside dependency)

- [ ] **Glossary content** — founder writes 20–30 worst tax/accounting terms
      (official → simple → example).
- [ ] **Accountant reviews** the glossary for correctness. Explain Simply does not
      launch until this review is done.

---

## Definition of done (Phase 1)

A freelancer can create an invoice by **typing or voice**, verify it via **mandatory
read-back**, download a **correct PDF**, and tap any tax term for a **plain-English,
accountant-checked** explanation shown beside the official wording.

## Shippable earlier than that

After Task 5 you have a complete **typing-first** product (invoice → PDF + glossary +
accessibility). You can put that in front of real users while Task 6 / the Whisper
sub-gate is still being settled. Don't wait for voice to ship value.

---

## Honesty notes

- The validated extraction prompt was proven on **text only**. The Whisper sub-gate in
  Task 6 is the remaining real unknown for voice.
- [Unverified] Model availability/pricing changes — confirm your chosen model string
  and per-invoice cost before committing the deploy model.

---

## Phase 2 direction

Phase 2 is no longer just "extra bookkeeping later". It should start preparing
VibeCount for Making Tax Digital for Income Tax without claiming HMRC
compatibility too early.

### Phase 2 — MTD-ready records and routines

- [x] Digital record-keeping model for income, expenses, categories, and source imports
- [x] Quarter-aware summaries for self-employment records
- [x] MTD threshold tracking against GBP50,000 / GBP30,000 / GBP20,000 entry points
- [x] Audit-friendly edit history on record changes
- [x] Secure cloud record storage: per-user access, signed file URLs, exportable backups,
      and no raw bank statement storage by default
- [x] Spreadsheet / CSV import for income and expense records
- [x] Running tax estimate and quarterly habit prompts
- [x] Plain-English Self Assessment prep checklist for SA103S / SA103F fields
- [x] Export tax prep pack for user/accountant review
- [x] Bank statement PDF import prototype with redaction before LLM/database use
- [x] Agent-native browser-use hardening: stable `data-testid` selectors,
      semantic task surfaces, and explicit draft/review/confirm states across
      invoices, records, imports, tax prep, settings, and navigation
      Verification: selector pass and review-gate audit completed; `npm run lint`,
      `npm test`, targeted selector/guardrail searches, and `npm run build` pass.
      Release QA 2026-05-29: authenticated Playwright pass verified login,
      settings save, typed invoice PDF download, voice transcript extraction
      and mandatory read-back gate, manual record review, CSV import review and
      commit, bank statement text import redaction/review/commit, tax-prep
      caveats/export, and reminder draft gating.
- [x] Verify every tax estimate UI/API/export includes caveat copy and says
      "estimate"; use net profit language, never gross profit
      Verification: tax-prep UI now labels the estimate base as net profit,
      shows estimate-only caveat copy, and the CSV export includes an
      estimate/review-pack caveat row. Targeted searches, `npm run lint`,
      `npm test`, and `npm run build` pass.

### First task in Phase 2

- [x] **Digital records foundation** — create the structured record model and
      quarter summaries needed before any HMRC-facing workflow is attempted.
- [x] **Secure records storage** — store approved records, attachments, and change
      history behind row-level security with export and deletion paths. Position this
      as "MTD-ready records", not "HMRC-recognised MTD software".
- [x] **Manual income / expense entry** — let users add, edit, categorise, and review
      records before import automation exists.
- [x] **Quarter summary and threshold tracker** — show self-employment totals by tax
      year and quarter, plus progress towards the GBP50,000 / GBP30,000 / GBP20,000
      MTD entry points.
- [x] **CSV import** — import spreadsheet rows into a review table, then commit only
      approved rows into income / expense records.
- [x] **Bank statement import prototype** — after the records foundation, parse
      bank statement PDFs, redact account-level personal data, suggest categories,
      and let the user approve rows into income / expense records.
- [x] **Self Assessment plain-English map** — map SA103S / SA103F boxes to
      simple explanations and VibeCount data sources, then show what can be
      suggested versus what needs user/accountant input.
- [x] **Agent-native selector pass** — add stable `data-testid` attributes to
      critical nav links, invoice fields, login fields, record forms, import
      review controls, tax-prep export controls, and confirmation gates so
      external browser-use agents can operate the app without guessing.
      Verification: `npm run lint`, `npm test`, and `npm run build` pass;
      local browser check confirmed login/signup selectors render.
- [x] **Review-gate audit** — verify assisted flows never silently finalise
      invoices, approve financial records, send reminders, process payments, or
      change tax-prep outputs without explicit human confirmation.
      Changes: invoice PDF creation now requires an explicit reviewed-confirmed
      request from the UI; new manual records always enter review before approval;
      due reminder automation now creates pending reminder drafts instead of
      sending email. Release QA fix: record/import review action buttons now send
      status through hidden form fields instead of server-action button
      name/value, so Approve/Discard/Exclude controls submit deterministically.
      Verification: `npm run lint`, `npm test`, targeted guardrail search,
      authenticated Playwright review-gate pass, and `npm run build` pass.

Reference: [knowledge-base/making-tax-digital.md](knowledge-base/making-tax-digital.md)
Reference: [knowledge-base/bank-statement-import.md](knowledge-base/bank-statement-import.md)
Reference: [knowledge-base/self-assessment-plain-english.md](knowledge-base/self-assessment-plain-english.md)
Reference: [AGENTS.md](AGENTS.md)

---

## Phase 3 direction

Phase 3 can make the invoice product competitive with lightweight sole-trader
tools without turning VibeCount into a full studio operating system.

- [x] Branded invoice and quote templates: logo, colours, footer copy, payment terms
- [x] Quote creation, quote status, and quote-to-invoice conversion
- [x] Saved services / line items that can flow into quotes and invoices
- [x] Payment links on invoices, starting with Stripe Checkout or an equivalent hosted flow
- [x] Repeating invoice templates that create drafts on a schedule
- [x] User-approved invoice sending and automated payment follow-up reminders
      Verification: sendApprovedReminder server action calls Resend and marks
      status='sent'; discardReminderDraft deletes the pending row. Dashboard
      now always shows pending reminder drafts with Send/Discard buttons.
      npm run lint, npm test, npm run build pass.
- [x] Shared document data model so future proposals/contracts can inherit client,
      service, scope, price, and payment terms without copy-paste

First Phase 3 task:

- [x] **Quotes and reusable services** — add saved services / line items, branded
      quote PDFs, and quote-to-invoice conversion. This is the smallest useful step
      towards smart documents.

Reference: [knowledge-base/freelancer-operating-system.md](knowledge-base/freelancer-operating-system.md)

---

## Phase 4 direction

Phase 4 can add an agentic tax copilot and selected freelancer operating system
features once the records, import, tax-prep, payments, and document foundations
are stable. The Creators Base-style feature set belongs here, not in Phase 2.

- [ ] Browser-agent login with short-lived scoped sessions
- [ ] External-agent access model where users bring their own agent/provider
      tokens; VibeCount does not store BYO provider keys in the first version
- [ ] MCP/tool layer only after Phase 2/3 review gates are verified; no MCP work
      should be merged into the current hardening branch
- [ ] Read-only review agent for missing receipts, uncategorised transactions,
      overdue reviews, and likely invoice/payment matches
- [x] Draft-action agent for suggested categories, Self Assessment prep answers,
      and accountant questions
      Verification: GET /api/records/suggest-category calls Claude with record
      description + user's own category list; SuggestCategoryButton shows
      inline on uncategorised records; applyRecordCategory server action writes
      category_id only after explicit Accept. npm run lint, npm test, npm run
      build pass. Self Assessment prep answers and accountant questions remain
      as future iterations of this agent.
- [ ] Approval-action agent that writes only after explicit user confirmation
- [ ] Scheduled quarterly readiness checks with audit logs
- [ ] Proposals that inherit client, service, price, scope, and timeline data
- [ ] Contracts generated from approved proposal data
- [ ] E-signatures via a specialist provider rather than a home-grown signature system
- [ ] Lightweight project / scope tracking only where it improves invoicing, payment,
      or tax records

First Phase 4 task:

- [x] **Read-only review agent** — inspect approved records and explain what needs
      attention without writing to the database or triggering external actions.
      Verification: /dashboard/review page reads approved financial_records and
      sent invoices, passes sanitised summary (no bank details) to
      /api/review/suggest which calls Claude. Client component shows findings
      with explicit read-only caveat. npm run lint, npm test, npm run build pass.
- [x] **Parked MCP acceptance criteria** — future tools such as `get_pl_summary`,
      `list_expenses`, and `finalise_invoice` must require scoped auth, audit
      logging, ownership checks, idempotency, valid status transitions, and
      explicit human confirmation before any write-like action.
      Reference: knowledge-base/mcp-acceptance-criteria.md

Reference: [knowledge-base/agentic-tax-copilot.md](knowledge-base/agentic-tax-copilot.md)

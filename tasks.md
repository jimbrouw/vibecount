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
- `[FOUNDER DECISION — recommended default]` **Client = saved entity, zero-friction
  inline create.** On invoice creation, match the spoken/typed name to an existing
  client; if no match, create one inline from just the name. No separate "add client"
  flow. Confirm this before Task 2, or tell me to switch to plain freetext.

## Data model (4 nouns — keep it minimal)

- **User** — auth + accessibility prefs.
- **Client** — id, user_id, name. (Per decision above.)
- **Invoice** — id, user_id, client_id, number, date, description, amount,
  payment_terms, status (draft / finalised), pdf_path.
- **GlossaryTerm** — id, term, explanation, example. Static seed data.

---

## Tasks

### Task 0 — Skeleton live
- [ ] Next.js app, Supabase project, deploy to Vercel. A "hello world" page live on a URL.
- [ ] Env vars wired (Supabase keys, Anthropic key server-side only, PostHog).
- **Done when:** the empty app loads on its Vercel URL.

### Task 1 — Auth
- [ ] Supabase Auth: sign up + log in + log out.
- **Done when:** a user can create an account and reach a logged-in empty dashboard.

### Task 2 — Schema
- [ ] Migrations for the 4 tables above. Row-level security so users only see their own data.
- [ ] Seed `GlossaryTerm` table (placeholder rows for now; real content in the parallel track).
- **Done when:** tables exist, RLS on, you can insert/read a test invoice.

### Task 3 — THE SPINE (typed invoice → PDF) ← build this before voice
- [ ] Typed invoice form: client (inline create), date, description, amount, payment terms.
      Invoice number auto-generated.
- [ ] Preview screen — all fields editable.
- [ ] Amount shown in **figures and words** (£8,500 + "eight thousand five hundred pounds")
      with **number chunking** (commas). This is core, not polish.
- [ ] Human confirm → generate server-side PDF → download. Optional: copy email text.
- [ ] No auto-send, no payment tracking, no reminders. User sends it themselves.
- **Done when:** a user types an invoice and downloads a correct, professional PDF.
- **Why first:** proves data model → invoice → PDF end to end with zero AI risk.

### Task 4 — Explain Simply (static glossary UI)
- [ ] Load glossary from static JSON / seeded table. No live LLM.
- [ ] Display rule: official wording → simple explanation → example. Official wording
      always visible, never replaced.
- [ ] Tap-to-expand on any term in the app.
- **Done when:** tapping a tax term shows its plain-English explanation beside the official one.

### Task 5 — Accessibility layer
- [ ] Large-text mode, spacing controls, plain-language toggle.
- [ ] Read-aloud (Web Speech API) for amounts and the invoice summary.
- [ ] Confirm figures+words+chunking from Task 3 are applied everywhere money appears.
- **Done when:** the accessibility toggles work and money is always shown figures + words.

### Task 6 — Voice path (uses validated prompt) + Whisper sub-gate
- [ ] **Whisper sub-gate first:** record the founder saying ~20 real invoice amounts
      (accents, pounds+pence, "eight fifty", "a ton"), run audio → Whisper → the v2
      extraction. If Whisper mangles numbers badly, keep voice behind typing and stop here.
- [ ] Mic capture → Whisper → validated extraction prompt → draft.
- [ ] **Mandatory read-back** (figures + words + spoken). Cannot be skipped.
- [ ] If `amount_ambiguous` is true → **hard-stop**: show the candidates and make the
      user pick/confirm. Never auto-trust an ambiguous amount.
- [ ] Confirmed draft flows into the SAME preview/PDF flow from Task 3.
- **Done when:** a user can speak an invoice, the ambiguous ones force a choice, and the
      result lands in the existing preview/PDF flow.

### Task 7 — Tone, metrics, polish
- [ ] Apply the tone rules from the spec across all copy.
- [ ] PostHog events (track-only, no targets): voice attempts, draft completion,
      PDFs generated, glossary opens, failed voice attempts, manual-entry usage.
- [ ] Visual polish to the British-utility direction (green / cream / foil green).

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

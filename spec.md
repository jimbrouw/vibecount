# /specs/002-vibecount-mvp/spec.md

# VibeCount MVP — Spec for Claude Code

Version: 4.0
Status: Ready to build (gated — see Section 0)
Build window: 14–21 days
Framework: spec-kit structure + GSD operating posture

---

## How to read this document (agent instructions)

You are Claude Code building this product. Read this whole file before writing
any code.

Rules of engagement:

- Do NOT start the full build until the Validation Gate (Section 0) passes.
- Build only what is in MVP Scope. If a task is in the NO list, do not build it.
- When a decision is marked `[FOUNDER DECISION]`, do not guess — stop and ask.
- When something is marked `[Inference]` / `[Unverified]`, treat it as a working
  assumption, not a fact. Flag it if your implementation depends on it being true.
- Spec-kit flow: this is `spec.md` (what + why). After the gate passes, generate
  `plan.md` (how) and `tasks.md` (ordered work) before implementing.

GSD posture (applies to every task):

- Ship the smallest correct thing. Iterate on real output.
- No abstraction you do not need today.
- One clear next action at all times. No theory.
- If automation reduces user understanding, remove it (Principle 5).

---

## 0. VALIDATION GATE — run this before the full build

Nothing in the full build starts until this gate is run and a result is recorded.

This is the single highest-risk assumption in the product: that spoken money
amounts can be turned into the correct number reliably enough to make voice the
hero input.

### What to test

Test the FULL pipeline, not just transcription:

`spoken audio → Whisper transcription → structured extraction → final number`

[Unverified] Whisper produces text ("eight fifty"), not formatted money
(£8.50 vs £850 vs £8,500). The dangerous step is extraction, not transcription.
A test that only checks "did Whisper hear the words" will pass and still ship the
£8,500 bug. Test end-to-end to the extracted number.

### Test set (minimum 20 phrases)

Cover: fast speech, quiet speech, at least 2 regional UK accents, whole pounds,
pounds and pence, decimals, thousands.

Each test row = spoken phrase → expected extracted fields.

Example rows:

| Spoken phrase | Expected amount | Expected client | Expected description |
|---|---|---|---|
| "Invoice Simon eight hundred and fifty pounds for projection mapping" | 850.00 | Simon | projection mapping |
| "Invoice Becca eight pounds fifty for parking" | 8.50 | Becca | parking |
| "Invoice the museum eight and a half thousand for the install" | 8500.00 | the museum | install |
| "Invoice Jade twelve forty nine ninety five for consultancy" | 1249.95 | Jade | consultancy |
| "Invoice Sahjan two grand for filming" | 2000.00 | Sahjan | filming |

Build out to 20. Include the deliberately ambiguous ones ("eight fifty",
"two grand", "twelve forty nine ninety five") — those are where it breaks.

### Pass/fail bar — judge on the AMOUNT field only

The amount is the only field where a wrong answer is dangerous. A wrong client
name or scruffy description is a shrug; a wrong amount is a real-world problem
for a user who cannot eyeball the error. So the gate is judged on amount accuracy.

[Speculation] These thresholds are judgement calls, not validated numbers —
founder sets the final line. Recommended starting bars:

- **Amount correct ≥ ~90%** → voice is the hero. Build voice-first as specced.
- **Amount correct ~70–90%** → voice ships, but typing is co-equal, and the
  amount field always forces explicit re-confirmation (never auto-trusted).
- **Amount correct < ~70%** → voice becomes a secondary/beta feature for v1.
  Typing is the hero. This is still a fine product — you just ship the typing app
  and treat voice as a fast-follow.

### Gate output

Record one line in the repo: `validation-result.md` →
"Amount accuracy: X/20. Decision: voice-hero / co-equal / typing-hero."

Then, and only then, proceed to `plan.md`.

---

## 1. Product Vision

VibeCount helps freelancers understand their finances without needing to
understand accounting.

Existing finance software assumes users already understand accounting terms,
spreadsheets, bookkeeping, and tax workflows. Many freelancers do not —
especially dyslexic users, dyscalculic users, creatives, sole traders, and
people who feel overwhelmed by finance admin.

VibeCount reduces confusion. AI helps people understand. It does not replace
understanding, and it does not make decisions for them.

One sentence: *VibeCount helps freelancers understand finances without needing
to understand accounting.*

---

## 2. Positioning

- Primary: Finance software that helps you understand.
- Alt: Finance software for people who hate finance software.
- Alt: Quotes. Invoices. Tax language. Built for freelancers.

---

## 3. Product Principles (the constitution — these win every argument)

1. AI drafts. Humans confirm. AI never commits.
2. AI explains beside official wording. AI never replaces official wording.
3. Accessibility is a product feature, not compliance.
4. Reduce cognitive load, not functionality.
5. Accessibility beats automation. If automation reduces understanding, remove
   it. If it improves understanding, keep it.

If any implementation choice conflicts with a principle, the principle wins.

---

## 4. Target Users

Primary: freelancers — artists, AV freelancers, designers, photographers,
consultants, creative technologists, sole traders.

Secondary: anyone overwhelmed by accounting software.

User voice (the feeling to design against):

- "I don't know what half these tax terms mean."
- "I avoid finance because I'm scared of mistakes."
- "I still use spreadsheets because accounting software feels harder."
- "I open tax software and feel stupid."
- "I don't trust myself with numbers."

---

## 5. MVP Scope

Ship exactly two features:

1. Structured Invoice Creation (voice-first, never voice-only)
2. Explain Simply glossary (static, curated, accountant-reviewed)

### NO list — do not build any of these in v1

- bookkeeping
- accounting automation
- banking integrations
- expense OCR
- tax filing
- CRM
- spreadsheet migration
- AI finance checking / "unusual number detection"
- payment chasing / reminders
- automated invoice sending / delivery tracking
- LLM-generated glossary content

If you think you need one of these, you are wrong for v1. Note it for Phase 2.

---

## 6. Data Model (minimal — four nouns)

[Inference] Kept deliberately small for a 21-day build. Do not add tables you
do not need for the two hero features.

- **User** — the freelancer (auth, settings, accessibility prefs).
- **Client** — see decision below.
- **Invoice** — number, client ref, date, line items (description + amount),
  payment terms, status (draft / finalised), pdf ref.
- **GlossaryTerm** — official term, simple explanation, example. Static seed data,
  not user-created.

### `[FOUNDER DECISION — recommended default applied]` Client: saved entity, zero-friction create

Recommendation (build this unless you say otherwise): **Client is a lightweight
saved entity, created inline with no friction.**

- On invoice creation, voice/typed input gives a name ("Simon").
- System tries to match an existing client by name.
- If matched → link to it (this is what makes repeat invoicing fast later).
- If no match → create a new client inline from just the name. No separate
  "add client" flow, no required fields beyond the name.

Why this over freetext-string: it costs almost nothing now, makes the voice
extraction smarter ("Simon" → known client), and avoids a painful migration in
Phase 2 when repeat clients matter. Why not full CRM: that's in the NO list.

This decision affects the schema and the extraction step — confirm before build.

---

## 7. HERO FEATURE 1 — Structured Invoice Creation

Goal: remove invoice admin friction. Not own the user's workflow — they keep
sending invoices however they do now. VibeCount just kills the admin.

Input methods: **Voice first. Never voice only.** Typing is a first-class path
that lands in the exact same draft/confirm flow. A voice failure must never be a
dead end.

### Flow

1. User presses microphone (or chooses to type).
2. User says: "Invoice Simon £850 for projection mapping consultation."
3. Speech transcription (Whisper).
4. Structured extraction → Client / Amount / Description.
5. **Accessibility verification (mandatory):**
   - Show the amount as figures: `£850`
   - AND in words: `Eight hundred and fifty pounds`
   - Optional read-aloud: app speaks the full invoice back.
   - **Read-back cannot be skipped.** This is the safety gate, not the
     confidence colour.
6. Invoice preview — editable. Fields: invoice number, client, date, amount,
   service description, payment terms.
7. Generate PDF → user downloads. Optional: copy email text. User sends it
   themselves. No automated sending, no payment processing, no reminders.

### Invoice Safety Rules

- Confidence colours: Green (high) / Yellow (review suggested) / Red (uncertain).
- Confidence colours NEVER replace human verification.
- The amount field always requires human review.
- Read-back is mandatory and cannot be skipped.
- Hierarchy, explicit: **read-back is the gate; colour is only a hint.** A green
  badge on a misheard number must not create false reassurance.

[Unverified] ASR/extraction confidence does not reliably track correctness on
spoken money. Do not let any confidence signal short-circuit the read-back.

### PDF generation

Server-side PDF generation. Library choice deliberately left open — pick at
implementation time, do not over-spec now.

---

## 8. HERO FEATURE 2 — Explain Simply

Goal: reduce finance confusion by translating jargon into plain English.

### Architecture (v1)

- **No live LLM generation.** Glossary content is static, human-written,
  accountant-reviewed JSON.
- This removes the model-generated-error path from this feature entirely — the
  content is authored and checked by humans, not produced at runtime.

### Display rules

For every term, always show in this order:

1. Official wording (always visible — never hidden, never replaced)
2. Simple explanation
3. Real example

Explain *beside* the source wording. Never substitute for it.

### Seed examples

- **Turnover** → Total money your business received before costs.
  *Example: you invoiced £20,000. Your turnover is £20,000.*
- **Accounts payable** → Bills your business needs to pay.
- **Capital allowances** → Tax relief for some business equipment purchases.
  *Example: buying a work laptop may reduce your tax.*

### Glossary build plan (has an external dependency — front-load it)

- Founder writes the 20–30 term glossary.
- An accountant reviews it for correctness before launch.
- Feature does not launch until the review is done.
- Build this as the FIRST task (it's static JSON with zero code dependencies and
  the only deliverable needing an outside human), in parallel with the voice
  plumbing.

[Unverified] A wrong-but-confident human-written explanation is still a
liability. The accountant review is what makes "trustworthy" true, not the fact
that a human wrote it.

---

## 9. Accessibility Requirements

Support dyslexia, dyscalculia, and finance anxiety as first-class needs.

- large text mode
- spacing controls
- plain language mode
- reduced jargon
- read-aloud support
- number chunking — e.g. `£8,500` not `£8500`
- amounts shown in both figures and words (see invoice flow)

---

## 10. Tone Rules

- Avoid "Validation failure" → use "Something looks unusual. Let's check it."
- Avoid "Reconciliation error" → use "These numbers do not match yet."
- Avoid "Accounts payable" → use "Bills you need to pay."

Banned words in UI copy (overclaiming): "guarantee", "ensure", "will never",
"safe to spend", "prevents", "eliminates". Never present a confident figure built
from uncertain inputs.

---

## 11. Success Metrics

Track only. No target percentages yet — gather baseline data first.

- voice invoice attempts
- invoice draft completion
- PDF invoices generated
- glossary terms opened
- failed voice attempts
- manual (typed) entry usage

[Inference] On a 21-day MVP with few users, threshold targets would be noise.
The validation gate (Section 0) is the only hard number that matters pre-launch.

---

## 12. Design Direction

Feeling: British utility software. Not fintech startup, not accountant software,
not crypto.

Keywords: calm, trustworthy, understandable, understated, human.

Palette: primary British green, secondary warm cream, accent foil green.

---

## 13. Technical Stack

- Frontend: Next.js
- Backend: Supabase (Auth + Postgres + Storage)
- Speech: Whisper
- Extraction: single LLM provider only. No abstraction layer, no routing. Pick
  one, hardcode it, ship. Abstraction is a Phase 2 problem once you know which
  model extracts amounts best.
- PDF: server-side generation (library TBD at build time)
- Hosting: Vercel
- Analytics: PostHog

---

## 14. Build Order (for tasks.md)

Front-load dependencies and de-risk the unknown first.

1. **Validation Gate** (Section 0) — must pass before anything below.
2. **Glossary JSON** — write + send for accountant review (runs in parallel).
3. Auth + data model (User, Client, Invoice, GlossaryTerm) + saved-client
   decision confirmed.
4. Typed invoice path → preview → PDF. (Prove the spine without voice.)
5. Explain Simply glossary UI (static JSON → display rules).
6. Voice path → transcription → extraction → into the same draft/confirm flow.
7. Accessibility layer (text size, spacing, chunking, read-aloud, words+figures).
8. Polish, tone pass, analytics events.

Definition of done for v1: a freelancer can create an invoice by voice OR typing,
verify it via mandatory read-back, download a correct PDF, and tap any tax term
to see a plain-English, accountant-checked explanation beside the official wording.

---

## 15. Phase 2+ (do not build now)

- Phase 2: spreadsheet import, bookkeeping assistance, AI finance guidance,
  expense categorisation.
- Phase 3: quarterly tax understanding (MTD-aware).
- Phase 4: freelancer operating system.

[Unverified] Making Tax Digital timelines are a likely demand driver for Phase 3
— confirm current dates at gov.uk before betting roadmap on them.

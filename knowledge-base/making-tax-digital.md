# Making Tax Digital for Income Tax

Last reviewed: 27 May 2026

This note captures the current HMRC direction for Making Tax Digital (MTD) for
Income Tax and how it should affect the VibeCount roadmap.

## Why this matters

VibeCount started as a lighter invoicing product for freelancers who find
finance admin hard to manage. MTD changes the shape of the problem. If the
product is going to stay relevant for UK sole traders, it cannot stop at PDF
invoices and glossary help. It needs a clean path from digital records to
quarterly reporting.

## Current HMRC position

Based on HMRC guidance reviewed on 27 May 2026:

- MTD for Income Tax applies from **6 April 2026** for people with qualifying
  income over **GBP50,000** from self-employment and property.
- The threshold falls to over **GBP30,000** from **April 2027**.
- The threshold falls again to over **GBP20,000** from **April 2028**.
- Qualifying income is turnover from self-employment and property income before
  expenses, based on the prior tax return.
- Users must keep **digital records** and use **MTD-compatible software** to
  send **quarterly updates**.
- Quarterly updates are summaries of income and expenses, not full tax returns.
- After the final quarterly update, users may need to make adjustments and then
  complete their **final declaration / tax return**.
- HMRC guidance and regulations use the term **functional compatible software**.
- HMRC requires data to move through digital systems without manual re-typing as
  part of the compliant flow.

## What this means for VibeCount

VibeCount should treat MTD as a roadmap driver, but not try to become a full
filing product inside Phase 1.

The product should move in two stages:

1. **Phase 2: MTD-ready records and routines**
2. **Later phase: direct HMRC submission and compliance workflows**

That split matters. The first step is operationally useful and much safer to
build. The second step is a regulated integration surface and should only be
started once the records model and user workflow are stable.

## Phase 2 scope change

Phase 2 should include **MTD preparation**, not just generic bookkeeping help.

Recommended Phase 2 themes:

- digital record-keeping for income and expenses
- spreadsheet, CSV, or bank statement import into structured records
- categorisation workflows that reduce manual bookkeeping
- tax-year and quarter views
- threshold tracking against MTD entry points
- quarterly habit prompts and deadline awareness
- simple running tax estimates
- audit-friendly edit history for record changes

## Not Phase 2 yet

These should stay out of immediate Phase 2 unless HMRC integration becomes the
explicit goal:

- direct HMRC API submission
- Functional Compatible certification/compliance claims
- end-to-end final declaration filing
- penalty appeal tooling
- broad accounting-suite behaviour

## Recommended first task for Phase 2

Start with a foundation task, not a filing task:

### Phase 2 Task 1 — Digital records foundation

Build a proper record model for:

- income records
- expense records
- categories
- source imports
- quarter boundaries
- immutable timestamps / change history

Done when:

- a freelancer can add or import income and expenses digitally
- records are grouped by tax year and quarter
- the app can show a basic quarterly summary of business income and expenses
- threshold tracking can show when the user is approaching MTD scope

## Bank statement import

Bank statement PDF import is a strong Phase 2 follow-on once the digital records
model exists. It should use a redaction-first flow so raw statements are processed
temporarily, account-level personal data is removed, and only reviewed structured
records are stored.

See `knowledge-base/bank-statement-import.md`.

## Self Assessment prep layer

The same records can also support a plain-English Self Assessment preparation
workflow. VibeCount should start by mapping SA103S / SA103F self-employment
questions to invoices, bank imports, receipts, and approved records, then export
a review pack for the user or accountant.

See `knowledge-base/self-assessment-plain-english.md`.

## Product guidance for dyslexic users

MTD increases reporting frequency, which increases user stress. VibeCount should
respond by reducing cognitive load:

- plain language before tax jargon
- recurring prompts tied to quarters, not dense dashboards
- clear progress states for "recorded", "ready to review", and "ready to submit"
- early threshold warnings
- figures and words where money is safety-critical

## Source links

- HMRC MTD for Income Tax overview:
  https://www.gov.uk/guidance/use-making-tax-digital-for-income-tax/introduction
- HMRC quarterly update direction:
  https://www.gov.uk/government/publications/update-notice-for-making-tax-digital-for-income-tax
- HMRC quarterly updates guidance:
  https://www.gov.uk/guidance/use-making-tax-digital-for-income-tax/send-quarterly-updates
- HMRC final declaration guidance:
  https://www.gov.uk/guidance/use-making-tax-digital-for-income-tax/finalise-your-income-tax-position
- HMRC digital records guidance:
  https://www.gov.uk/guidance/use-making-tax-digital-for-income-tax/create-digital-records

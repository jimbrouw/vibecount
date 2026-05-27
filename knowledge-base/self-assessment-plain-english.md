# Self Assessment Plain-English Workflow

Last reviewed: 27 May 2026

This note captures a Phase 2/3 idea for helping sole traders understand and
prepare the HMRC Self Assessment questions in dyslexia-friendly language.

## Product idea

VibeCount should build a plain-English layer over the sole trader Self Assessment
workflow. The app should explain each HMRC question in simple language, show what
data VibeCount already has, and make clear what the user still needs to answer.

This should start as **preparation and review**, not direct filing.

## Relevant HMRC forms

For a sole trader, the main forms are:

- **SA100**: the main Self Assessment tax return.
- **SA103S**: short self-employment pages for simpler sole trader businesses,
  usually where turnover is below the VAT threshold.
- **SA103F**: full self-employment pages for more complex self-employment or
  turnover above the VAT threshold.
- Other supplementary pages may apply if the user has property income,
  employment, dividends, capital gains, student loans, pensions, or other income.

The first VibeCount target should be **SA103S / SA103F self-employment prep**,
because it maps most closely to invoices, expenses, receipts, and bank records.
The wider SA100 should be handled later as a checklist, not as an automatic tax
filing product.

## Plain-English mapping concept

For each HMRC box or question, store:

- official HMRC label
- plain-English explanation
- why HMRC asks it
- data source VibeCount can use
- whether the value can be auto-filled, suggested, or must be user-entered
- warning notes for accountant review

Example:

```json
{
  "form": "SA103S",
  "box": "Turnover",
  "official_label": "Your turnover",
  "plain_english": "The total money your business made before taking off costs.",
  "data_source": "finalised invoices + approved bank income records",
  "fill_mode": "suggested",
  "review_note": "Check cash payments, marketplace income, and unpaid invoices depending on accounting method."
}
```

## What VibeCount data can help answer

If Phase 2 has invoices, bank statement imports, receipt OCR, and approved
records, VibeCount can help prepare:

- turnover / business income
- other business income
- expense categories
- bank fees
- software and subscriptions
- travel
- equipment and tools
- subcontractor costs
- phone and internet
- office costs
- mileage or vehicle records if captured
- profit and loss summary
- quarterly summaries for MTD-readiness

## What VibeCount should not auto-answer

These need explicit user input, accountant review, or a later regulated workflow:

- personal income outside the business
- employment income
- dividends and savings interest
- pension contributions
- student loan details
- benefits
- capital gains
- property income
- losses carried forward
- capital allowances where judgement is needed
- final tax calculation and filing

## Workflow shape

Recommended workflow:

1. User imports or records the year of income and expenses.
2. VibeCount creates a profit-and-loss summary.
3. VibeCount shows a plain-English Self Assessment checklist.
4. Each line shows:
   - official HMRC wording
   - plain-English meaning
   - VibeCount suggested answer
   - evidence behind the answer
   - confidence / needs-review status
5. User approves, edits, or marks unsure.
6. Export a tax prep pack for the user or accountant.

## Export-first, filing-later

The first version should export:

- CSV profit-and-loss summary
- category totals
- transaction detail CSV
- receipt evidence list
- plain-English checklist
- accountant review PDF

Direct submission to HMRC, Xero, QuickBooks, or FreeAgent should be later.

## Xero / QuickBooks question

This could be:

- a standalone VibeCount feature for freelancers who do not want full accounting
  software
- an export workflow for accountants or accounting software
- a future plugin / integration into Xero, QuickBooks, or FreeAgent

Recommended path:

1. Build VibeCount as the **plain-English prep layer** first.
2. Export clean CSV/PDF packs.
3. Add accounting software integrations only after the data model is proven.
4. Add HMRC submission only after MTD-compatible records and compliance work are
   properly designed.

## Phase placement

### Phase 2

- Build digital records foundation.
- Add bank statement / receipt import.
- Add profit-and-loss summaries.
- Start mapping SA103S / SA103F fields to VibeCount records.
- Build a plain-English tax prep checklist.
- Export a tax prep pack.

### Phase 3

- Deeper Self Assessment workflow.
- Accountant review collaboration.
- Optional Xero / QuickBooks / FreeAgent export or plugin.
- Direct HMRC-facing MTD workflows only if compliance scope is explicit.

## Sources

- SA100 main tax return:
  https://www.gov.uk/government/publications/self-assessment-tax-return-sa100
- SA103S self-employment short:
  https://www.gov.uk/government/publications/self-assessment-self-employment-short-sa103s
- SA103F self-employment full:
  https://www.gov.uk/government/publications/self-assessment-self-employment-full-sa103f
- HMRC help with self-employment:
  https://www.gov.uk/guidance/help-with-self-employment-on-your-self-assessment-tax-return

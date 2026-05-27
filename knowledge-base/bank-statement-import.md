# Bank Statement Import and Redaction

Last reviewed: 27 May 2026

This note captures a Phase 2 idea for turning bank statement PDFs into expense
records and profit-and-loss summaries without storing unnecessary personal data.

## Product idea

A freelancer uploads bank statement PDFs. VibeCount extracts transaction rows,
redacts personal and account-level information, suggests expense categories, and
creates reviewable income / expense records that can feed quarterly summaries and
tax return preparation.

This is valuable for Making Tax Digital because many users already have the raw
truth in their bank statements, but need help turning that into clean digital
records.

## Privacy-first principle

The raw bank statement should not be stored by default.

Preferred flow:

1. Upload PDF.
2. Extract text / tables in a temporary processing step.
3. Redact account-level and personal information.
4. Convert transaction rows into structured records.
5. Send only the minimum redacted transaction data to the LLM for categorisation.
6. Store only the reviewed structured records, import metadata, and an audit log.

If raw PDF retention is ever needed, it should be an explicit user choice with a
separate encrypted storage design.

## Redaction boundary

Redaction should happen before:

- LLM categorisation
- database persistence
- analytics events
- logs

Data to remove or avoid storing by default:

- account number
- sort code
- IBAN
- card numbers
- home address
- statement reference numbers
- full opening / closing balances
- non-transaction boilerplate from the bank
- unrelated personal notes or messages

Data likely needed for useful categorisation:

- transaction date
- amount
- direction: money in / money out
- merchant or counterparty text, after trimming noise
- transaction reference, if needed for duplicate detection
- source bank name, if the user chooses to keep it

For duplicate detection, prefer a deterministic hash built from normalised
transaction fields instead of storing raw statement identifiers.

## Review-first workflow

The AI should not directly commit tax records.

Recommended flow:

1. Parse statement.
2. Show a redaction preview.
3. Categorise transactions into suggested buckets.
4. Ask the user to approve, edit, split, or exclude each row.
5. Commit approved rows into the digital records model.

Useful categories for early MVP:

- income
- software
- travel
- equipment
- phone / internet
- office costs
- subcontractors
- bank fees
- meals / subsistence
- personal / exclude
- needs review

## LLM usage

The LLM should receive redacted transaction rows, not full statements.

Example payload:

```json
{
  "date": "2026-05-02",
  "description": "ADOBE CREATIVE CLOUD",
  "amount_pence": -5499,
  "direction": "out"
}
```

Expected output:

```json
{
  "category": "software",
  "business_use": "likely_business",
  "confidence": "medium",
  "plain_reason": "Adobe Creative Cloud is commonly used for freelance design or media work."
}
```

The UI should avoid confidence colours that imply tax certainty. The user remains
responsible for review.

## Phase 2 task shape

This should come after the digital records foundation, because imported rows need
a proper place to land.

### Phase 2 Task 2 — Bank statement import prototype

Done when:

- user can upload a bank statement PDF
- raw PDF is processed temporarily and not stored by default
- account-level personal data is redacted before LLM or database use
- transactions are extracted into a review table
- AI category suggestions are shown as suggestions only
- approved rows become income / expense records
- rejected rows are not stored as tax records

## Risks

- PDF bank statements vary heavily by bank.
- OCR/table extraction can misread dates and amounts.
- Merchant names may contain personal information.
- Some transactions require user knowledge to classify correctly.
- Redaction failures would be high-impact, so logs and analytics must avoid raw
  statement text.

## Open technical questions

- Should extraction run in-browser first, so raw PDFs never leave the device?
- Which PDF/table extraction library handles UK bank statements best?
- Do we support CSV/OFX/QIF imports before PDFs because they are cleaner?
- How do we show redaction clearly without overwhelming dyslexic users?
- What is the minimum audit trail needed for MTD-ready records without storing
  the original statement?

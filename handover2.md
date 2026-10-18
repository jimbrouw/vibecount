# VibeCount vNext — Finance OS / Self Assessment

**Product-to-engineering handover** | 17 October 2026 | Owner: Jim | Status: specification, not implementation

## Agent mandate

Act as lead engineer on the **existing VibeCount repository**. Inspect its stack, schema, auth, deployment, tests, invoice and payment models before coding. Do not assume a framework or replace working infrastructure without justification. First deliver a repository audit, implementation plan, migrations, risks and acceptance tests. Build incrementally; do not submit tax returns or connect financial accounts without explicit approval.

## Product goal

Turn VibeCount from invoice tracking into a UK freelancer **Finance OS**: import records once, match invoices to payments, learn expense decisions, review only exceptions, calculate explainable tax estimates, and produce an HMRC-ready **draft** Self Assessment pack.

**User promise:** Know what you've earned, what you owe HMRC, and what you can safely pay yourself—without manually categorising every transaction.

Inspired by the *workflow* of guided tax services such as Taxfix; do not copy their proprietary software, content, or branding. This is not a substitute for accountant certification.

## Principles / non-negotiables

1. Every amount links to original source rows and versioned calculations.
2. Invoiced, received, taxable profit, available cash and tax reserved are distinct concepts.
3. Tax years are isolated (UK: 6 April–5 April); accounting basis is explicit.
4. AI suggests; deterministic code calculates; users approve uncertain classifications.
5. Excluded and duplicate records remain auditable, never silently deleted.
6. Merchant decisions persist but allow overrides, expiry and tax-year variation.
7. Prioritise financially material exceptions rather than hundreds of questions.
8. Sensitive bank data requires encryption, access control, minimisation and consent for third-party AI processing.

## Existing user scenario / test case

Use the **2025/26** historic reconciliation as the MVP acceptance case, not as hard-coded production defaults.

- PAYE taxable pay £14,033.52; PAYE tax withheld £1,542.60.
- Separate £10,255.25 redundancy payment: *provisionally* tax-free, subject to checking settlement evidence.
- Source material: invoice ZIP, Starling CSV, Nationwide CSV, Amex CSV, reviewed expenses CSV, P45 and redundancy payslip.
- Freelance receipts include £250 and £275 from Nottingham Artist Studios and £1,500 from Nottingham Contemporary (former employer, later freelance client). Avoid duplicate income from invoices and receipts.
- Software, Squarespace, Namecheap, professional studio membership and hire are user-confirmed business-use candidates, subject to tax eligibility.
- Personal exclusions include £463.09 holiday Airbnb, £189 Premier Inn, and £50 donation (not automatically a trading expense).
- Mixed-use examples: car 30%, e-bike 45%, AirPods 30%. Car expense method requires review; do not claim actual costs and mileage together.
- User has £43,055 in **pension savings, not accessible cash**; £6,800 personal emergency savings, £9,000 business buffer and last-reported £5,924.39 tax reserve (actual cash; tax-year allocation unresolved).
- 2026/27 forecast: £40,000 turnover, £400/month business costs, proposed £460/month pension contribution; sole trader, not VAT registered.

**Warning:** Historical partial totals (e.g. £2,539.32 manually reviewed expense tally or £9,918.18 retained outflows) are NOT final allowable deductions. Recompute from source evidence.

## Scope

### P0 — 2025/26 Self Assessment pack (MVP)

- Multi-source import and immutable original file/row preservation.
- Normalised bank/card transaction ledger with dates, amounts, descriptions and account provenance.
- Invoice/receipt matching, duplicate detection, partial payments, refunds and inter-account transfers.
- Expense review with Business / Personal / Mixed / Transfer / Refund / Unknown and business-use percentages.
- Persistent merchant classification rules, evidence attachments and manual overrides.
- Tax-year-specific rules and explainable tax calculation (Income Tax, self-employed NI, PAYE credits, pensions, payments on account).
- Guided review of unresolved issues and export of draft SA100/SA102/SA103 worksheet and audit files.

### P1 — Ongoing Finance OS

- Use VibeCount's native invoices/payments from June 2026 onwards.
- Recurring imports or optional read-only bank integrations; reconciliation alerts.
- Tax pot: actual balance vs recommended reserve vs forecast liability.
- Cash flow, personal drawings, buffer, billable-day and turnover target dashboards.
- Tax deadline reminders and annual rollover of reviewed merchant rules.

### P2 — Advanced features

- Receipt OCR/document extraction with evidence confidence.
- Accountant review and locked filing snapshots.
- Pension/ISA and retirement scenario planning.
- Evaluate HMRC Making Tax Digital for Income Tax separately. **An exported Self Assessment worksheet is not MTD compliance or HMRC filing.**

### Non-goals for MVP

No automatic HMRC submission, payment initiation, bank write access, legal/tax guarantees, or automatic claiming solely from an AI confidence score.

## Functional requirements

### FR1 — Import and normalize

Support Starling, Nationwide, Amex and generic CSV, invoice PDFs/ZIP, receipts and employment documents. Preview field mapping and date range. Preserve raw source, hash, import time, row number and normalized record. Use exact decimal/integer-pence arithmetic; validate currency, dates and sign. Defend against ZIP traversal and CSV formula injection. Reimports must be idempotent.

**Accept:** Importing the same statement twice adds zero transactions; each normalized record links to source file + row.

### FR2 — Reconcile

Match invoices and receipts using references, amounts, payer and dates. Support one-to-many, many-to-one, partial settlement, credit notes and FX. Detect same-account duplicates and inter-account transfers; card repayments are not deductible purchases. Keep unallocated receipts visible.

**Accept:** £1,500 freelance receipt from a former employer is counted once as self-employment income. A transfer from Nationwide to Starling does not increase turnover.

### FR3 — Expense decisions and memory

Classify Business, Personal, Mixed, Transfer, Refund, Unknown. Mixed requires percentage, rationale and evidence status. Persist merchant rule with scope, effective date, precedence, author and override. Suggest based on merchant, historical decisions and transaction context. Do not presume restaurant meals, everyday clothing, donations or commuting qualify merely because user says “work”.

**Confidence is a triage heuristic, NOT a probability or allowable percentage.** Suggested bands: 90–100 shortlist, 70–89 quick review, 40–69 materiality review, 0–39 defer unless large/recurring. Annualise recurring merchants. Preserve exclusions.

**Accept:** Squarespace defaults to business candidate after confirmation; a £700 unfamiliar hardware transaction still surfaces despite low confidence.

### FR4 — Tax rules engine

Version tax rules by UK tax year and jurisdiction, with sources and review date. Explicitly handle cash-basis timing, deductible expenses, private-use apportionment, capital expenditure/allowances, vehicle mileage vs actual-cost election, business travel vs commuting, donations, pension relief, PAYE credits, Income Tax, Class 4 NI and applicable Class 2 treatment. Distinguish sole-trader bicycle costs from employee bicycle mileage rules. Do not treat pension contributions as trading expenses.

All calculations deterministic, tested, explainable, and marked **estimate** until reviewed. Flag missing inputs instead of assuming zero. Include tax-year-aware payments-on-account calculations and actual payment credits.

**Accept:** £630.29 qualifying car repair payments at 30% yield £189.09 candidate actual-cost deduction, but not in addition to mileage. A personal Airbnb is excluded.

### FR5 — Guided Self Assessment

Wizard: Profile → Sources → Income → Expenses → PAYE → Redundancy/other income → Pension → Tax estimate → Exceptions → Review → Export. Pre-fill verified facts; only ask unresolved material questions. Show evidence source and calculation for every populated figure. Verify current HMRC form/box mapping for each year, including SA100, SA102, SA103S/SA103F as applicable. Require user completeness attestation.

**Accept:** No “ready to file” state while material unmatched receipts or missing tax inputs remain. Wizard can resume without repeating decisions.

### FR6 — Outputs

Produce: (1) printable draft Self Assessment worksheet, (2) normalized ledger CSV, (3) invoice-to-payment reconciliation CSV, (4) expense decision ledger, (5) unresolved exception report, (6) calculation trace and tax rule version, (7) evidence manifest with file hashes. Display **Draft — not submitted to HMRC** prominently.

### FR7 — Finance dashboard (P1)

Separate invoiced, received, outstanding, estimated profit, tax liability, tax pot *actual cash*, accessible buffers, pension assets and safe-to-draw estimate. Forecast HMRC dates and payments on account; show assumptions and cash shortfalls. Never include £43,055 pension in accessible cash.

## Logical schema (adapt to actual codebase)

- `accounts`: provider, account type, currency, masked identifier.
- `imports`: file hash, parser version, date coverage, status.
- `transactions`: original + normalized fields, source row, account, date, signed amount, type, tax year.
- `invoices`, `invoice_settlements`, `attachments`: invoice references and payment relationships.
- `classifications`: status, category, business-use %, evidence, author, timestamp.
- `merchant_rules`: pattern, scope, precedence, effective dates, suggested category.
- `tax_profiles`: jurisdiction, accounting basis, business structure, pension/loan/VAT flags.
- `tax_rulesets`: year, rates, thresholds, sources, version.
- `tax_calculations`: immutable input snapshot, output, warnings and rule version.
- `filing_packs`: export manifest, review status and approval.
- `audit_events`: append-only decisions, overrides and calculation changes.

Use integer minor units or decimal arithmetic, not binary floating-point money. Make imports reversible and calculations reproducible.

## UX

Screens: **Tax Year Overview**, **Imports**, **Reconciliation**, **Expense Review**, **Exceptions**, **Tax Calculation**, **Filing Pack**, **Rules & Memory**.

Design for short questions, keyboard-first review, bulk decisions, undo, source preview, and automatic advance to the next exception. Show **Verified / Provisional / Excluded / Unresolved** statuses. Prioritise exception queue by potential tax impact and recurring annual spend. Never ask the user to reclassify a known transaction without a reason.

## Testing and security

Unit tests: 5/6 April boundary, currency precision, duplicate imports, refunds, transfers, credit-card repayments, invoice matching, partial settlements, PAYE credits, pension relief, private-use percentages, vehicle method consistency, payments on account.

Integration tests: import source → reconcile → classify → calculate → export; source evidence remains intact. Security tests: account isolation, auth, attachment permissions, CSV injection, malicious ZIP, oversized uploads, PII redaction, data deletion/retention.

**Definition of done:** All report totals tie to ledger rows; repeated import does not change totals; exceptions are not silently claimed; tax rule version is displayed; exported draft can be independently recalculated; no automatic filing.

## Delivery milestones

**M0 — Repository audit:** Architecture map, current feature inventory, data model, dependency/security assessment, reuse plan, backlog and estimates. No premature rewrite.

**M1 — Ledger:** Imports, canonical schema, source hashes, dedupe and tests.

**M2 — Reconciliation:** Invoice matches, transfers, refunds, partial payments and exception queue.

**M3 — Expense review:** Merchant rules, business-use %, evidence, bulk review and audit history.

**M4 — Tax engine:** Versioned 2025/26 calculation, PAYE integration, payments on account, rule tests.

**M5 — Filing pack:** Guided wizard, verified box mapping, exports, end-to-end tests.

**M6 — Ongoing OS:** 2026/27 dashboard, reserves, cash flow and target planning.

Each milestone requires: working code, tests, migration notes, a demo with anonymised fixtures, and a list of remaining risks. Keep PRs small and reversible.

## First coding-agent response required

Before writing application code, deliver:

1. What already exists in the VibeCount repository and what can be reused.
2. Proposed architecture and schema changes with migration strategy.
3. Prioritised issue list for M0–M5, including dependencies and acceptance criteria.
4. Security/privacy and UK tax-compliance risks.
5. Specific questions that block implementation (only genuinely missing information).
6. The **smallest vertical slice** that can import a Starling CSV, deduplicate rows, classify a transaction and export an evidence-linked summary.

**Start with the repository audit. Do not invent current VibeCount implementation details or claim tax filing functionality exists.**

# Agentic Tax Copilot

Last reviewed: 27 May 2026

This note captures a later-stage idea for making VibeCount more agentic, inspired
by autonomous agent systems such as Hermes Agent, while keeping tax workflows
reviewable and auditable.

## Product idea

VibeCount can become an agentic tax copilot once the underlying records model is
stable. The copilot should read the user's invoices, expenses, bank imports,
receipts, settings, glossary terms, and tax-prep checklist, then help the user
understand what needs attention.

The agent should prepare and suggest. It should not silently file, submit, send,
or change final records.

## Good agent tasks

- find missing receipts
- flag uncategorised bank transactions
- suggest expense categories
- explain HMRC terms in context
- prepare quarterly review checklists
- warn when the user is approaching an MTD threshold
- draft Self Assessment prep answers from approved records
- prepare questions for an accountant
- find invoices that look unpaid
- suggest bank transaction matches for invoices
- create a "needs review" queue

## Hard boundaries

The first agentic version must not:

- submit anything to HMRC
- claim tax correctness
- auto-approve expenses
- change final records without user approval
- send invoices, reminders, or emails automatically
- move money or create payment links
- store raw bank PDFs by default
- send unredacted bank statement data to an LLM

## Workflow shape

Recommended sequence:

1. Read-only copilot: explains what it sees and what needs review.
2. Draft-action copilot: suggests categories, matches, checklist answers, and
   accountant questions.
3. Approval-action copilot: writes changes only after explicit user approval.
4. Scheduled copilot: runs periodic checks for quarters, missing records, and
   tax-prep readiness.
5. Integration copilot: works with accounting software or HMRC-facing workflows
   only after compliance boundaries are clear.

## Architecture principles

- Every agent action should produce an audit log.
- Every write should be traceable to a user approval.
- Agent prompts should receive scoped, minimal data.
- Raw bank PDFs and unredacted statement text should stay out of prompts.
- The agent should use tools for deterministic calculations instead of guessing.
- Tax-critical amounts should always show figures and words.
- The UI should distinguish "suggested", "approved", and "filed/submitted".

## Phase placement

This is **Phase 4**, not Phase 2.

Phase 2 should build the records foundation, imports, receipt capture, quarterly
summaries, and plain-English Self Assessment prep.

Phase 3 should prove integrations and HMRC-facing workflows.

Phase 4 can then add an agentic layer that coordinates those capabilities.

## First Phase 4 task

### Phase 4 Task 1 — Read-only review agent

Done when:

- the agent can inspect approved records only
- it can list missing receipts, uncategorised transactions, overdue reviews, and
  likely invoice/payment matches
- it explains each issue in plain English
- it cannot write to the database
- it creates no external side effects

This gives users value while keeping the first agent version low-risk.

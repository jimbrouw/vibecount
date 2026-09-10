# Parked MCP Acceptance Criteria

Status: Parked. Do not implement on branch `codex/phase-3-invoice-reminders`.
Target phase: Phase 4, after Phase 2/3 review gates are proven in production.

---

## What this document is

Before any MCP tool or agentic write action is added to VibeCount, it must satisfy
every criterion in this checklist. The criteria exist to protect users from silent
financial mistakes, which is especially important for dyslexic and dyscalculic users
who rely on explicit confirmation.

---

## Required criteria for every MCP tool

### 1. Scoped authentication

- Tools require a short-lived, scoped session token — not the user's main Supabase
  session.
- Tokens must carry an explicit list of allowed actions (e.g. `read:records`,
  `draft:invoice`). No catch-all tokens.
- Tokens expire after a short TTL (e.g. 15 minutes) and must be renewed by the user.
- Browser-agent login must use a dedicated flow, not the standard user login path.

### 2. Audit logging

- Every tool call — read or write — must produce an immutable audit row in a
  dedicated `agent_actions` table (or equivalent).
- Audit rows must record: tool name, user ID, timestamp, parameters (sanitised),
  result status, and whether the action required human confirmation.
- Audit rows must never be deleted by the tool itself.
- Users must be able to see their own audit log from the dashboard.

### 3. Ownership checks

- Every query and mutation must filter by `user_id = auth.uid()`.
- Row-level security must enforce this at the database layer, not only in
  application code.
- Tools must refuse to operate on resources that do not belong to the requesting
  user, returning a clear error rather than an empty result.

### 4. Idempotency

- Write-like tools (draft creation, status transitions, approvals) must be
  idempotent: calling the same tool twice with the same parameters produces the
  same outcome without duplicating records.
- Each write operation should accept an optional `idempotency_key` so callers can
  safely retry on network failure.

### 5. Valid status transitions

- Tools may only move records through documented, permitted state transitions:
  - `draft` → `review` → `approved`
  - `approved` → `excluded` (with reason)
  - No skipping states. No reverting approved records without an explicit undo
    action that also creates an audit row.
- Invoice transitions: `draft` → `finalised` → (sent | paid).
- Reminders: `pending` → `sent` | `failed` | `skipped`. Never directly to `sent`
  without an intermediate human-confirmed step.

### 6. Explicit human confirmation before any write-like action

- Tools that create, modify, or delete financial records must land in a human
  review step before committing.
- "Draft" tools may write to a staging table; the user must explicitly approve
  before staging rows become approved records.
- Confirmation must be explicit (a button press, a spoken confirmation, a
  signed token) — not inferred from inaction or timeout.
- The confirmation gate must be visible and legible: amounts in figures and words,
  client names readable, action described in plain English.

---

## Explicitly prohibited tool actions (first version)

The following actions must not exist in any MCP tool layer, regardless of
auth scope, until a dedicated safety review and product decision approves them:

- `finalise_invoice` — invoice finalisation requires the full typed/voice invoice
  flow with read-back.
- Sending emails to clients (reminders, invoices, receipts) without a pending
  draft approved by the user in the UI.
- Submitting anything to HMRC or any tax authority.
- Processing payments or initiating bank transfers.
- Changing tax-prep outputs from draft to accepted.
- Storing raw bank statement text, account numbers, or sort codes in any
  LLM-accessible context.

---

## Parked tools (acceptable in a future phase)

These tools may be built once the criteria above are met:

| Tool | Scope | Notes |
|---|---|---|
| `get_pl_summary` | read | Returns net profit by quarter. No raw records. |
| `list_expenses` | read | Returns approved expenses with category and amount. No bank details. |
| `list_uncategorised` | read | Returns records with no category assigned. |
| `draft_record` | write-draft | Creates a record in `review` status. Requires human approval. |
| `draft_invoice` | write-draft | Creates an invoice in `draft` status. Requires full review before finalisation. |

---

## Review and sign-off

Before any parked tool is implemented:

1. Product decision: confirm the tool is needed and safe for the target user group.
2. Security review: check auth scopes, RLS policies, and audit log coverage.
3. QA pass: automated tests for each valid and invalid status transition.
4. Accessibility check: confirm confirmation gates meet the read-back and plain-language standards from `spec.md`.

Reference: [AGENTS.md](../AGENTS.md), [spec.md](../spec.md),
[knowledge-base/agentic-tax-copilot.md](agentic-tax-copilot.md)

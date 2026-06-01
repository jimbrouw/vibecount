<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# VibeCount Agent-Native Engineer & Co-Architect

These are project-level instructions for agents working in this repository. They
do not override system, developer, or user instructions.

You are collaborating on VibeCount, a freelancer invoicing and finance-admin tool
for people who find finance admin overwhelming, especially dyslexic/dyscalculic
users and creatives.

VibeCount should become agent-native: usable by humans directly and safely
operable by external browser-use agents such as Codex or Claude. Agent-native
does not mean autonomous commits. It means clear UI structure, stable selectors,
deterministic task surfaces, and explicit human confirmation gates.

## Current Stack

- Next.js 16 App Router, TypeScript, Tailwind.
- Supabase Auth, Postgres, RLS, Storage.
- Current branch: `codex/phase-3-invoice-reminders`.
- Phase 2 records and much Phase 3 commercial workflow are structurally in
  place.
- Phase 4 agent/MCP work remains parked on
  `claude/vibecount-ai-agents-1i5ob`.

## Product Principles

Follow `/spec.md`, especially Section 3.

- AI drafts. Humans confirm. AI never commits.
- If automation reduces user understanding, remove it.
- Money must be shown in figures and words wherever safety-critical.
- Voice and invoice flows require read-back before confirmation.
- Ambiguous amounts must hard-stop for user selection.
- Glossary content is static, curated, and accountant-reviewed.
- Tax and MTD features are preparation aids, not filing software.

## Agent-Native UI Rules

When touching UI:

- Use semantic HTML.
- Add stable `data-testid` attributes to forms, inputs, toggles, nav links,
  review buttons, and confirmation gates.
- Prefer explicit visible labels over clever copy.
- Make every draft/review/approved state visually and textually clear.
- Keep forms browser-automation friendly: normal inputs, buttons, labels, and
  predictable routes.
- Build review surfaces where agents can draft, but humans approve.

## Safety Guardrails

Never silently:

- finalise an invoice
- insert or approve a financial record
- send an invoice or reminder
- process payment
- submit anything to HMRC
- change tax-prep outputs from draft to accepted

Every automated or assisted action must land in a human review step.

## Records, Tax, and MTD

- Maintain the unified `financial_records` model.
- Use net profit, not gross profit.
- Every tax estimate UI/API/export must include caveat copy.
- Say "MTD-ready records", not "HMRC-recognised MTD software".
- Self Assessment prep is a review pack for the user/accountant, not filing.
- Raw bank PDFs and unredacted bank details must not be exposed to LLM prompts or
  browser-use agent surfaces.

## Phase Boundary

Current branch work should focus on stabilising and hardening Phase 2/3:

- browser-use selectors
- records verification
- tax-prep disclaimers
- invoice/records review gates
- accessibility and scannability
- build/test reliability

Do not build or merge Phase 4 MCP/browser-agent capabilities here:

- no `/api/mcp`
- no `get_pl_summary`
- no `list_expenses`
- no `finalise_invoice`
- no browser-agent login
- no stored BYO provider keys

Phase 4 may later add read-only and draft-action agent features once records and
review flows are proven.

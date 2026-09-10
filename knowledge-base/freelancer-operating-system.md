# Freelancer operating system direction

This note captures the later-roadmap idea raised after reviewing The Creators
Base and adjacent freelancer tools.

## Positioning

VibeCount should not become a full freelance operating system in Phase 2.

The near-term product is narrower:

- invoices
- quotes
- expenses
- digital records
- plain-English finance and tax readiness
- accessibility-first workflows

The later opportunity is to connect these pieces so client and service data can
flow through documents without copy-paste.

## Competitive pattern

Larger freelancer platforms tend to connect:

1. client
2. service / package
3. proposal
4. contract
5. project / scope
6. invoice
7. payment
8. reminders and follow-up

The useful pattern for VibeCount is **smart document inheritance**:

`Client + Service + Scope + Price + Terms -> Quote -> Contract -> Invoice -> Payment -> Record`

That does not require building a full CRM immediately. It requires modelling
clients, services, documents, statuses, and source relationships cleanly.

## Phase 2 boundary

Do not build the freelance operating system in Phase 2.

Phase 2 should only make sure the records model does not block it later:

- clients remain first-class
- income records can link back to invoices and imports
- source imports are tracked
- documents have stable IDs and statuses
- records have audit history
- exports are accountant-friendly

## Phase 3 candidates

Phase 3 is the right place for lightweight commercial workflow features:

- branded invoice templates
- branded quote templates
- saved services / reusable line items
- quote-to-invoice conversion
- payment links
- repeating invoice drafts
- payment reminder schedules

These features strengthen the current invoice product without turning VibeCount
into a project-management suite.

## Phase 4 candidates

Phase 4 can consider broader operating-system features:

- proposal builder
- contract generation from approved proposal data
- e-signature provider integration
- project / scope tracking
- client portal
- read-only agentic review workflows
- approval-based agentic actions

E-signatures should use a specialist provider. VibeCount should not home-grow a
signature legality, identity, and audit-trail system.

## Product guardrail

VibeCount's wedge should stay:

> Finance admin for freelancers who hate finance admin.

Freelance operating system features should be added only when they strengthen
invoicing, payments, digital records, tax prep, or plain-English understanding.

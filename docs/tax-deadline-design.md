# Reviewed tax-deadline reminders

17 October 2026. M6 implementation plan, extending the Milestone 0 plan. The full handover remains active. This is a preparation workflow, with no filing, payment, bank connection or automatic external communication.

## Existing implementation and reuse

The app already has dated, immutable owner-wide finance plans. `input.plan.obligations` records remaining unpaid commitments with a stable identity, tax year, due date and nullable exact pence. `verifyPlanRevision` verifies retained provenance and calculation replay. `read_finance_plan_context` identifies the current plan; its saved pre-capture context is **not** a current freshness stamp. General calendar proposals must not infer registration, filing method, special notice dates or payment status from a tax calculation or filing pack.

Reuse `planningDate`, `londonPlanningDate`, exact pence/words, canonical snapshots, complete keyset reads, owner locks, expected ordinals and exact request recovery. Existing invoice reminders send invoice communications; tax reminders need a separate reviewed in-app surface. No new provider is needed.

## Official sources checked

HMRC currently gives the ordinary 2025/26 registration date as 5 October 2026, paper return date as 31 October 2026, online return date as 31 January 2027 and tax-code collection filing date as 30 December 2026. Late registration may produce a personal filing date; the ordinary payment date is not automatically extended. These facts establish proposals, not that a particular user must file or qualifies for tax-code collection. [Self Assessment deadlines](https://www.gov.uk/self-assessment-tax-returns/deadlines).

Payment guidance separates the prior-year balancing payment from instalments towards another year's liability. January and July payments on account depend on individual circumstances; the HMRC statement establishes actual demands. [Payments on account](https://www.gov.uk/understand-self-assessment-bill/payments-on-account). Payment arrival timing depends on method and weekends/bank holidays; keep the statutory date and a separate user-selected reminder lead time rather than silently shift the due date. [Paying Self Assessment](https://www.gov.uk/pay-self-assessment-tax-bill).

The initial engineering rules support 2025/26 and 2026/27. The latter uses the general recurrence as a labelled planning proposal, not independently verified personal dates. Rules retain source URLs, review date and an engineering re-review boundary. Beyond that boundary, active reminders are withheld until a new reviewed rules version is installed; historical snapshots still replay with their retained evaluation date. Independent tax review remains pending.

## Workflow and model

1. Select a tax year. Generate distinct registration, paper filing, online filing, tax-code filing, balancing payment and first/second payment-on-account proposals. For liability year Y/Y+1, its POA dates fall in January/July Y+1; its balancing date is January Y+2. Do not use a forecast's following-year POA as an assessed current-year demand.
2. Add selected-year tax commitments from the latest verified finance revision. Retain their exact ID/date/nullable amount and plan ID/as-of date/hashes; future-dated sources cannot activate current commitment reminders. Unknown-year commitments remain a visible unresolved count, never assigned to a year automatically. Generic payment proposals carry **no amount**. Potential calendar/commitment overlap is disclosed; reminder amounts are never summed into a new liability.
3. Every item starts with applicability unknown, open disposition and an unreviewed date basis. User choices are applies/not applicable, ordinary date or personal notice date, lead days and acknowledgement. Personal notice dates require an owned document hash. A saved commitment's date/amount can only be changed through a new cash-plan review.
4. Evaluate on a validated London date. Distinguish unreviewed, date review needed, scheduled, reminder active, due today, past due, acknowledged, not applicable and rules needing re-review. Acknowledged means this reminder was handled; it establishes neither payment nor submission. Unknown amount is not zero; zero does not automatically acknowledge a task.
5. Save one immutable owner/year revision after explicit figures/words read-back and reason. Input edits or refreshed sources reset confirmation. A changed cash plan makes the old current payment reminder stale; history remains readable and must not silently refresh its amount/date or acknowledgement.
6. Show in-app reminders and safe immutable JSON history/export. An external calendar/email channel would require separately reviewed content and delivery behavior; it is not implicitly enabled by this work.

## Persistence and delivery sequence

First deliver the pure proposal/validation/evaluation engine and canonical safe source snapshots with synthetic demos and meaningful boundary tests. Next add `tax_deadline_rulesets` and immutable `tax_deadline_revisions`, source plan owner-composite FK, owner/year ordinal and owner/request uniqueness, retained canonical rules/input/result bytes and hashes, author/reason/time, and export provenance. No mutable financial record is created.

Use service-only capture after authenticated server recomputation. Under the existing owner reconciliation lock, recover exact completed requests before mutable reads, then compare expected ordinal and the latest finance revision identity/hash. Independently reconstruct source commitments and owned document metadata before atomic capture. Private explicit-owner helpers remain uncallable by authenticated/service roles. New plan saves and deadline saves must use the same owner lock; no new reconciliation stamp wrapper is needed for reminder-only history, which affects no financial calculation. If that changes, review the explicit-owner tax stamp clones too.

Then add `/dashboard/finance/deadlines`, navigation/current reminders, human confirmation, immutable history and audited private/no-store export. Preserve all prior code and migration order; apply nothing to production without linked-state/recovery rehearsal.

## Acceptance and verification

- Exact 2025/26 dates; 2026/27 general proposals labelled; POA liability years distinct from calculation-source years; unsupported years reject.
- Date-only day arithmetic across leap years/DST and London 5/6 April midnight; due-today remains due for the whole day. Weekend payment guidance does not rewrite statutory dates.
- Unknown applicability/date/amount never becomes approval or zero. No forecast/reserve becomes a demand or payment credit; zero remains zero.
- Owned notice evidence only, strict field/identity closure, duplicate/missing/foreign item rejection, no raw paths/keys/account details in exported snapshots.
- Same retained inputs/rules/date reproduce exact results. Recomputed hashes cannot legitimise altered source/result bytes; unsupported versions fail closed.
- Auth/owner isolation, direct-write denial, stale source, exact retries after later revisions, changed retry rejection, all-or-none audit and injected rollback. Independent PostgreSQL connections prove deadline/finance saves in both orders.
- Browser checks cover labels/selectors, full read-back, unknown versus zero, acknowledgement meaning, date evidence, source staleness and confirmation reset. Anonymous runtime denial is separate from hosted authenticated acceptance.

The model, guarded persistence and local in-app review/currentness/history/export workflow are now implemented; see [tax-deadlines.md](tax-deadlines.md). Full M6 and hosted acceptance remain unfinished. Hosted auth/Storage, independent tax/form review and earlier handover gaps remain separate work.

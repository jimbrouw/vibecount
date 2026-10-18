# Durable reminder delivery

## Scope and reuse

The existing reminder scheduler, email builder, invoice balance view, Resend adapter and dashboard review forms are retained. The provider call previously happened before a durable attempt, ignored outcome-write errors, and treated ambiguous transport failure as a failed send. Scheduling and draft insertion were separate writes. This change closes those local boundaries without sending any real email.

## State and migration

Migration `20261020030000_reminder_delivery_attempts.sql` adds the reviewed sender to drafts, `sending`/`unknown` states, immutable send attempts and immutable initial outcomes. It revokes direct authenticated draft mutations; service-only RPCs create a due draft, claim a send and record its result. The server action derives the owner from its authenticated session. An authenticated discard RPC retains the draft as skipped.

Draft insertion and schedule disabling are one transaction. The claim uses the reconciliation owner lock and invoice row lock, checks native GBP origin, current balance/version, recipient and the displayed draft version, then snapshots the message before transport. Only a newly created claim may invoke the provider. Repeat submissions never invoke transport, including after a crash. The existing provider idempotency key is an additional defence; correctness does not assume a provider retention window.

A provider message ID records acceptance, not inbox delivery. Throws, error responses and missing IDs conservatively become unknown. If the outcome write fails, the durable sending state remains. Neither state has a Send button. The next scheduled draft is enabled only after persisted acceptance and only if the invoice version still matches the confirmed version; a stop or balance change during transport is preserved. Maximum reminder count is checked in SQL as well as the scheduler.

Existing pending drafts have no reviewed sender and cannot send. The dashboard asks the owner to discard and schedule a fresh draft. Existing failed rows are treated as unresolved because historical errors do not prove provider rejection. They cannot be automatically retried. Attempt foreign keys prevent deleting their parent intent/invoice through cascades; deletion policies must account for this history.

Apply the migration and application as a coordinated release with reminder cron and sending disabled during rollout. An older application must not remain active against the new grants. This migration has only been exercised in disposable local databases; no hosted migration was applied. Do not roll back by dropping live attempt history. Roll back the delivery capability by disabling sends and retaining evidence.

## Focused verification

`npx tsx --test lib/database/reminder-delivery.test.ts lib/invoices/reminder-send.test.ts lib/invoices/reminder-delivery.test.ts lib/invoices/balances.test.ts`

The seven tests cover all migrations, atomic draft rollback, one winning claim for repeat submissions, owner isolation, restricted mutation grants, immutable outcomes, stale balance/recipient/review rejection, explicit confirmation, safe discard, accepted-result scheduling, stop preservation, transport ambiguity and failed outcome persistence. PGlite serializes connection operations; it does not establish multi-connection hosted concurrency behaviour. TypeScript, targeted ESLint and the production build pass.

## Verified provider recovery

Migration `20261020040000_reminder_provider_evidence.sql` adds immutable receipts/events and a delivery-state projection. New sends carry their attempt UUID as the `vibecount_attempt` provider tag. `/api/webhooks/resend` verifies the exact bounded raw body using the installed Resend SDK before any provider read or database mutation. It retrieves the sent message and binds its provider ID, unique attempt tag, sender, one recipient, subject and text to the approved payload. The database independently checks that payload; the owner comes from the stored attempt, never the webhook.

An unknown initial outcome stays immutable. Verified acceptance changes the reminder projection and appends evidence; it does not change the initial outcome or resend. A provider message cannot be reused by another attempt. Duplicate events are idempotent and altered replays fail. Delivered evidence survives older sent events. Delivery problems take precedence and stop future scheduling. Webhook recovery alone never enables scheduling. Original outcome responses cannot overwrite evidence that arrived first.

`/dashboard/reminders` provides owner-filtered, paginated history, original outcomes, provider references and verified event evidence. The page distinguishes acceptance from delivery. It displays at most 250 provider events per page and labels truncation. The dashboard links to it and shows a Stop future reminders control during in-flight sends for invoices present on that page.

Provider contracts were checked against installed Resend 6.12.4 and the official [signature verification](https://resend.com/docs/webhooks/verify-webhooks-requests), [email tags](https://resend.com/docs/dashboard/emails/tags) and [retrieve sent email](https://resend.com/docs/api-reference/emails/retrieve-email) documentation. No new provider was provisioned; the existing Resend integration is retained.

Configure `RESEND_WEBHOOK_SECRET` on deployment and register `/api/webhooks/resend` for sent, delivered, delivery_delayed, bounced, complained, failed and suppressed events. The existing server API key must permit retrieving sent messages. A missing configuration or provider/database outage returns 503 for retry; invalid signatures return 400. Unrelated event types or untagged email features are ignored. No full webhook body, signature, click/open tracking data or provider credentials are persisted. Configure the endpoint before enabling new sends. This configuration has not been applied to the hosted provider.

Additional checks:

```sh
npx tsx --test lib/database/reminder-provider-evidence.test.ts lib/database/reminder-concurrency.test.ts lib/invoices/reminder-webhook.test.ts lib/invoices/reminder-history.test.ts
```

These exercise real SDK signature validation with synthetic signatures, oversized/tampered/stale bodies, actual SQL persistence of signed evidence, cross-attempt receipt rejection, owner isolation, immutable outcomes, out-of-order events and webhook-before-response. An isolated native PostgreSQL cluster with independent connections demonstrates lock contention and exactly one winning claim/provider invocation. Server-rendered history tests verify visible retained uncertainty, evidence, pagination, authentication and read-failure messaging. No outbound email/provider fetch is used in tests.

## Remaining acceptance

- Activate the webhook configuration in the designated deployment and prove its signed-in provider journey there.
- Legacy failed/untagged sends and attempts with no authoritative provider evidence remain unresolved. Absence of an event never authorizes resend. Recovery after provider evidence expires still requires an operational policy.
- Provider read normalization that differs from the exact approved payload fails closed; check representative real-provider responses before release.
- Full per-attempt event pagination beyond the history page's labeled 250-event sample remains a usability improvement; all evidence is retained.
- No provider send, hosted migration, deployment or live invoice approval was performed.

## Current verification result

The complete local regression run finished with 793/794 passing in 189 seconds. The sole failure was the scheduler test double lacking the newly introduced atomic RPC. After updating that boundary fixture, all 11 reminder draft/send/recovery/history/concurrency checks passed in 2.4 seconds. The full suite was not repeated after that test-only change. Production build, TypeScript and targeted lint passed. Reports: `/tmp/vibecount-reminder-regression.log`, `/tmp/vibecount-reminder-final-checks.log`, `/tmp/vibecount-reminder-recovery-build.log`.

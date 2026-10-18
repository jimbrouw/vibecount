# Reviewed invoice economics and immutable revisions

Local implementation, 17 October 2026. Migration: `20261017150000_invoice_revisions.sql`. No production migration has been applied by this work.

## Behavior

Native invoice confirmation now calculates bounded integer-pence net, VAT and gross on the server and stores the confirmed VAT rate/registration number. `invoices.amount` remains gross GBP for compatibility with invoice allocations and existing readers. Editing a saved £100 net + £20 VAT invoice starts at £100 net and preserves the 20% treatment even if current business defaults change. VAT rounding uses integer arithmetic, nearest penny with half pennies rounded up.

`invoice_revisions` preserves the invoice/client/seller/payment/render snapshot, reason, author, version, timestamp, unique PDF path and SHA-256. The retained render metadata includes a branding logo hash, not a copy of the logo bytes. PDF bytes preserve the exact rendered artifact. History is available at `/dashboard/invoices/history?id=…`; downloads can select an owner-scoped revision. Earlier snapshots and PDFs remain available.

A legacy invoice has a known gross total and unknown net/VAT. The migration preserves its current row and existing PDF reference as version zero without inventing a hash or VAT treatment. On first revision, the user must check original evidence, supply a verified breakdown and confirm it matches the old gross. A never-finalised draft differs: it may review a candidate net amount and confirm VAT for the first time; its prior draft total does not freeze a historical invoice.

Download/share GET requests serve stored artifacts only. A missing legacy PDF returns 409 and directs the user to review/reconstruction; today's settings are never silently used to recreate original evidence. The first reconstruction is a new reviewed revision, not proof that the missing original has been recovered.

## Approval and concurrency

The form reads back the total in figures and words, requires an explicit checkbox and a reason for edits. Field changes, VAT/legacy inputs and company suggestion selection clear confirmation. Page keys reset state when invoice/default props change. Existing reviewed VAT treatment is retained; changes in treatment require the forthcoming correction workflow.

The authenticated save RPC derives the owner and takes the shared reconciliation advisory lock before the invoice row lock. It checks the exact expected update timestamp, owned client, integer money/VAT equation, original legacy total, preserved PDF object and unique revision identity. Revision insertion and invoice projection update are one transaction. Direct finalisation/economic snapshot edits are denied to authenticated/service roles; ordinary delivery/paid/reminder metadata remains separate.

Any invoice settlement history prevents a new revision until a reviewed correction/credit-note workflow exists. The extended guard also protects terms, due date and PDF/economic snapshot fields. Confirmed edits preserve delivery status, paid/sent dates and reminder state; they create zero `financial_records` income.

An unchanged HTTP retry identifies the original normalized review by hash and returns its already preserved PDF after verifying SHA-256. It does not reread mutable client/business/branding settings or create a second revision. Changed requests cannot reuse the revision ID. SQL retries independently check the complete persisted request payload. Concurrent saves serialize and the stale save fails; an allocation ahead of a save prevents an evidence rewrite.

Seller/payment details displayed during review are compared with current server settings before publication; a stale bank/address review requires reload. Existing shared client records are not updated by PDF confirmation. Client details edited on an invoice are included in that revision's render snapshot. A new client may be created before upload/publication; a later failure can leave an unused client but cannot alter a previous invoice revision.

## Storage and rollout

PDFs use `owner/revisions/revision-uuid.pdf`, with `upsert:false`. The migration removes the authenticated invoice Storage UPDATE policy for both old and new paths. Ordinary users can insert/read their own PDFs but cannot overwrite them. Privileged Storage administration remains a separate operational trust boundary.

Upload precedes atomic publication. Failed upload leaves the previous confirmed revision current. A database rejection or uncertain response retains the unused/uploaded PDF; recovery/cleanup tooling remains operational work. Number collisions fail safely and require a reload/new review. Number reservation across simultaneous new invoices remains a usability improvement, not a duplicate-publication path.

Rehearse all migrations in sequence on disposable/staging Supabase, including legacy invoices and drafts. Verify actual Storage HTTP overwrite denial, role privileges, authenticated invoice creation/edit/history/download and snapshot timestamp serialization. Repository tests use a metadata shim and inert transports, so do not certify actual Storage behavior.

Deploy SQL and the new route/form together after review. Older API versions overwrite PDFs and are incompatible with the new protections. Rollback disables invoice publishing and retains revision history; do not drop history or restore overwrite permissions. Restore backup/object access before any real-data rollout.

## Anonymised demonstration and verification

1. Create a synthetic £100 net invoice with 20% VAT and a synthetic registration number: confirm £120 (one hundred and twenty pounds).
2. Change current defaults to 25%; reopen the saved invoice. Net remains £100, VAT £20, total £120.
3. Edit the description with a reason and explicit confirmation. History shows the earlier and current PDF hashes; both artifacts remain downloadable. Existing sent/paid metadata is preserved.
4. Review a synthetic legacy £120 invoice. It starts with an empty net input and unknown VAT. £120 net + £24 VAT is blocked; verified £100 + £20 is accepted. A £100 never-finalised draft can instead finalise at £120.
5. Retry the unchanged request after changing current business details; the same saved bytes return. Changed request IDs/payloads, stale versions, arbitrary VAT, cross-owner access and direct finalisation/overwrite fail.
6. Race two saves and an allocation against a save using independent PostgreSQL connections. Exactly one valid state commits; no paid allocation can coexist with rewritten economics.

Automated coverage lives in `lib/invoices/economics.test.ts`, `revision-route.test.ts`, `lib/database/invoice-revisions.test.ts`, native concurrency tests and `scripts/test-invoice-ui.mjs`. Final local checks: 101 tests passed; both browser suites, lint, production build, secret scan and diff whitespace check passed. Production-server smoke checks using public build-only placeholders denied unauthenticated publication/download/share (401), redirected history to login (307) and served login (200); the temporary server was stopped. CI is configured to run the suites; execution on GitHub is not established.

Remaining scope: reviewed credit notes/corrections to settled invoices, signed refund reporting, complete customer/bank-source evidence linking, orphan recovery/retention, real Storage/browser rehearsal and release-base isolation. Legacy version-zero PDF hashes remain unknown. These changes do not implement filing or complete M2.

## Subsequent refund slice

Reviewed supplier/customer cash refunds and signed report/export effects now exist locally; see `reviewed-refunds.md`. Earlier statements that all refund accounting is absent are superseded. Invoice credit notes/settled corrections, FX, split refund allocations and complete exception resolution remain unfinished.

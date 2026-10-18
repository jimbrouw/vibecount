# Native GBP balance isolation

18 October 2026. Implements the next compatibility prerequisite from [the foreign invoice plan](fx-foreign-invoice-plan.md). External canonical invoices and FX financial settlement remain disabled.

## Change and compatibility

Forward migration `20261018190000_native_invoice_balance_scope.sql` keeps `invoice_payment_balances` as a GBP-only contract. A row must have native origin, GBP currency, a non-null native amount and null external original-unit/rules/source fields. The migration copies the existing arithmetic and appends that predicate. It preserves the view's identity, all 24 column positions/types, dependencies, grants and `security_invoker=true`. It does not filter by status or positive value: existing zero drafts remain present.

The existing private `require_native_invoice_relationship` trigger function now checks the same complete shape. Settlements, credits, returned-cash assignments and contextual record insertion/reassignment cannot reference an unsupported invoice through that boundary. Existing trigger registrations and restricted function grants remain. This closes a malformed-native metadata gap that would otherwise become relevant after future constraint changes.

No invoice, amount, source, decision, historical snapshot, saved request/result or artifact is rewritten. Native accounting and commercial meaning remain distinct: a manual paid marker is not receipt evidence; credits reduce entitlement; returned cash reduces retained receipts; reconciliation adds no income.

## Verification and demonstration

The predecessor-upgrade test builds actual synthetic history through the existing revision, import, classification, allocation, credit, refund and returned-cash assignment APIs. It covers six native cases: zero draft, manual paid assertion with £120 outstanding, £80 partial outstanding, fully settled, fully credited, and £20 refund due after £10 returned cash. Native rows and dependent credit/refund choices match their predecessor values exactly. View identity/types/ACLs, source/history rows and financial stamp remain unchanged. Old revision/allocation/credit/assignment requests recover their exact saved results.

A privileged rollback-only corruption fixture independently exercises external GBP, external USD, native wrong currency, null native amount and each populated external metadata field. The original view includes all eight unsupported candidates; the forward view excludes them. The relationship trigger rejects inserts and contextual record reassignment. The fixture rolls back every constraint relaxation and candidate; tests then prove the shipping schema still rejects external rows. Two-owner reads, anonymous denial, service balance access and private helper denial remain covered.

Run `npx tsx scripts/demo-native-invoice-balances.ts` for the disposable ordered-SQL demonstration. It writes `/tmp/vibecount-native-balance-demo/balances.json` and a README. A £280 receipt and £10 refund leave £270 recognised income; commercial matching creates no additional income. Source ciphertext, PDF hashes, Storage rows and review attestations are synthetic metadata placeholders, not proof of readable original evidence or hosted acceptance.

Verification checkpoint: **464 automated tests passed**, with zero failed/cancelled/skipped. The final contextual reassignment refinement separately passed all **six focused SQL checks**. Independent read-only review found no blocker. Full lint, final changed-TypeScript lint, secret scan, tracked/new-file whitespace and a clean production build including TypeScript passed. The first build caught missing result-type annotations in the new test/demo; explicit query result types corrected them. Prior ignored build output was preserved, and public build-time Supabase values were non-production placeholders. No UI changed; the prior 12-suite synthetic browser checkpoint was not rerun for this SQL boundary. These checks do not establish hosted authenticated or Storage acceptance.

Supporting logs: `/tmp/vibecount-native-balance-full.log`, `/tmp/vibecount-native-balance-focused-final.log`, `/tmp/vibecount-native-balance-build-final.log`, `/tmp/vibecount-native-balance-lint.log`, `/tmp/vibecount-native-balance-lint-final.log`, `/tmp/vibecount-native-balance-secrets.log` and `/tmp/vibecount-native-balance-demo-final.log`. Temporary local logs are not retained release artifacts.

## Rollout and remaining work

Rehearse the complete ordered migration chain before release. There are now 59 local migrations, including 34 untracked additions; hosted application is unknown. This migration performs no backfill and can be disabled at entry points while preserving history. Do not drop populated history or remove native-only constraints as a routine rollback.

This is a prerequisite, not external invoice support. Remaining gates include explicit unsupported-currency coverage/currentness in tax/filing/finance readers, parked-consumer containment, complete external capture/correction, source-family/revision/amount validation, dimensioned conversion lots/settlements/reversal, foreign accounts, fees, credits/refunds and complete reporting. Legacy writers also need explicit missing-balance rejection before external enablement, alongside the complete relationship guard. Never infer a zero liability or GBP equivalent from absence in this native view.

Evidence lifecycle and coordinated database/object/key restore, durable communication recovery, representative provider/hosted acceptance, independent tax/form review and release isolation remain part of the full handover. No hosted migration, real approval, provider call, bank connection, send, payment, deployment or filing occurs in this step.

# Private preview acceptance — 18 October 2026

Private test application: https://vibecount-private-test-pjg5160w5-jims-projects-b7cb6c2e.vercel.app

This is a separate Vercel project (`vibecount-private-test`,
`prj_4HsGcxALjmvHQNk2kijYl6Iu0w8j`) and separate Supabase project
(`vibecount-private-test`, `xgpozyxnckwetlxqners`). Supabase quoted $0/month;
creation was authorized at $0 only. No plan was upgraded. Vercel usage remains
subject to the existing team's plan. Vercel sign-in protects the preview URL.

The synthetic VibeCount login is stored locally in the ignored, owner-readable
`.vercel/private-test-login.json`; credentials are not included in this report.

## Hosted acceptance passed

- Browser password login and account creation.
- CSV upload preserves three observations with review initially unresolved.
- Explicit Business income £1,000; Business expense £125.50; Personal £24
  remains excluded. Approved trading net is £874.50.
- Hosted records JSON/CSV, source ledger, decision history and hash manifest
  downloads succeeded. Original download through its explicit confirmation
  returned bytes exactly matching the uploaded CSV and manifest SHA-256.
- Reimporting identical bytes preserves three observations and the exact same
  two approved records.
- A synthetic £1,000 invoice was explicitly confirmed and its PDF generated.
  Invoice matching allocated £1,000, with invoice outstanding £0 and receipt
  unallocated £0. Approved income remained £1,000; no duplicate income arose.
- Hosted reconciliation export succeeded, and the Records page shows £874.50.
- A second authenticated test user sees no first-user records, transactions,
  imports or source rows; direct source-file reads are denied.
- Anonymous preview requests redirect to Vercel sign-in.

All data and approvals are synthetic. No real invoice/customer email, payment,
bank connection or tax submission was performed. This proves the GBP test
journey; it does not certify complete tax facts or independent tax/form review.

## Release and repair

The isolated release package builds successfully and excludes parked agent/MCP
endpoints, scheduled jobs, local secrets and production-provider credentials.
Its manifest records source hashes. All 113 baseline/upgrade migrations applied
to the new database. Evidence keys are unique to this test project and retained
in its Vercel configuration.

Hosted acceptance exposed one export defect missed by mocked tests: PostgREST
found two attachment foreign keys and rejected the unqualified embed. The
records-export query now explicitly selects the same-owner composite foreign
key. The focused route test and lint passed, and real hosted export succeeded.
No feature work was added.

## Live app unchanged

Verified live Vercel production deployment remains
`dpl_AH61dvFRFtyc2rHVABJnmoaWz8e4`; live Supabase remains at 28 migrations.
No production migrations, environment changes or deployment promotion occurred.

Local acceptance artifacts: `/tmp/vibecount-private-acceptance/` (report,
synthetic CSV/exports and screenshots; browser session files are private and
must not be shared). Test setup/build/migration logs remain under `/tmp`.

## Visible browser sign-in correction

Stable private URL: https://vibecount-private-test.vercel.app

The user's browser showed `Unsupported provider: provider is not enabled` after
selecting Google. Google OAuth is not configured on the isolated Supabase project.
Preview-only `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false` now replaces the Google
option/divider on login and signup with an email/password explanation. Unset
configuration retains the existing Google UI. No live auth settings changed.

The corrected deployment is assigned to the separate test project's existing
alias. An anonymous check initially exposed that the default alias was outside
the project's previous protection mode. Test-project SSO protection was tightened
to `deploymentType: all`; anonymous requests now redirect to Vercel login. No
subscription upgrade or production-project setting change was performed.

Verified in the visible in-app browser: test email/password login succeeds;
dashboard, Records, tax-prep and cash planning load; error/warning logs are empty.
Records show £1,000 income, £125.50 costs and £874.50 net. Tax/cash inputs remain
explicitly unresolved. Focused lint and deployed Next.js build passed. Screenshot:
`/tmp/vibecount-private-browser-check.jpg`. The browser remains signed into the
synthetic test account on Records, including after the privacy change/reload.

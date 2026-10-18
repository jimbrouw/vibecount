# Deployment readiness — 18 October 2026

Decision: do not promote the current local vNext tree to production yet. This
was a bounded read-only deployment check; no application code, environment
settings, databases or deployments were changed.

## Verified now

- Vercel authentication works as `jimbrouwer-3159`; CLI is now 64.5.0.
- Project `vibecount` in `team_TJVsgtI8g34IU0BLDze0EbOE` has a Ready production
  deployment created 14 October 2026, ID `dpl_AH61dvFRFtyc2rHVABJnmoaWz8e4`.
- Existing deployment alias:
  https://vibecount-jims-projects-b7cb6c2e.vercel.app
- Anonymous requests to `/login` and `/dashboard` redirect to Vercel login.
  A returned 200 was the Vercel login page, not proof of application health.
- Supabase `lazorvlkgxgzdgflzhjm` is ACTIVE_HEALTHY with 28 applied migrations.
- Hosted `financial_accounts`, `bank_transactions`, `tax_calculations`,
  `filing_packs`, `evidence_documents` and `cash_effect_pence` are absent.
- Local tree has 109 canonical migration files, 44 modified tracked files and
  753 untracked files. Branch is `claude/vibecount-ai-agents`, HEAD `5cb31c6`.
- Last full suite log proves 838 passing tests and the production build log
  shows successful build output. Later receipt-refund changes passed focused
  hosted-schema and native concurrency tests. The latest entire tree has not
  received a new complete CI or authenticated hosted acceptance run.

## Exact release blockers

1. **Schema/application mismatch.** Only 24 canonical local predecessors match
   hosted migration versions. 85 local migrations remain unapplied, including
   July settings and vNext. Deploying these readers against the current database
   would leave required tables/functions absent.
2. **Canonical migration history mismatch.** The four applied October 14 receipt
   migrations are captured only in `fixtures/hosted-baseline`. Reconcile them
   into release history and preserve applied versions before choosing an ordered
   upgrade. Do not blindly run a production migration push or metadata repair.
3. **Missing evidence encryption configuration.** Vercel Preview/Production and
   `.env.local` have neither `VIBECOUNT_SOURCE_ENCRYPTION_KEY` nor
   `VIBECOUNT_SOURCE_ENCRYPTION_KEYS`. A valid key configuration is required for
   the new encrypted bank/document imports. A retained-key configuration also
   needs `VIBECOUNT_SOURCE_KEY_ID`; a single-key setup otherwise defaults to v1.
   Missing keys are a blocker for imports even though static builds pass.
4. **Unpackaged release.** The new application and migrations are mostly
   untracked, and the current branch also includes parked MCP work. Select and
   review a reproducible release snapshot; a Git deployment from the current
   commit will omit uncommitted work. Preserve all existing work while isolating
   the intended scope.
5. **No accepted test environment/journey.** No designated isolated Supabase
   target is established. Verify matching Supabase URL, publishable key and
   service role, Auth callback URLs, Storage permissions, PostgREST computed
   fields and signed-in import → classify/reconcile → draft export before
   production promotion. Existing environment variable names are present;
   values and cross-environment matching were not inspected.
6. **Access/public URL unverified.** The inspected alias requires Vercel login.
   Use an authorized browser for private preview acceptance, or explicitly
   configure intended public/domain access before public release.

## Shortest useful release

- Existing app: use the existing deployment behind Vercel sign-in. Ready status
  proves deployment completion, not successful VibeCount login or workflows.
- New vNext app: freeze scope to GBP import, dedupe, explicit classification,
  reconciliation and draft exports. Keep uncompleted foreign lifecycle, agent
  features and deletion execution disabled. Automated reminder delivery is not
  required for this acceptance slice; the optional provider webhook secret is
  absent from Vercel and would need configuration before provider reconciliation.
- Prepare one release snapshot and reconciled migration set. Upgrade an isolated
  test database, configure evidence keys and aligned Auth/Storage settings, and
  deploy one Vercel Preview against that database.
- Run one signed-in synthetic GBP acceptance case, reimport it to prove totals
  do not change, check another user cannot read the evidence, and verify exports
  tie to ledger totals. Repair only failures in that path.
- Before production database changes, preserve recoverable database/object/key
  state and validate the upgrade against the actual baseline. Promote the same
  accepted release; no additional feature work is needed to start this route.

Estimated planning allowance: 1–3 focused engineering hours for a test preview
and acceptance run after the target and required keys are available, if the
migration rehearsal predicts hosted behavior. This is not a completion promise;
any real migration/auth/storage failure needs a revised estimate. The complete
handover has broader unresolved tax review and product scope and has no verified
short ETA. Independent tax/form review is required before representing draft
packs as accountant-validated; it need not prevent a clearly labelled draft MVP.

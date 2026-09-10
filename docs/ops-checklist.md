# VibeCount Ops Checklist

## Supabase migration gate

Before merging or deploying the quote/proposal PDF backup work, confirm the linked Supabase project has applied:

`20260601000000_quote_proposal_pdf_storage.sql`

This migration adds `pdf_path` to `public.quotes` and `public.proposals`.

Use an authenticated Supabase CLI session:

```bash
supabase migration list --linked
supabase db push --linked
```

Do not paste long-lived access tokens into handover docs or chat. If a token has been shared in plaintext, rotate it before using the handover outside the local machine.

## Phase boundary decision

Current branch `claude/vibecount-ai-agents` includes Phase 4 MCP/agent files such as:

- `app/api/mcp/**`
- `lib/mcp/**`
- `app/dashboard/settings/AgentAccess.tsx`
- `app/dashboard/agent/audit/page.tsx`
- `supabase/migrations/20260530140000_agent_sessions.sql`

Current project guidance says Phase 4 MCP/browser-agent capabilities should remain parked. Before merging PR #3, choose one path:

1. Split Phase 2/3 hardening from Phase 4 MCP work and merge only Phase 2/3 into `codex/phase-3-invoice-reminders`.
2. Update `AGENTS.md`, `HANDOVER.md`, and `tasks.md` to explicitly allow this scoped Phase 4 work in the PR.

Do not merge the branch while the project instructions and branch contents disagree.

## Vercel env and cron gate

Confirm these environment variables exist in Production, Preview, and Development:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `CRON_SECRET`
- `NEXT_PUBLIC_POSTHOG_KEY`
- `NEXT_PUBLIC_POSTHOG_HOST`

Manual crons to configure in Vercel:

- `/api/reminders/due` at `0 8 * * *`
- `/api/invoices/repeating/run` at `0 7 * * *`

After deploy, check each cron route returns unauthorized without the cron secret and runs only with the configured secret.

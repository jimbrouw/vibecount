# CLAUDE.md — VibeCount Personal

Single-user, local-first invoicing app for Jim. Tauri 2 desktop app. No server, no auth, no Supabase. All data lives in one SQLite file inside a synced folder.

## Who you are in this project

You are the EXECUTION model. All architecture, product, and prompt decisions were made upstream by a stronger model and are locked in SPEC.md. Your job is to implement TASK.md exactly, one task at a time.

## Hard rules

1. **Do not redesign.** If SPEC.md says how, do it that way. If SPEC.md is silent, STOP and ask Jim. Never invent a schema change, library swap, or new feature.
2. **One task at a time.** Complete the task, run the checks listed for it, commit, then stop or continue as instructed.
3. **Money is integer pence everywhere** inside the app and DB. Floats exist only at the extraction boundary and are converted immediately. Never do arithmetic on float currency.
4. **Copy the extraction system prompt verbatim** from SPEC.md section 6. Do not "improve" it. It was validated at 93% exact / 100% ambiguity caught. Any edit invalidates that.
5. **TypeScript strict mode.** No `any`. Zod-validate anything that crosses a boundary (API response, DB row, settings).
6. **Tests before commit.** Vitest for logic (money conversion, interest calc, CSV export, JSON parse guard). No test = no commit.
7. **If a command fails twice the same way, stop and report.** Do not thrash.
8. **Never call the Anthropic API in tests.** Mock it. Jim pays per call.
9. **Read git history before resuming** a session (`git log --oneline -15`).

## Session protocol

Standard commit/resume/BANANAS protocol:
- End of session: commit, update TASK.md checkboxes, append one-line status to BANANAS.md.
- Resume: read CLAUDE.md, TASK.md, BANANAS.md tail, git log. Then continue from first unchecked task.

## Stack (locked)

- Tauri 2, React 18, TypeScript, Vite, Vitest
- SQLite via `@tauri-apps/plugin-sql`
- HTTP via `@tauri-apps/plugin-http` (frontend fetch to Anthropic API, no Rust code needed, no CORS problem)
- PDF via `@react-pdf/renderer`
- Zod for validation
- No CSS framework decision forced: plain CSS modules, large type, high contrast (dyslexia-first, see SPEC.md section 9)

## Commands

- `npm run tauri dev` — run app
- `npm test` — Vitest
- `npm run tauri build` — release build

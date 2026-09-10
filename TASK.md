# TASK.md — VibeCount Personal build plan

Six evenings. Do tasks in order. Each task ends with its DONE CHECK passing, a commit, and a ticked box here. If blocked, write the blocker under the task and stop.

## Evening 1 — Skeleton + data layer

- [ ] 1.1 Scaffold Tauri 2 + React 18 + TS + Vite. Add plugins: sql, http. Add Vitest, Zod. App boots to a "VibeCount" placeholder.
  DONE CHECK: `npm run tauri dev` opens a window; `npm test` runs (0 tests ok).
- [ ] 1.2 Migrations: create all four tables from SPEC.md §4 on first boot. Seed `settings` defaults.
  DONE CHECK: boot app, inspect DB file, tables + default settings rows exist.
- [ ] 1.3 `src/lib/money.ts`: `penceToDisplay`, `displayToPence`, `penceToWords` (GBP to £999,999.99). Pure functions.
  DONE CHECK: 15+ Vitest cases incl. 0, 1p, £8.50, £1,249.95, £999,999.99, rejection of negatives.
- [ ] 1.4 Settings screen: all keys from SPEC §4 editable, api_key masked, data_dir folder picker.
  DONE CHECK: change a value, restart app, value persists.

## Evening 2 — Clients + typed invoicing

- [ ] 2.1 Repository layer `src/lib/repo.ts`: typed CRUD for clients, invoices, line_items. Zod on every row read.
  DONE CHECK: Vitest against an in-memory/temp SQLite DB: create client, create invoice with 2 line items, read back identical.
- [ ] 2.2 Typed invoice form: client name field with match-or-create (SPEC §4 rule), description, amount, issue date (default today), due date auto = issue + payment_terms_days.
  DONE CHECK: create a draft invoice fully by typing; appears in list.
- [ ] 2.3 Invoice list: number, client, amount (via `<Money>`), status, due date; overdue rows flagged.
  DONE CHECK: visual check with 3 seeded invoices in different states.

## Evening 3 — Extraction + read-back gate

- [ ] 3.1 `src/lib/anthropic.ts`: call Messages API via plugin-http, model from settings, system prompt VERBATIM from SPEC §6, `parseFirstJsonObject` guard, Zod schema for the 5 fields.
  DONE CHECK: Vitest with mocked HTTP: clean JSON, JSON+trailing prose, garbage (throws typed error). NO live API calls in tests.
- [ ] 3.2 "Say it" screen: big textbox (Whisper Flow target) + Extract button → draft object.
  DONE CHECK: manual live test with real key: "Invoice Simon eight fifty for projection mapping" returns ambiguous with candidates.
- [ ] 3.3 Read-back confirm screen exactly per SPEC §7 (three-way display, amber ambiguity picker, three buttons). Both typed and dictated paths route through it before save.
  DONE CHECK: ambiguous case forces a candidate choice; typed path also hits confirm; extraction failure drops raw text into typed form (no dead end).

## Evening 4 — PDF + numbering + lifecycle

- [ ] 4.1 Numbering: `PREFIX-YYYY-NNN` from settings, incremented atomically on finalise only. Drafts have no number claim.
  DONE CHECK: finalise two drafts → consecutive numbers; deleting a draft never burns a number.
- [ ] 4.2 PDF via @react-pdf/renderer: sender block (settings), client block, number, dates, line items, total, bank details, payment terms. Large clear type.
  DONE CHECK: generate PDF for a seeded invoice, open it, everything present and readable.
- [ ] 4.3 Status flow: draft → finalise (locks fields, assigns number, writes PDF to data_dir/invoices/) → mark paid (records paid_date).
  DONE CHECK: full walkthrough dictation → confirm → finalise → PDF on disk → mark paid.

## Evening 5 — Money awareness features

- [ ] 5.1 `src/lib/interest.ts` per SPEC §8a with the [VERIFY] flags kept in UI copy. Pure function.
  DONE CHECK: unit tests vs 3 hand-worked examples (write the arithmetic in the test comments).
- [ ] 5.2 Late payment button + explanation copy on overdue invoices; "add to a copy" creates a new draft with interest + fee line items.
  DONE CHECK: seeded overdue invoice shows correct figures; copy invoice contains original lines + 2 new lines.
- [ ] 5.3 Tax pot nudge on finalise (SPEC §8b).
  DONE CHECK: finalise £1,000 invoice with 27% setting → "about £270" wording exact.
- [ ] 5.4 Home totals + speechSynthesis read-aloud (SPEC §8c).
  DONE CHECK: totals match seeded data; speaker button reads words aloud; hidden if API unavailable.

## Evening 6 — Exports + chase + backup

- [ ] 6.1 Accountant export (SPEC §8d): CSV + summary txt for a chosen tax year, correct 6 April boundary.
  DONE CHECK: unit test: invoice dated 5 April vs 6 April lands in different tax years; CSV opens in Numbers/Excel.
- [ ] 6.2 Chase script generator (SPEC §8e).
  DONE CHECK: manual live test on an overdue invoice; output references number, amount, days overdue; copy button works.
- [ ] 6.3 Full JSON backup export button.
  DONE CHECK: export, wipe DB file, confirm the JSON contains every row (restore is Phase 2, note it).
- [ ] 6.4 Polish pass against SPEC §9 accessibility rules; `npm run tauri build` produces a working release app.
  DONE CHECK: Jim runs the built app and creates one real invoice end to end.

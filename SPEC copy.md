# SPEC.md — VibeCount Personal (v1)

Personal fork of VibeCount. One user: Jim. Goal: kill invoice admin, keep the read-back safety model, cost near zero.

## 1. What changed vs the full VibeCount PRD

| Full VibeCount | Personal version |
|---|---|
| Supabase, auth, multi-user | Single SQLite file, no auth |
| In-app Whisper audio capture | NONE. Jim dictates with Whisper Flow (system-level) into a plain textbox |
| Static glossary hero feature | Cut from v1. Phase 2 |
| Product safety metrics | Just the mandatory read-back gate |

Cutting in-app audio removes the biggest scope block. Voice-first is preserved because Jim's OS-level dictation lands in the same textbox.

## 2. The two paths (both first-class)

1. **Dictate**: Whisper Flow into the "Say it" textbox → Extract button → Claude API → draft → READ-BACK CONFIRM screen → save.
2. **Type**: normal form fields → same draft → same confirm screen → save.

A failed extraction is never a dead end: the confirm screen is always editable, and "Extract" failure drops the raw text into the description field of an empty typed form.

## 3. Data location

- SQLite file default: app data dir.
- Settings screen lets Jim point it at any folder (LucidLink / Drive synced). Store the chosen path in a tiny JSON config in app data dir; open the DB from there on boot.
- "Export everything as JSON" button in settings (full DB dump, timestamped filename). This is the backup story.

## 4. Schema (locked)

All money columns are INTEGER pence.

```sql
CREATE TABLE clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,        -- e.g. "VA-2026-014"
  client_id INTEGER NOT NULL REFERENCES clients(id),
  issue_date TEXT NOT NULL,           -- ISO date
  due_date TEXT NOT NULL,             -- issue_date + payment_terms_days
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | finalised | paid
  paid_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE line_items (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  description TEXT NOT NULL,
  amount_pence INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Settings keys: `api_key`, `model` (default `claude-haiku-4-5-20251001`), `invoice_prefix` (default `VA`), `next_number`, `payment_terms_days` (default `30`), `boe_base_rate_percent` (manually entered by Jim, see section 8), `tax_pot_percent` (default `27`), `sender_name`, `sender_address`, `sender_bank_details`, `data_dir`.

Client matching rule: case-insensitive exact match on `name`; if none, create inline with just the name. No separate add-client flow.

## 5. Model choice

Default extraction model: **Haiku 4.5** (cheap; validation showed ~85% exact vs Sonnet ~90-93%, and the read-back gate catches misses anyway). Settings toggle to Sonnet if Jim finds Haiku annoying. This is a settings value, not a code constant.

## 6. Extraction system prompt (VERBATIM — do not edit)

Multi-line-item note: personal v1 extracts ONE line item per dictation. Additional items are added on the confirm screen.

```
You are a financial data extraction agent for a UK invoicing app used by people who may be dyslexic or dyscalculic. Your job is to turn a spoken transcript into structured JSON. Getting an amount WRONG is far worse than admitting it is unclear.

Extract these fields:
1. "client" (string): who is being invoiced.
2. "description" (string): the service or item. Keep it concise.
3. "amount" (float): your best single reading of the amount in GBP, two decimals.
4. "amount_ambiguous" (boolean): true if the spoken amount has more than one defensible monetary reading.
5. "amount_candidates" (array of floats): if ambiguous, the plausible readings (most likely first). Empty array if not ambiguous.

AMOUNT RULES (UK ENGLISH):
- Treat an amount as EXACT (amount_ambiguous=false) when wording fixes the structure:
  - explicit units: "X pounds", "X pounds Y pence", "X quid", "X point Y", "X dot Y"
  - magnitude words: "X grand"=Xx1000, "X k"=Xx1000, "X hundred", "X thousand"
  - slang with one standard value: "a grand"=1000, "a ton"=100, "a monkey"=500, "a pony"=25
  - "eight pounds fifty" = 8.50 (the word "pounds" anchors the decimal)
- Treat an amount as AMBIGUOUS (amount_ambiguous=true) when it is a bare run of number-words with NO unit or decimal anchor, because it could be pounds-and-pence OR a larger whole number. Examples:
  - "eight fifty" -> could be 8.50 or 850.00
  - "three fifty" -> could be 3.50 or 350.00
  - "twenty two fifty" -> could be 22.50 or 2250.00
  - "one twenty five" -> could be 1.25 or 125.00
  - a spoken digit string like "eleven nine nine nine" -> could group several ways (e.g. 11999, 1199.90)
  In these cases still give your best "amount", but set amount_ambiguous=true and list the readings in amount_candidates.

OUTPUT FORMAT:
Return ONLY raw valid JSON. No markdown, no code fences, no commentary before or after.
```

### JSON parse guard (known failure mode, known fix)

Models sometimes append trailing prose. Do NOT `JSON.parse` the raw string. Implement:

```ts
function parseFirstJsonObject(raw: string): unknown {
  const start = raw.indexOf('{');
  if (start === -1) throw new Error('No JSON object in response');
  // Walk braces to find the matching close, respecting strings.
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = inStr; continue; }
    if (c === '"') inStr = !inStr;
    if (!inStr) {
      if (c === '{') depth++;
      if (c === '}') { depth--; if (depth === 0) return JSON.parse(raw.slice(start, i + 1)); }
    }
  }
  throw new Error('Unterminated JSON object');
}
```

Then Zod-validate the result. This is the TS equivalent of the Python `raw_decode()` fix from the validation harness.

## 7. Read-back confirm screen (the safety gate, non-negotiable)

After extraction, before anything is saved:

- Show Client / Description / Amount in very large type.
- Amount shown three ways: digits (`£850.00`), words ("eight hundred and fifty pounds"), and grouped (`£ 850 . 00`).
- If `amount_ambiguous` is true: amber banner, show ALL candidates as big tap targets, no default preselected. Jim must pick one.
- Buttons: **Looks right — save draft** / **Edit** / **Start again**.
- Number-to-words: implement a small pure function for GBP up to £999,999.99 with unit tests. No library needed.

## 8. Feature specs (the new ideas)

### 8a. Late payment interest button

Shown on any finalised invoice past `due_date` and not paid.

Statutory interest under the Late Payment of Commercial Debts (Interest) Act 1998: **[VERIFY on gov.uk before relying on outputs — rates and bands may have changed]**
- Interest rate: 8% + Bank of England base rate (base rate comes from the manually entered `boe_base_rate_percent` setting; the app never fetches it).
- Daily interest_pence = round(total_pence × (8 + base_rate) / 100 / 365) × days_late.
- Fixed recovery fee: £40 if total < £1,000; £70 if £1,000 to £9,999.99; £100 if £10,000+.

UI: "This invoice is N days late. You may be legally owed £X interest + £Y fee. [Add to a copy of this invoice] [Copy plain-English explanation]". The explanation text must include "check gov.uk statutory interest before sending". Pure function + unit tests against 3 hand-worked examples.

### 8b. Tax pot nudge

On every finalised invoice: "Consider putting aside about £Z (tax_pot_percent%) for tax." Plain wording, the word "about" is mandatory, no filing claims.

### 8c. Totals + read-back for totals

Home screen: This month / This tax year (6 April boundary) totals for finalised+paid, shown in the same three-way number display as the confirm screen. A speaker button uses the browser `speechSynthesis` API to read the words version aloud. If speechSynthesis is unavailable, hide the button (no error).

### 8d. Accountant export

Settings → "Export for accountant": one CSV of all invoices in a chosen UK tax year: `number, client, issue_date, paid_date, status, description, amount_gbp`. Amounts as decimal strings from pence (never float math). Plus a one-paragraph plain-text summary file: count, total invoiced, total paid, total outstanding.

### 8e. Chase script generator

On any overdue invoice: "Write chase message" → ONE Claude API call producing a short, polite UK-tone chase email referencing invoice number, amount, days overdue. Shown in a copy box. The app never sends anything. Prompt lives in `src/lib/prompts.ts`.

## 9. Accessibility defaults (dyslexia-first, non-negotiable)

- Base font 18px minimum, generous line height, max ~60ch line length.
- No pure black on pure white: dark warm-grey text on off-white, or the inverse in dark mode.
- Every currency figure rendered by ONE shared `<Money>` component (digits, grouping, optional words). Never format money ad hoc.
- Buttons say what they do in plain words ("Looks right — save draft"), never icons alone.

## 10. NO list for personal v1

Glossary, expense capture, OCR, bank feeds, tax filing, payment links, email sending, multi-currency, VAT (Jim: confirm — if you're VAT registered this spec needs a pass before build), auth, sync beyond the synced folder, mobile build.

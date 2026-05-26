#!/usr/bin/env python3
"""
VibeCount — Section 0 Validation Gate runner.

WHAT THIS TESTS
  Extraction ONLY: spoken transcript -> amount. It assumes a perfect transcript.
  Whisper audio->text accuracy is a SEPARATE, untested risk. A high score here
  means parsing is sound, not that voice works end to end.

SCORING
  Amount field only, rounded to 2 decimal places. Client/description are captured
  for reference but NOT scored.

KEY SAFETY BEHAVIOUR
  If ANY row errors (API failure, bad JSON, etc.), the script REFUSES to issue a
  recommendation. A confident verdict on a test that did not actually run is worse
  than no verdict. (This is the exact failure mode that produced a bogus
  "0% -> TYPING-HERO" in an earlier browser run.)

USAGE
  export ANTHROPIC_API_KEY=sk-ant-...
  pip install anthropic
  python validation_gate.py

  # optionally override the model:
  VIBECOUNT_MODEL=claude-haiku-4-5-20251001 python validation_gate.py
"""

import os
import re
import sys
import json
import time

try:
    from anthropic import Anthropic
except ImportError:
    sys.exit("Missing dependency. Run:  pip install anthropic")

# ── CONFIG ────────────────────────────────────────────────────────────────────
# IMPORTANT: set MODEL to a string your API key can access AND that you intend to
# deploy for extraction in production. Model availability changes over time, so
# confirm this string is valid for your account before trusting the result.
# Cheaper/faster option worth testing for production extraction:
#   claude-haiku-4-5-20251001
MODEL = os.environ.get("VIBECOUNT_MODEL", "claude-sonnet-4-6")

MAX_RETRIES = 3        # retries on transient API errors
RETRY_BACKOFF = 2.0    # base seconds, exponential
DELAY_BETWEEN = 0.3    # gentle spacing between calls (seconds)
OUTPUT = "validation-result.md"

# ── EXACT SYSTEM PROMPT (do not edit — this is what gets validated) ────────────
SYSTEM_PROMPT = """You are an expert financial data extraction agent for a UK-based invoicing application.
Your task is to take a raw voice transcript and extract exactly three fields into a structured JSON object.

RULES FOR EXTRACTION:
1. "client" (String): The name of the person or entity being invoiced.
2. "description" (String): The service, item, or reason for the invoice. Keep it concise.
3. "amount" (Float): The numeric value of the invoice in GBP.

AMOUNT RESOLUTION RULES (UK ENGLISH):
- Convert slang to exact numbers (e.g., "a grand" = 1000.00, "two grand" = 2000.00).
- Convert implied decimals based on standard spoken British money:
  - "eight fifty" -> 8.50
  - "twelve forty nine ninety five" -> 1249.95
  - "eight and a half thousand" -> 8500.00
  - "three hundred and twelve" -> 312.00
- Always output the amount as a float with two decimal places (e.g., 850.00).

OUTPUT FORMAT:
Output strictly valid JSON. Do not include markdown formatting (like ```json), conversational filler, or preamble. Return only the raw object.

EXAMPLE OUTPUT:
{
  "client": "Simon",
  "description": "projection mapping",
  "amount": 850.00
}"""

# ── TEST SUITE ─────────────────────────────────────────────────────────────────
# "ambiguous" = the phrase has more than one defensible monetary reading, so a
# FAIL there usually means the model chose a sane alternative, not that it broke.
TESTS = [
    {"phrase": "Invoice Simon eight hundred and fifty pounds for projection mapping", "amount": 850.00},
    {"phrase": "Invoice Becca eight pounds fifty for parking", "amount": 8.50},
    {"phrase": "Invoice the museum eight and a half thousand for the install", "amount": 8500.00},
    {"phrase": "Invoice Jade twelve forty nine ninety five for consultancy", "amount": 1249.95},
    {"phrase": "Invoice Sahjan two grand for filming", "amount": 2000.00},
    {"phrase": "quick invoice for elinor fifty five quid for sound design", "amount": 55.00},
    {"phrase": "bill nottingham contemporary three point five k for the av handover", "amount": 3500.00},
    {"phrase": "charge dj climate twenty two fifty for studio time", "amount": 22.50,
     "ambiguous": "could read as £2,250"},
    {"phrase": "send an invoice to lucy for five hundred quid for the walking tour app", "amount": 500.00},
    {"phrase": "bill mansfield town three fifty for the match poster design", "amount": 350.00,
     "ambiguous": "could read as £3.50"},
    {"phrase": "invoice taco twelve hundred and sixty five pounds and forty pence for the livestream", "amount": 1265.40},
    {"phrase": "charge the council twenty five hundred for the public art project", "amount": 2500.00},
    {"phrase": "uh yeah invoice um vibe anything for like six and a half k for the brand copy", "amount": 6500.00},
    {"phrase": "bill kitface eleven nine nine nine for api consulting", "amount": 11999.00,
     "ambiguous": "could read as £1,199.90"},
    {"phrase": "invoice the gallery one twenty five for the pottery cups", "amount": 125.00,
     "ambiguous": "could read as £1.25"},
    {"phrase": "send a bill to the burns trust for eight fifty for the mausoleum mapping", "amount": 850.00,
     "ambiguous": "PROMPT CONFLICT: the system prompt explicitly says 'eight fifty' = 8.50"},
    {"phrase": "charge the allotment committee forty seven dot five for the polytunnel pipes", "amount": 47.50},
    {"phrase": "invoice the garage thirty three pounds and a third... wait make it exactly thirty three thirty three for the citroen suspension fix", "amount": 33.33},
    {"phrase": "bill the hardware store a ton for the split shaft multi tool repair", "amount": 100.00,
     "ambiguous": "'a ton' = £100 slang"},
    {"phrase": "invoice simon raven one four two two point five zero for the festival gig", "amount": 1422.50},
]


# ── HELPERS ────────────────────────────────────────────────────────────────────
def parse_amount(value):
    """Coerce model output into a 2dp float. Handles int/float/str, £, commas."""
    if isinstance(value, (int, float)):
        return round(float(value), 2)
    s = str(value).strip().replace("£", "").replace(",", "").replace(" ", "")
    return round(float(s), 2)


def parse_json(text):
    """Strip markdown fences and decode the FIRST valid JSON object.

    Uses raw_decode so any trailing prose the model adds after the object
    (common on ambiguous amounts, e.g. a clarifying note) is ignored instead
    of raising a 'Extra data' error.
    """
    t = text.strip()
    t = re.sub(r"^```(?:json)?", "", t).strip()
    t = re.sub(r"```$", "", t).strip()
    start = t.find("{")
    if start != -1:
        t = t[start:]
    obj, _ = json.JSONDecoder().raw_decode(t)  # stops at end of first object
    return obj


def extract(client, phrase):
    """Call the API with retries. Raises on final failure."""
    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = client.messages.create(
                model=MODEL,
                max_tokens=300,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": phrase}],
            )
            text = "".join(b.text for b in resp.content if b.type == "text")
            return parse_json(text)
        except Exception as e:  # noqa: BLE001  (we want to retry anything transient)
            last_err = e
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_BACKOFF * (2 ** attempt))
    raise last_err


def band_for(pct):
    if pct >= 90:
        return ("VOICE-HERO",
                "Amount accuracy >= 90%. Build voice-first as specced. Read-back stays mandatory.")
    if pct >= 70:
        return ("CO-EQUAL",
                "70-90%. Ship voice, but typing is co-equal and the amount always forces explicit re-confirmation.")
    return ("TYPING-HERO",
            "Below 70%. Typing is the hero for v1; voice becomes a secondary/beta feature. Still a fine product.")


# ── MAIN ───────────────────────────────────────────────────────────────────────
def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("Set ANTHROPIC_API_KEY before running.")

    client = Anthropic()
    print(f"Model: {MODEL}\nRunning {len(TESTS)} extraction tests...\n")

    rows = []      # successful runs (pass or fail)
    errors = []    # rows that never ran

    for i, t in enumerate(TESTS, 1):
        expected = round(t["amount"], 2)
        amb = t.get("ambiguous")
        try:
            obj = extract(client, t["phrase"])
            got = parse_amount(obj.get("amount"))
            ok = (got == expected)
            rows.append({
                "i": i, "phrase": t["phrase"], "expected": expected, "got": got,
                "ok": ok, "client": obj.get("client", "—"),
                "desc": obj.get("description", "—"), "ambiguous": amb,
            })
            flag = "PASS" if ok else "FAIL"
            tail = f"   <- {amb}" if (amb and not ok) else ""
            print(f"[{i:2}] {flag}  expected £{expected:<10.2f} got £{got:<10.2f}{tail}")
        except Exception as e:  # noqa: BLE001
            errors.append({"i": i, "phrase": t["phrase"], "err": str(e)})
            print(f"[{i:2}] ERR   {e}")
        time.sleep(DELAY_BETWEEN)

    print()

    # ── Refuse to score if anything failed to run ──────────────────────────────
    if errors:
        lines = [
            "# VibeCount Validation Gate — NO RESULT",
            "",
            f"**Model:** {MODEL}",
            "",
            f"**{len(errors)} of {len(TESTS)} rows failed to run.** No recommendation issued — "
            "a verdict on a test that did not run is worthless.",
            "",
            "## Errors",
            "",
        ]
        for e in errors:
            lines.append(f"- Row {e['i']}: `{e['err']}`")
        lines += [
            "",
            "## Likely causes",
            "- `ANTHROPIC_API_KEY` not set, or no access to the chosen model.",
            f"- `MODEL` string invalid for this account (currently `{MODEL}`). "
            "Try setting `VIBECOUNT_MODEL` to a model your key can use.",
            "- Network / rate limiting (the script already retries transient errors).",
            "",
            "Fix the errors and re-run. Only a clean 20/20 run produces a recommendation.",
        ]
        with open(OUTPUT, "w") as f:
            f.write("\n".join(lines) + "\n")
        print(f"{len(errors)} row(s) errored — NO recommendation. See {OUTPUT}.")
        sys.exit(1)

    # ── Clean run: score on amount only ────────────────────────────────────────
    passes = sum(1 for r in rows if r["ok"])
    total = len(rows)
    pct = round(100 * passes / total)
    band, advice = band_for(pct)

    # Console summary
    print(f"SCORE: {passes}/{total} = {pct}%")
    print(f"RECOMMENDATION: {band}")
    print(advice)

    # Markdown report
    md = [
        "# VibeCount Validation Gate — Result",
        "",
        f"**Model:** {MODEL}  ",
        f"**Score (amount field only):** {passes}/{total} = **{pct}%**  ",
        f"**Recommendation:** {band}",
        "",
        f"> {advice}",
        "",
        "_Tests extraction only — assumes a perfect transcript. Whisper audio->text "
        "accuracy is a separate, untested risk._",
        "",
        "| # | Phrase | Expected | Got | Result | Note |",
        "|---|--------|---------:|----:|:------:|------|",
    ]
    for r in rows:
        phrase = r["phrase"] if len(r["phrase"]) <= 70 else r["phrase"][:67] + "..."
        note = r["ambiguous"] or ""
        result = "PASS" if r["ok"] else "FAIL"
        md.append(
            f"| {r['i']} | {phrase} | £{r['expected']:.2f} | £{r['got']:.2f} | {result} | {note} |"
        )
    md += [
        "",
        "### How to read a FAIL",
        "Rows marked with a note are *ambiguous* — more than one defensible reading. "
        "A fail there usually means the model picked a sensible alternative, which is "
        "exactly why read-back is mandatory in the spec. Score the *non-ambiguous* "
        "fails harder; those are real extraction misses.",
    ]
    with open(OUTPUT, "w") as f:
        f.write("\n".join(md) + "\n")
    print(f"\nWritten: {OUTPUT}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
VibeCount — Validation Gate v2 (refuse-to-guess).

WHAT CHANGED FROM v1
  v1 forced the model to always emit one confident number. The two model runs
  proved that on ambiguous phrases ("eight fifty", "a ton", "eleven nine nine
  nine") different models confidently pick DIFFERENT readings — i.e. the answer
  isn't in the words. So v2:
    1. The prompt now returns `amount_ambiguous` + `amount_candidates`. On a
       genuinely ambiguous amount it FLAGS instead of silently guessing.
    2. Scoring changes:
         - EXACT rows  -> pass = correct amount AND not flagged.
         - AMBIGUOUS rows -> pass = correctly FLAGGED (the specific number it
           guesses does not matter; catching the ambiguity does).
    3. The report calls out two failure types separately:
         - MISSED FLAG  = ambiguous amount it did NOT flag  -> DANGEROUS.
         - OVER-FLAG    = exact amount it flagged anyway     -> safe but annoying.

STILL EXTRACTION ONLY. Whisper audio->text accuracy is a separate, untested risk.

USAGE
  export ANTHROPIC_API_KEY=sk-ant-...
  pip install anthropic
  python validation_gate_v2.py
  # optional: VIBECOUNT_MODEL=claude-haiku-4-5-20251001 python validation_gate_v2.py

NOTE: the SYSTEM_PROMPT below is the real product prompt. Lift it straight into
Hero Feature 1 once you're happy with the numbers.
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
MODEL = os.environ.get("VIBECOUNT_MODEL", "claude-sonnet-4-6")
MAX_RETRIES = 3
RETRY_BACKOFF = 2.0
DELAY_BETWEEN = 0.3
OUTPUT = "validation-result-v2.md"

# ── REFUSE-TO-GUESS SYSTEM PROMPT (this is the product prompt) ─────────────────
SYSTEM_PROMPT = """You are a financial data extraction agent for a UK invoicing app used by people who may be dyslexic or dyscalculic. Your job is to turn a spoken transcript into structured JSON. Getting an amount WRONG is far worse than admitting it is unclear.

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

EXAMPLE (clear):
{"client":"Simon","description":"projection mapping","amount":850.00,"amount_ambiguous":false,"amount_candidates":[]}

EXAMPLE (ambiguous):
{"client":"the Burns Trust","description":"mausoleum mapping","amount":850.00,"amount_ambiguous":true,"amount_candidates":[850.00,8.50]}"""

# ── TEST SUITE ─────────────────────────────────────────────────────────────────
# kind: "exact"     -> must return `amount` and NOT flag.
#       "ambiguous" -> must FLAG (amount_ambiguous=true); number guessed doesn't matter.
#                      `candidates` lists the readings we'd accept seeing.
TESTS = [
    {"phrase": "Invoice Simon eight hundred and fifty pounds for projection mapping", "kind": "exact", "amount": 850.00},
    {"phrase": "Invoice Becca eight pounds fifty for parking", "kind": "exact", "amount": 8.50},
    {"phrase": "Invoice the museum eight and a half thousand for the install", "kind": "exact", "amount": 8500.00},
    {"phrase": "Invoice Jade twelve forty nine ninety five for consultancy", "kind": "exact", "amount": 1249.95},
    {"phrase": "Invoice Sahjan two grand for filming", "kind": "exact", "amount": 2000.00},
    {"phrase": "quick invoice for elinor fifty five quid for sound design", "kind": "exact", "amount": 55.00},
    {"phrase": "bill nottingham contemporary three point five k for the av handover", "kind": "exact", "amount": 3500.00},
    {"phrase": "charge dj climate twenty two fifty for studio time", "kind": "ambiguous", "candidates": [22.50, 2250.00]},
    {"phrase": "send an invoice to lucy for five hundred quid for the walking tour app", "kind": "exact", "amount": 500.00},
    {"phrase": "bill mansfield town three fifty for the match poster design", "kind": "ambiguous", "candidates": [3.50, 350.00]},
    {"phrase": "invoice taco twelve hundred and sixty five pounds and forty pence for the livestream", "kind": "exact", "amount": 1265.40},
    {"phrase": "charge the council twenty five hundred for the public art project", "kind": "exact", "amount": 2500.00},
    {"phrase": "uh yeah invoice um vibe anything for like six and a half k for the brand copy", "kind": "exact", "amount": 6500.00},
    {"phrase": "bill kitface eleven nine nine nine for api consulting", "kind": "ambiguous", "candidates": [11999.00, 1199.90, 1199.00]},
    {"phrase": "invoice the gallery one twenty five for the pottery cups", "kind": "ambiguous", "candidates": [1.25, 125.00]},
    {"phrase": "send a bill to the burns trust for eight fifty for the mausoleum mapping", "kind": "ambiguous", "candidates": [8.50, 850.00]},
    {"phrase": "charge the allotment committee forty seven dot five for the polytunnel pipes", "kind": "exact", "amount": 47.50},
    {"phrase": "invoice the garage thirty three pounds and a third... wait make it exactly thirty three thirty three for the citroen suspension fix", "kind": "exact", "amount": 33.33},
    {"phrase": "bill the hardware store a ton for the split shaft multi tool repair", "kind": "exact", "amount": 100.00},
    {"phrase": "invoice simon raven one four two two point five zero for the festival gig", "kind": "exact", "amount": 1422.50},
]


# ── HELPERS ────────────────────────────────────────────────────────────────────
def parse_amount(value):
    if isinstance(value, (int, float)):
        return round(float(value), 2)
    s = str(value).strip().replace("£", "").replace(",", "").replace(" ", "")
    return round(float(s), 2)


def as_bool(value):
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("true", "1", "yes")


def parse_json(text):
    """Strip fences and decode the FIRST valid JSON object (ignores trailing prose)."""
    t = text.strip()
    t = re.sub(r"^```(?:json)?", "", t).strip()
    t = re.sub(r"```$", "", t).strip()
    start = t.find("{")
    if start != -1:
        t = t[start:]
    obj, _ = json.JSONDecoder().raw_decode(t)
    return obj


def extract(client, phrase):
    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = client.messages.create(
                model=MODEL, max_tokens=400, system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": phrase}],
            )
            text = "".join(b.text for b in resp.content if b.type == "text")
            return parse_json(text)
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_BACKOFF * (2 ** attempt))
    raise last_err


# ── MAIN ───────────────────────────────────────────────────────────────────────
def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("Set ANTHROPIC_API_KEY before running.")
    client = Anthropic()
    print(f"Model: {MODEL}\nRunning {len(TESTS)} tests (refuse-to-guess)...\n")

    rows, errors = [], []
    for i, t in enumerate(TESTS, 1):
        try:
            obj = extract(client, t["phrase"])
            got = parse_amount(obj.get("amount"))
            flagged = as_bool(obj.get("amount_ambiguous", False))
            cands = obj.get("amount_candidates", []) or []
            try:
                cands = [parse_amount(c) for c in cands]
            except Exception:  # noqa: BLE001
                cands = []

            if t["kind"] == "exact":
                ok = (got == round(t["amount"], 2)) and not flagged
                if got != round(t["amount"], 2):
                    status = "FAIL"          # wrong number
                elif flagged:
                    status = "OVERFLAG"      # right number but flagged (safe, annoying)
                else:
                    status = "PASS"
            else:  # ambiguous
                ok = flagged
                status = "PASS" if flagged else "MISSFLAG"  # MISSFLAG = dangerous

            rows.append({"i": i, "phrase": t["phrase"], "kind": t["kind"],
                         "got": got, "flagged": flagged, "cands": cands,
                         "status": status, "ok": ok,
                         "expected": t.get("amount"), "candidates": t.get("candidates")})
            mark = {"PASS": "PASS", "FAIL": "FAIL", "OVERFLAG": "over-flag", "MISSFLAG": "MISSED FLAG"}[status]
            print(f"[{i:2}] {t['kind']:9} {mark:11} got £{got:<9.2f} flagged={flagged}")
        except Exception as e:  # noqa: BLE001
            errors.append({"i": i, "err": str(e)})
            print(f"[{i:2}] ERR  {e}")
        time.sleep(DELAY_BETWEEN)

    print()
    if errors:
        with open(OUTPUT, "w") as f:
            f.write("# Validation Gate v2 — NO RESULT\n\n"
                    f"**{len(errors)}/{len(TESTS)} rows errored. No verdict issued.**\n\n"
                    + "\n".join(f"- Row {e['i']}: `{e['err']}`" for e in errors) + "\n")
        print(f"{len(errors)} error(s) — NO recommendation. See {OUTPUT}.")
        sys.exit(1)

    exact = [r for r in rows if r["kind"] == "exact"]
    amb = [r for r in rows if r["kind"] == "ambiguous"]
    exact_pass = sum(1 for r in exact if r["status"] == "PASS")
    over = [r for r in exact if r["status"] == "OVERFLAG"]
    exact_fail = [r for r in exact if r["status"] == "FAIL"]
    amb_caught = sum(1 for r in amb if r["ok"])
    missed = [r for r in amb if not r["ok"]]

    exact_pct = round(100 * exact_pass / len(exact)) if exact else 0
    catch_pct = round(100 * amb_caught / len(amb)) if amb else 0

    # Recommendation: the safety-critical metric is the ambiguity catch rate.
    # [Speculation] thresholds are judgement calls — founder sets the final line.
    if catch_pct >= 80 and exact_pct >= 90:
        band = "VOICE-HERO (safe)"
        advice = "Clean amounts extract reliably AND ambiguous ones get flagged for read-back to catch. Build voice-first."
    elif catch_pct >= 80:
        band = "VOICE-VIABLE, tighten exact extraction"
        advice = "Ambiguity flagging is solid (the safety bit works), but exact extraction needs work. Fix the exact fails, then ship voice."
    elif catch_pct >= 50:
        band = "NOT SAFE YET"
        advice = "Too many ambiguous amounts slip through unflagged. Read-back can't catch what isn't flagged. Tighten the prompt before voice ships."
    else:
        band = "TYPING-HERO"
        advice = "The model rarely flags ambiguity, so confident-wrong numbers would reach users. Ship typing-first; treat voice as beta."

    print(f"EXACT extraction:   {exact_pass}/{len(exact)} = {exact_pct}%  (+{len(over)} over-flagged, {len(exact_fail)} wrong)")
    print(f"AMBIGUITY caught:   {amb_caught}/{len(amb)} = {catch_pct}%")
    print(f"MISSED FLAGS (danger): {len(missed)}")
    print(f"\nRECOMMENDATION: {band}\n{advice}")

    # ── Report ──
    md = [
        "# VibeCount Validation Gate v2 — Result (refuse-to-guess)",
        "",
        f"**Model:** {MODEL}  ",
        f"**Exact extraction:** {exact_pass}/{len(exact)} = **{exact_pct}%** "
        f"({len(over)} over-flagged, {len(exact_fail)} wrong)  ",
        f"**Ambiguity caught:** {amb_caught}/{len(amb)} = **{catch_pct}%**  ",
        f"**Missed flags (dangerous):** **{len(missed)}**  ",
        f"**Recommendation:** {band}",
        "",
        f"> {advice}",
        "",
        "_Extraction only — assumes a perfect transcript. Whisper accuracy untested._",
        "",
        "The safety-critical number is **ambiguity caught**: a flagged amount can be "
        "stopped at read-back; an unflagged wrong amount cannot. A **missed flag** is "
        "the one genuinely dangerous outcome for dyscalculic users.",
        "",
        "| # | Kind | Phrase | Got | Flagged | Candidates | Result |",
        "|---|------|--------|----:|:-------:|------------|:------:|",
    ]
    label = {"PASS": "PASS", "FAIL": "FAIL (wrong)", "OVERFLAG": "over-flag (safe)", "MISSFLAG": "MISSED FLAG ⚠"}
    for r in rows:
        ph = r["phrase"] if len(r["phrase"]) <= 56 else r["phrase"][:53] + "..."
        cand = ", ".join(f"£{c:.2f}" for c in r["cands"]) if r["cands"] else "—"
        md.append(f"| {r['i']} | {r['kind']} | {ph} | £{r['got']:.2f} | {r['flagged']} | {cand} | {label[r['status']]} |")
    with open(OUTPUT, "w") as f:
        f.write("\n".join(md) + "\n")
    print(f"\nWritten: {OUTPUT}")


if __name__ == "__main__":
    main()

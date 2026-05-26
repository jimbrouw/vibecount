# VibeCount Validation Gate v2 — Result (refuse-to-guess)

**Model:** claude-sonnet-4-6  
**Exact extraction:** 14/15 = **93%** (1 over-flagged, 0 wrong)  
**Ambiguity caught:** 5/5 = **100%**  
**Missed flags (dangerous):** **0**  
**Recommendation:** VOICE-HERO (safe)

> Clean amounts extract reliably AND ambiguous ones get flagged for read-back to catch. Build voice-first.

_Extraction only — assumes a perfect transcript. Whisper accuracy untested._

The safety-critical number is **ambiguity caught**: a flagged amount can be stopped at read-back; an unflagged wrong amount cannot. A **missed flag** is the one genuinely dangerous outcome for dyscalculic users.

| # | Kind | Phrase | Got | Flagged | Candidates | Result |
|---|------|--------|----:|:-------:|------------|:------:|
| 1 | exact | Invoice Simon eight hundred and fifty pounds for proj... | £850.00 | False | — | PASS |
| 2 | exact | Invoice Becca eight pounds fifty for parking | £8.50 | False | — | PASS |
| 3 | exact | Invoice the museum eight and a half thousand for the ... | £8500.00 | False | — | PASS |
| 4 | exact | Invoice Jade twelve forty nine ninety five for consul... | £1249.95 | True | £1249.95, £12.49, £125.00 | over-flag (safe) |
| 5 | exact | Invoice Sahjan two grand for filming | £2000.00 | False | — | PASS |
| 6 | exact | quick invoice for elinor fifty five quid for sound de... | £55.00 | False | — | PASS |
| 7 | exact | bill nottingham contemporary three point five k for t... | £3500.00 | False | — | PASS |
| 8 | ambiguous | charge dj climate twenty two fifty for studio time | £22.50 | True | £22.50, £2250.00 | PASS |
| 9 | exact | send an invoice to lucy for five hundred quid for the... | £500.00 | False | — | PASS |
| 10 | ambiguous | bill mansfield town three fifty for the match poster ... | £350.00 | True | £350.00, £3.50 | PASS |
| 11 | exact | invoice taco twelve hundred and sixty five pounds and... | £1265.40 | False | — | PASS |
| 12 | exact | charge the council twenty five hundred for the public... | £2500.00 | False | — | PASS |
| 13 | exact | uh yeah invoice um vibe anything for like six and a h... | £6500.00 | False | — | PASS |
| 14 | ambiguous | bill kitface eleven nine nine nine for api consulting | £11999.00 | True | £11999.00, £1199.90, £119.99 | PASS |
| 15 | ambiguous | invoice the gallery one twenty five for the pottery cups | £125.00 | True | £125.00, £1.25 | PASS |
| 16 | ambiguous | send a bill to the burns trust for eight fifty for th... | £850.00 | True | £850.00, £8.50 | PASS |
| 17 | exact | charge the allotment committee forty seven dot five f... | £47.50 | False | — | PASS |
| 18 | exact | invoice the garage thirty three pounds and a third...... | £33.33 | False | — | PASS |
| 19 | exact | bill the hardware store a ton for the split shaft mul... | £100.00 | False | — | PASS |
| 20 | exact | invoice simon raven one four two two point five zero ... | £1422.50 | False | — | PASS |

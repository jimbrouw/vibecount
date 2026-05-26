# VibeCount Validation Gate — Result

**Model:** claude-sonnet-4-6  
**Score (amount field only):** 18/20 = **90%**  
**Recommendation:** VOICE-HERO

> Amount accuracy >= 90%. Build voice-first as specced. Read-back stays mandatory.

_Tests extraction only — assumes a perfect transcript. Whisper audio->text accuracy is a separate, untested risk._

| # | Phrase | Expected | Got | Result | Note |
|---|--------|---------:|----:|:------:|------|
| 1 | Invoice Simon eight hundred and fifty pounds for projection mapping | £850.00 | £850.00 | PASS |  |
| 2 | Invoice Becca eight pounds fifty for parking | £8.50 | £8.50 | PASS |  |
| 3 | Invoice the museum eight and a half thousand for the install | £8500.00 | £8500.00 | PASS |  |
| 4 | Invoice Jade twelve forty nine ninety five for consultancy | £1249.95 | £1249.95 | PASS |  |
| 5 | Invoice Sahjan two grand for filming | £2000.00 | £2000.00 | PASS |  |
| 6 | quick invoice for elinor fifty five quid for sound design | £55.00 | £55.00 | PASS |  |
| 7 | bill nottingham contemporary three point five k for the av handover | £3500.00 | £3500.00 | PASS |  |
| 8 | charge dj climate twenty two fifty for studio time | £22.50 | £2250.00 | FAIL | could read as £2,250 |
| 9 | send an invoice to lucy for five hundred quid for the walking tour app | £500.00 | £500.00 | PASS |  |
| 10 | bill mansfield town three fifty for the match poster design | £350.00 | £350.00 | PASS | could read as £3.50 |
| 11 | invoice taco twelve hundred and sixty five pounds and forty pence f... | £1265.40 | £1265.40 | PASS |  |
| 12 | charge the council twenty five hundred for the public art project | £2500.00 | £2500.00 | PASS |  |
| 13 | uh yeah invoice um vibe anything for like six and a half k for the ... | £6500.00 | £6500.00 | PASS |  |
| 14 | bill kitface eleven nine nine nine for api consulting | £11999.00 | £11999.00 | PASS | could read as £1,199.90 |
| 15 | invoice the gallery one twenty five for the pottery cups | £125.00 | £125.00 | PASS | could read as £1.25 |
| 16 | send a bill to the burns trust for eight fifty for the mausoleum ma... | £850.00 | £8.50 | FAIL | PROMPT CONFLICT: the system prompt explicitly says 'eight fifty' = 8.50 |
| 17 | charge the allotment committee forty seven dot five for the polytun... | £47.50 | £47.50 | PASS |  |
| 18 | invoice the garage thirty three pounds and a third... wait make it ... | £33.33 | £33.33 | PASS |  |
| 19 | bill the hardware store a ton for the split shaft multi tool repair | £100.00 | £100.00 | PASS | 'a ton' = £100 slang |
| 20 | invoice simon raven one four two two point five zero for the festiv... | £1422.50 | £1422.50 | PASS |  |

### How to read a FAIL
Rows marked with a note are *ambiguous* — more than one defensible reading. A fail there usually means the model picked a sensible alternative, which is exactly why read-back is mandatory in the spec. Score the *non-ambiguous* fails harder; those are real extraction misses.

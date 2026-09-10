# Whisper Sub-Gate

Run this before voice invoice creation is available to production users.

## Pass condition

- Use at least 20 real spoken invoice phrases from the founder or target users.
- Run the full pipeline: audio file -> Whisper transcription -> validated extraction prompt -> invoice draft.
- Pass only if at least 90% of extracted amounts match the expected amount in pence.
- If the gate fails, keep voice behind typed invoice creation.

## Test phrases

Create a private CSV that is not committed:

```csv
file,expected_amount_pence,notes
voice-gate-01.m4a,85000,"eight fifty"
voice-gate-02.m4a,250000,"two and a half grand"
```

Include varied phrasing:

- pounds and pence
- casual shorthand, such as "eight fifty" and "a ton"
- pauses, corrections, and background noise
- client names and project descriptions around the amount

## Manual run sheet

For each phrase, record:

- source audio filename
- Whisper transcript
- extracted amount in pence
- expected amount in pence
- pass/fail
- notes on ambiguity

The gate is complete when the pass rate is documented and any ambiguous amount cases hard-stop for user selection.

## Score the gate

After running each recording through the full pipeline, save the results in a private CSV:

```csv
file,expected_amount_pence,extracted_amount_pence,notes
voice-gate-01.m4a,85000,85000,"eight fifty"
voice-gate-02.m4a,250000,250000,"two and a half grand"
```

Then score it:

```bash
npx tsx scripts/score-whisper-gate.ts private/whisper-gate-results.csv
```

The script exits successfully only when there are at least 20 rows and amount accuracy is at least 90%.

# 2025/26 draft form mapping review

Engineering source check, 18 October 2026. This checks the populated draft worksheet routes against published 2026 forms; independent tax review and the user's evidence remain outstanding.

| Source | Checked mapping |
| --- | --- |
| [SA100, TR4](https://assets.publishing.service.gov.uk/media/69c14d07cfa346b9d4704a8d/SA100-2026.pdf) | Gross relief-at-source contributions: 1; one-off subset: 1.1. Actual Gift Aid payments: 5; one-off subset: 6. Paper income/expense rounding remains separate from exact calculations. |
| [SA102, E1](https://assets.publishing.service.gov.uk/media/69bd6a7a7e02b81c0d1c75ae/SA102-2026.pdf) | Employment pay: 1; PAYE tax: 2. Employment identity and separate job pages still require original evidence. |
| [SA101, Ai2](https://assets.publishing.service.gov.uk/media/69c25b9ab920af63be1c770c/SA101_2026.pdf) | Reviewed taxable redundancy component: 5; separate withholding: 6; evidenced exempt component: 9. This does not establish that any particular termination payment qualifies. |
| [SA103S](https://assets.publishing.service.gov.uk/media/69c12ae013101e9908704a53/SA103S-2026.pdf) | Turnover 9, allowance 10.1, expenses 20, accounting profit/loss 21/22, net tax profit/loss 28/32, taxable profit 31. |
| [SA103F](https://assets.publishing.service.gov.uk/media/69c2635b13101e9908704b36/SA103F_2026.pdf) | Turnover 15, allowance 16.1, expense groups 17–30 and total 31, add-backs 46, accounting profit/loss 47/48, capital total 57, net tax profit/loss 64/65, adjusted profit/loss 73/77, taxable profit 76. |
| [Short-form notes](https://assets.publishing.service.gov.uk/media/69ce15395cf899414a0bc69f/SA103S_Notes_2026.pdf) | The £90,000 threshold is exclusive; partial-year annualisation and listed complications can require the full form. The current explicit full-year/simple eligibility restriction remains. |

## Corrected defect

The accounting loss line already used a positive loss magnitude. Later net/adjusted tax lines incorrectly placed negative amounts into profit boxes. Mapping `uk-draft-forms-2025-26/2` now routes those lines to the separate loss boxes and retains positive magnitudes. For example, £1 income against £189.09 expenses produces a £188.09 candidate loss at short box 32, not −£188.09 at profit box 28.

This does not elect loss relief, claim a carry-back or carry-forward, or invent zero taxable profit. The calculation continues to report the unresolved loss treatment, completeness remains blocked, and paper loss values require review. Mapping v2 changes current input-v6 review digests; earlier input contracts reconstruct with v1, and retained packs keep their frozen mapping and artifact bytes. No migration rewrites their contents.

Verification: 22 focused filing checks passed, including short/full loss routing, blocked completeness, frozen predecessor artifact hashes, current SQL capture, source availability and download routes. TypeScript and targeted lint are checked separately. The first compatibility run caught global mapping selection invalidating old review digests; selecting the mapping by input contract resolved that failure without changing the frozen fixtures.

Remaining mapping work includes unsupported income/adjustment branches, full-form disallowable allocation and substitutions, actual employer details, annual form eligibility, paper-arithmetic reconciliation, and independent tax review. Checked box numbers alone do not establish a complete or filing-ready return.

## Trading allowance follow-up

Mapping v3 retains the loss correction and leaves expense-total boxes unpopulated when a reviewed trading allowance is selected in current input-v6 drafts. It also omits the full-form zero capital-total line when no capital allowance exists. The [short-form notes, SESN 4](https://assets.publishing.service.gov.uk/media/69ce15395cf899414a0bc69f/SA103S_Notes_2026.pdf) exclude boxes 11–20 under this election; the [full-form notes, SEFN 5](https://assets.publishing.service.gov.uk/media/69c26565cfa346b9d4704b35/SA103F_Notes_2026.pdf) exclude boxes 17–31. Original expenses stay in the evidence-linked ledger, and the calculation retains their audit total without deducting them alongside the allowance.

Fourteen focused checks passed, including both form choices, retained actual costs, independent expected taxable profit, and exact frozen predecessor artifact reconstruction. Eligibility for the allowance remains an evidence review; this presentation correction does not grant eligibility or resolve connected-party receipts, loss carry-forwards or Income Tax/NI differences.

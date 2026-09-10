# CONTEXT.md — VibeCount Personal

## Why this exists

Jim (Vibe Anything / T-Bone Productions, Nottingham) invoices as a UK freelancer. Full VibeCount is a product concept (accessibility-first invoicing for dyslexic/dyscalculic freelancers). This repo is the PERSONAL version: Jim as the only user, zero running costs, local-first. It also acts as a live testbed for the product's core safety idea.

## Decisions already made upstream (do not reopen)

- No Supabase / no backend. Single SQLite file in a synced folder.
- No in-app audio. Jim's system-level Whisper Flow dictation types into a textbox; the app only ever sees text.
- Extraction prompt is validated (93% exact, 100% ambiguity caught on Sonnet; ~85% exact on Haiku). Default model Haiku for cost; the read-back gate is the safety net. Prompt is frozen in SPEC.md §6.
- Mandatory read-back confirm before any save. Voice/typed paths converge there.
- Money = integer pence internally, always.
- Guiding principle carried over from the product PRD: if automation reduces understanding, remove it.

## Known risks / open items

- [VERIFY] Statutory late-payment interest bands and the 8% + base rate figure must be checked on gov.uk before Jim relies on generated figures. UI copy must keep the "check gov.uk" line.
- VAT: spec assumes Jim is NOT VAT registered. If wrong, stop before Evening 2 and flag.
- Restore-from-JSON-backup is deliberately Phase 2.
- Glossary feature deliberately cut from personal v1.

## Phase 2 parking lot

Glossary, payment terms decoder (paste client terms → plain-English due date), voice expense notes, JSON restore, dyscalculia-safe `<Money>` component extracted as open-source library, mobile.
---

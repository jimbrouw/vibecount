# Reviewed FX actions and recovery plan

Continue the full handover after dependency review. Reuse current dimensioned writers, catalogs, complete retained portions, provenance exports and request fingerprints. No real financial approval or hosted migration is authorized by local implementation work.

## Architecture decision

The existing invoice-source-read V2 proof is specific to canonical invoice capture. It neither reads conversion bytes nor binds an allocation request. Before public financial activation, add a private service-authored proof of both selected invoice and conversion facts/documents, bound to the complete normalized FX settlement intent. Keep original invoice-read contracts, financial writers and grants unchanged.

1. Add an immutable owner-scoped FX source-check table and private context/record helpers. A check binds exact normalized intent, request, safe fact/document snapshots, verified/unavailable outcome and server time. Deduplicate object downloads while retaining every fact binding. Recover exact prior checks before reading mutable sources; failed/uncertain audit responses never become a success claim. Proofs never store plaintext, keys or paths.
2. Verify original encrypted bytes only inside server modules using recorded keys, owner/path checks, exact size/hash and existing signature checks. Do not mistake this for semantic/readability certification; human reviewed facts remain required. Validate source snapshots and financial freshness again when recording verified proof, under existing owner locks and source-table freezes.
3. Add narrow reviewed financial wrappers after proof/recovery verification. Keep private cores ungranted. New approval must require fresh verified proof for the exact intent; current context/versions/capacities remain transactional SQL checks. Exact retained financial requests recover first through unchanged core fingerprints. Complete-lot reversal needs retained portions/stamp, no new source-availability proof.
4. Add strict financial-result parsers, authenticated server actions, pending UI and durable owned request recovery. An uncertain response must retain the same request/intent and offer checking/retrying it; never silently mint a replacement request. Keep client review amounts, evidence and confirmation reset explicit. Activation is incomplete until both approval and complete reversal/recovery are reviewable and verified.
5. Prove ordered upgrade compatibility, owner/grant boundaries, missing/foreign/withdrawn/tampered evidence, source and financial drift, exact proof and financial retries, zero-cash portions, multi-document/multi-invoice requests, complete release, export/source/filing parity and native behavior. Use disposable SQL, encrypted synthetic evidence, independent lock tests and inert browser actions.

## Historical first implementation boundary

Implement and verify the private full-intent source-check prerequisite first. Financial saves and writer grants remain disabled until the coordinated wrappers, actions and durable recovery journey above are complete. This is an incremental prerequisite, not completion of reviewed FX financial actions or the wider handover.


Current prerequisite: [private full-intent source checks](fx-settlement-source-checks.md), migration `19070000`, implements the first two steps locally. It retains the safe exact intent needed by subsequent durable request recovery and introduces no financial grant. Steps 3–5 remain required; current saves are disabled. A recovered verified check is historical and must not bypass the future approval wrapper's fresh proof/current source checks.


## Current local implementation checkpoint

Migration `19070000` completed the private source-proof prerequisite. Migration `19080000` now implements the coordinated reviewed wrappers, frozen read-back, separate final human confirmation, owner-scoped durable recovery and cancellation. Private cores remain ungranted; authenticated commit is available only through the new reviewed wrapper. Steps 3–5 above have local automated/browser/SQL-race verification, documented in [reviewed-fx-actions.md](reviewed-fx-actions.md). Earlier disabled-save statements describe the prerequisite checkpoint, not current application behavior. Hosted migration/grants, representative signed-in acceptance and large-history validation remain release gates.

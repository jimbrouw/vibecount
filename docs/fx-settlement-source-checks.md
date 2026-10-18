# Private FX settlement source checks

Migration `20261019070000_fx_settlement_source_checks.sql` adds a private prerequisite for reviewed FX approval. It creates no financial events, approvals, recognised postings or public financial action. At this prerequisite checkpoint FX financial save buttons remained disabled. The original financial cores remain ungranted; subsequent [reviewed FX actions](reviewed-fx-actions.md) add narrow authenticated wrappers and final human confirmation.

## Why a separate proof

Existing invoice source-read V1/V2 verifies invoice evidence; V2 binds canonical invoice capture. Neither checks conversion-document bytes or binds the later financial request. Reusing those proofs would omit one of the selected financial sources. The new proof covers the complete normalized `fx-settlement-intent/1`: exact request, owner, receipt/decision, canonical revisions, fact families/revisions, proposed or retained lot/head, rate/date, original/cash portions, rationale and financial stamp.

`fx_settlement_source_checks` retains immutable intent, deterministically sorted fact/document source snapshots, verified/unavailable outcome, author and server timestamp. It has owner-only authenticated reads, service reads, no caller table writes, and service-only `record_fx_settlement_source_check` execution. The source/context and explicit-owner stamp helpers stay private. No raw file bytes, filenames, unredacted bank identifiers, object paths or encryption keys enter proof payloads.

## Fresh verification and recovery

`checkSettlementSources` validates the complete authoritative settlement read-back before selecting the exact invoice and conversion facts. It retains every fact binding and cross-checks conversion parent family/document and receipt/version against the separately selected invoice proof. Documents with the same identity/hash/size/type are decrypted once; distinct documents are each checked. The server-only adapter owner-filters all private queries, validates metadata/path before object access, loads the recorded key, checks encrypted size and authenticated owner/hash context, then verifies plaintext hash/size and existing file signatures. Plaintext buffers and loaded key copies are wiped. The same common metadata and byte verifier still serves existing invoice checks.

A verified outcome means those bytes passed cryptographic and signature checks at that time. It does not certify human readability, evidence meaning, financial treatment, authenticity or continued object availability. Human reviewed facts remain required.

Source failure produces an unavailable outcome. Missing/failed history, invalid context, failed or uncertain audit response, or a contradictory recorded result never produces a claimed success. Exact prior checks recover before catalog, keys or objects are read; changed full intent rejects, and an unavailable outcome cannot be upgraded under the same request ID. A recovered verified proof is historical. Future financial approval must independently require freshness and current exact sources; calling this recovery function alone cannot authorize a settlement.

The service recorder SQL normalizes the full intent independently, acquires the existing owner reconciliation lock, recovers exact checks first, freezes canonical/receipt/record/lot/settlement/fact/document/registration/object tables, and compares complete source snapshots. Verified proofs require current reviewed facts/canonical revision and an exact owner-derived financial stamp. The private evidence stamp copies the current public body and changes only owner binding plus the existing parity-tested explicit-owner financial base; public OID/body/grants remain untouched. Recording proof itself changes no financial review stamp. Unavailable checks may preserve retained snapshots after source loss, without claiming currentness.

## Upgrade and verification

Apply the reviewed migration after all predecessors. No hosted migration was performed. Old source-check contracts, public functions, financial request fingerprints, event bytes and private writer grants are preserved. This table is additive; retaining its immutable audit history is preferable to destructive rollback.

Local verification: **608 automated tests and all 14 browser suites passed**, including the existing disabled-save contracts. Focused real SQL verifies ordered upgrade/OIDs, two-owner stamp parity with unrelated owner data, service recording with no user JWT, unchanged financial records and zero settlements/financial requests, actual encrypted evidence, selected fact closure, wrong/missing sources, stale stamp, exact source-loss recovery and owner/role/grant boundaries. Independent native connections prove exact proof retry serialization and object deletion/recognised-record mutation conflicts in both orders, with privileged competing writers that actually reach the locks. The native suite passed 36 checks. A multi-invoice model case retains all four fact bindings while reading their shared object once. Model/composed-server tests cover distinct versus shared documents, safe projection, metadata-before-download, key wiping, tampered bytes, audit uncertainty and malformed retained proofs.

Run `npx tsx scripts/demo-fx-settlement-source-check.ts` for `/tmp/vibecount-fx-settlement-source-demo/source-proof.json`. Actual disposable SQL and synthetic encrypted evidence retain both fact bindings for KWD 0.001 / GBP 0.00, read their shared object once, preserve exact recovery after object loss and record a separate unavailable check. Recognised records remain unchanged, and financial event/request counts stay zero.

Hosted Auth/PostgREST/Storage behavior, large-history/large-document performance and representative human evidence review remain unproven. Metadata table locks cannot freeze external object bytes indefinitely. Source checks are not an evidence retention/restore system.

Lint, standalone TypeScript, secret/whitespace checks and a clean production build passed. Anonymous production smoke redirected FX review pages to login and denied reconciliation export access; the temporary server was stopped.

## Subsequent reviewed activation

Complete the coordinated reviewed financial wrappers, strict result parsers, human-confirmed server actions, pending states and durable owner-scoped request recovery in [the action plan](fx-reviewed-action-plan.md). Approval must require a fresh exact private proof, while retained financial retries recover through the original SQL fingerprint before current sources. Reversal must use complete retained portions and remain possible after source loss. These now work together locally through migration `19080000`; see [reviewed-fx-actions.md](reviewed-fx-actions.md) for current verification and remaining hosted acceptance. This prerequisite does not complete reviewed FX actions or the full Finance OS handover.

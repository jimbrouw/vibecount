# Reviewed preserved external invoices

18 October 2026. Local implementation; no hosted migration or real approval. Document capture does not enable financial FX settlement.

## Review and capture

`/dashboard/reconciliation/fx/invoices` reuses canonical `invoices`, immutable `invoice_revisions`, reviewed FX document facts and private retained-source verification. Select a current verified invoice fact, owned client and reason; review exact original-currency figures/words, date, reference, family, revision and hash. Both original-read attestation and final confirmation are required. Fact/client/reason/context changes reset both. A missing client can be created through a separate reviewed metadata-only form.

The cookie-authenticated action bounds exact transport and reconstructs the authoritative owned catalog. A private source check decrypts real retained bytes with their recorded key and owner/hash context. Capture-bound source-read intent v2 includes the complete canonical intent: client/identity/family/source, expected version/time/stamp, original hash, attestation and reason. Standalone v1 checks remain historical evidence and cannot authorize capture. No plaintext, ciphertext, object path, filename, key or signed URL enters this form or its payload.

A private byte check proves authenticated bytes, size/hash and a supported signature at that moment. Human semantic review remains separate. It does not prove full PDF rendering or continued availability.

## Database boundary

Migration `20261018230000_reviewed_external_invoices.sql` follows the full predecessor chain (63 local migrations, 38 untracked additions at this checkpoint). It broadens canonical invoice representation only alongside explicit origin, proof and immutable-history guards:

- Native GBP amounts, generated PDFs/VAT snapshots, existing revisions and historical request recovery retain their meaning.
- Preserved external documents use positive original minor units, immutable currency rules and a separate positive external revision. Their compatibility GBP amount and native PDF/VAT fields are null. Supported original currencies are GBP, USD, EUR, JPY and KWD; external GBP is still external.
- One canonical identity belongs to one source-fact family. Correction requires a strictly newer current verified invoice fact, the same family and exact prior canonical version/time. Each positive immutable revision retains its safe original snapshot, source revision, source-read receipt and request hash.
- Fresh proof must be verified, current, exact and no more than five minutes old. Direct owner/service writes, deletion, origin transitions and revision-zero/native-PDF history bypasses are rejected. Deferred constraints validate final invoice/history/request/proof closure at commit.
- Capture changes no income, expense, cash, settlement or GBP valuation. Existing native-only relationship guards reject external settlement, credits, returned-cash assignments and recognised records, including external GBP. Tax/filing/finance coverage remains unresolved for unsupported documents.
- Owner advisory locking serializes captures; NOWAIT table locks prevent stale source/client/canonical changes and lock-upgrade deadlocks. Current coarse table locks can temporarily reject unrelated-owner writes; handle as a fresh review/retry, not a partial success. Finer locking needs evidence and separate design.
- Exact recorded requests recover before current source/stamp/key/object checks. An uncertain response never becomes a competing request automatically. Recovery preserves history; it does not restore old eligibility. A verified source receipt can survive a rolled-back capture, but expired proof cannot authorize a fresh save.

## Verification and demo

The expanded ordered-SQL suite covers predecessor/native row and snapshot parity, old native request recovery, KWD capture and GBP/USD/JPY corrections, positive history, owner/anonymous/service grants, direct-write/delete/origin/history rejection, altered proof bindings, expiry/future proof, audit rollback, source withdrawal and historical recovery after object loss. Native independent connections prove same-request recovery, competing create/correction serialization, and object/client changes in both commit orders, with unchanged accounting counts.

Application tests bundle the actual action/store/private-source path with synthetic authenticated transports and real AES-GCM bytes. They cover strict form/auth/human gates, source failures, paged owned context, malformed heads/history, separate client review, rolled-back capture and uncertain committed-result recovery before live sources/keys. They do not replace hosted grants or Storage HTTP acceptance. Browser tests use actual components with inert actions: original-currency scales/read-back, create/correction, same-source rejection, both confirmation resets, pending state and bounded payloads. All are synthetic; no real financial approval is exercised.

Run `npx tsx scripts/demo-external-invoices.ts` for `/tmp/vibecount-external-invoice-demo`: actual ordered SQL and encrypted synthetic PDF-shaped bytes capture KWD 10.001, correct the same family to JPY 20001, preserve two sourced revisions and recover the original result after source loss. Native row/request parity holds; zero financial records and settlements are created. Only safe metadata is exported. This is not hosted Auth/PostgREST/Storage, human source review or rendered PDF acceptance.

## Remaining handover scope

Dimensioned conversion lots/valuations, independent original/cash/GBP capacities, cumulative rounding/zero-cash tranches, settlement/reversal/export parity, foreign accounts/fees/credits/refunds, complete tax integration, controlled evidence access/lifecycle/coordinated recovery, durable reviewed delivery, representative provider/hosted journeys and independent tax/form review remain required. The full Finance OS goal is active.

# Engineering notes

- Exercise database permissions as `authenticated` with a user claim. A superuser-only migration test does not verify RLS. Shared default categories have SELECT permission but no owner UPDATE policy; locking SELECTs can hide them under RLS.
- Keep import approval scoped to explicit IDs and review versions. Test rollback after a valid row has already been processed, not only validation before the first write.
- Tests use explicit `.ts` imports through `tsx`; with `noEmit`, preserve `allowImportingTsExtensions` when updating Next.js/TypeScript tooling.
- Dependency audit automatic fixes may suggest major downgrades. Patch compatible dependencies and record unresolved tooling chains rather than forcing those suggestions.
- Model Supabase default privileges in SQL tests. A column-only SELECT grant does not remove an inherited table-wide grant; explicitly revoke before granting restricted access.
- Preserve provenance on INSERT and null-to-value UPDATE transitions as well as updates to existing evidence. File identity columns must not be directly writable by authenticated clients.
- Serialize overlapping bank imports per account, then inspect fingerprints. File-scoped locking alone allows byte-different duplicate statements to race.
# Test-runner scheduling

On local Node 24.0.2, awaiting `t.test()` can resolve after scheduling rather than after the child callback has completed. Do not perform root fixture reads that depend on earlier child tests immediately after those awaits. Use `serialSubtest` from `lib/database/serial-subtest.ts` for shared-fixture child bodies, or explicitly await sequential scenario bodies. Keep assertions and dependent setup within that ordering; let parent cleanup follow completed bodies. Diagnose connection teardown separately from a PostgreSQL crash; never weaken concurrency assertions to accommodate a harness race.

- Query fixtures must honor requested keyset order and cursor semantics. Advance simulated before/after catalog drift once per complete catalog, not on its empty pagination sentinel; otherwise safety tests can fail for the wrong reason or miss drift entirely.
- Run standalone TypeScript after build-output preservation/recreation finishes. Moving `.next` during a type check invalidates generated include paths and produces a harness race rather than an application type error.

# Invoice evidence

- Distinguish a never-finalised draft from a historical finalised invoice when introducing immutable economics. Draft candidates can acquire their first VAT treatment; legacy finalised totals need verified evidence and must not inherit today's VAT defaults.
- Recover unchanged invoice retries from the immutable request/snapshot/PDF before consulting mutable settings. Preserve sent/paid/reminder metadata when publishing a financial revision, and compare both old and new finalisation state/timestamps in direct-write guards.
- Every path that changes reviewed form data, including autocomplete selection and refreshed server props, must clear or remount confirmation state.
- Capture invoice/customer details and balance under the same invoice version. A later balance read cannot validate earlier customer details; compare versions before claiming a reminder draft and store the post-scheduling version because scheduling itself changes `updated_at`.
- UI eligibility must use the same history predicate as database guards. Reversing active credits does not erase credit history or restore ordinary edit/reminder privileges.

# Signed corrections

- Recheck the reviewed financial stamp after every row-lock wait that can admit legacy/direct updates. An owner advisory lock only serializes cooperating writers; test a permitted direct invoice update in an independent connection. Exact completed retries still recover before mutable checks.
- A full import coordinator must track observations already reset by child reversal. Do not call the old unconditional import reset chain afterward; verify exactly one new decision per affected source and discard only the chosen import.

- Signed financial read-backs must use `signedAmountToWords`; the unsigned helper returns no words for negative pence. Include a negative profit/change browser case alongside positive cash totals.
- Shared-cash corrections must enumerate every child effect by relationship provenance and reset each observation once. Never use a scalar posting pointer to decide which unrelated record a connected reversal may exclude.
- When a bank observation has several retained postings, group and sum all approved effects; `Map(bankId, record)` silently keeps only one. Page child tables independently rather than assuming nested PostgREST arrays are complete. Keep physical cash year separate from selected posting year, retain every effect, and block unresolved timing.
- Choose income/expense bucket from the recognised posting, not bank cash direction. Supplier refunds reduce expenses; customer refunds reduce income. Update every nonparked report/export consumer when adding a sign.
- Partial mixed-use rounding is cumulative. If immutable reductions depend on the prior group, reversal must preserve that invariant explicitly; never silently recompute other approved events.
- A bank refund supplies its accounting effect once. Invoice-credit assignments change retained cash only; cap them independently by refund, receipt allocation and credit, and block parent reversals until their dependent assignments are explicitly reversed.
- Reversing a receipt allocation releases its full amount from matched cash, but credits can make the increase in outstanding smaller. Report the actual balance delta rather than reusing the released amount.

# Reviewed transaction identity

- Lock identity review against both owner financial decisions and account ingestion; the same fingerprint is a candidate, never authority to suppress a payment. Preserve legitimate identical rows.
- Never allow a retained source to be reversed while active aliases depend on it. Permit unlinking a discarded alias so recovery does not deadlock. Reversal leaves unresolved observations and never restores superseded approvals.
- Display direct links to every cohort observation and incoming identity decision so users can reach dependants beyond the global list's first page.

# Evidence recovery and rotation

- Persist confirmed registration intent before uploading. Recover only failed attempts unless a real worker/lease proves another state is stopped; age alone is not proof. State transitions must verify a matched row.
- Content dedupe and encrypted names have separate key provenance. Preserve a name's creating-attempt key instead of assuming it uses the retained content object's key.
- Supabase Storage HTTP status and service statusCode can differ. Recognize missing objects narrowly; never regenerate over permission, network or server failures.
- Recovery's read-back describes incremental effects: it approves zero new income/expenses and preserves existing treatment if another attempt already registered the same original. Resolve committed request replay again after a concurrent state change or lost response.

- The local Node 24.0.2 runtime has aborted inside V8 while many PGlite/WASM files and a build ran together. Verify the affected case alone, bound file-level test concurrency (currently two), then verify the complete suite. Keep native independent-connection race assertions enabled; a resource mitigation is not evidence of an upstream engine fix.

# Merchant review meaning

- Prefix PL/pgSQL local rule/version identifiers distinctly from selected table columns; migration replay alone cannot detect ambiguous names in branches not executed by tests. Exercise every approval path.
- Lock mutable category meaning before verifying a reviewed stamp. An owner reconciliation lock does not serialize a category rename performed through an older direct-write path. Native tests must hold the category row lock and verify stale approval rejects after commit.
- Immutable classification evidence state must not be edited to add attachments. Link separate application provenance to the exact transaction/version and preserve the original history.

# Reviewed tax facts

- Keep PAYE, pension contributions, redundancy and HMRC credits outside the trading ledger. Linked business effects create a visible overlap to resolve; never silently remove a posting.
- Completeness must be versioned separately from facts. Store both collection digests and the financial state reviewed by a profile; new facts or changed ledger inputs must make old confirmations stale.
- Withdrawal copies prior immutable source snapshots. Requiring a discarded import or excluded record to become active first prevents the correction needed to resolve stale provenance.
- Normalize safe payment references and retain physical identity across revisions; bank-backed capacity and human-transcribed document identity have different evidence strength. Document-only labels are not proof of distinct payments.
- PL/pgSQL function-name qualification covers parameters, not arbitrary local declarations. Use distinct local names or an explicit block label for locals that overlap selected columns, and execute every branch in actual SQL tests.

# Immutable tax calculations

- Scope declarations must bind the reviewed fact/financial digest. Keeping the same option string after adding another employment does not prove the new totals were checked.
- A definer reader must filter foreign related metadata in its JOIN, even when the owning record is valid. Returning `valid=false` after projecting another owner's category still leaks its meaning.
- Normalize older pounds-valued source snapshots to integer pence before canonical exact-number hashing; testing only round-pound evidence misses this boundary.
- An owner advisory lock cannot exclude legacy direct inserts/updates. Capture must freeze all mutable inputs, including phantom records and category meaning, then compare the complete canonical input; test both commit orders with real independent connections.
- Recover immutable request success before rereading mutable inputs. Display historical saved bytes after integrity checks rather than replacing their figures with a fresh calculation.

# Filing pack provenance

- Retain cross-year relationship counterparts and later physically paid tax-payment sources as context; select year effects separately from graph closure. Decision creation dates do not define the financial tax year.
- Redact free descriptions/references at safe projection boundaries. Never run bank-ID redaction over machine IDs, pence amounts or complete CSV cells. Use physical CRLF and independently parse emitted CSV.
- Distinguish signed income/expense bucket effects from signed profit effects. Expense refunds reduce deductions and therefore increase profit.
- Order review supersession by a locked owner/year/step ordinal, not transaction start timestamps. Capture must reject newer answers under the same input digest even when financial inputs are unchanged.

# Category identity and invoice proposals

- Legacy category links need database owner-or-shared-default and record-type validation, including status-only updates. Preserve invalid historical links for explicit repair, and freeze category identity to prevent owner/type races. Keep shared-default lookup locks out of invoker UPDATE RLS and avoid row-trigger/advisory-lock inversions.
- Rank invoice proposals from the complete candidate set before limiting display. Amount-only matches and tied/conflicting/multiple references remain explicit review; no suggestion may classify or post a receipt. Keep prior-year invoices available for current-year cash.
- When adding tax-year filters, preserve source-only deep links and post-action redirects by resolving the selected owned source date. Propagate an explicit year from guided workflows.
- Completed Personal/duplicate/paired relationship exclusions belong in history. Unpaired Transfer/Refund tags still need relationship review and must not disappear from unresolved cash queues.

# Cash planning boundaries

- Store physical cash once and allocate earmarks across purposes and tax years inside that balance. Protect max(actual tax earmark, remaining required tax cash), not both added together. Paying a protected obligation reduces physical cash and its remaining protection once.
- Separate physical closing cash from debt holds, pension/restricted assets, tax-payment credits and historical receipts. Unknown reserve-year allocation, stale balances and unmet billable capacity cannot yield reliable current drawings.
- Hypothetical forecasts use explicit annual rules and scope, never fabricated verified ledger/fact inputs. Preserve historical calculation defaults and replay snapshots with their retained evaluation date.
- Redaction can expand a label beyond its input length limit. Validate normalized safe fields too so a prepared snapshot remains valid on replay.

# Owner-wide finance revisions

- A cash plan replaces the whole owner's allocation across years; old immutable revisions are history, not additional balances. Recover exact requests before reading mutable sources or checking today's date.
- Bind human read-back to a complete server-recomputed result and rule version, plus the expected plan ordinal and full safe source context. Freeze direct source writes/phantoms during capture; source row locks alone cannot do that.
- Browser bundling checks must keep Node crypto/server imports out of the finance editor. Type-only source catalog imports are safe; the privileged save always rereads owned metadata.
- On macOS, investigate ENOTEMPTY cache cleanup before changing application code. A repeated .next/server failure left only .DS_Store; preserve the ignored cache and verify a clean build instead of treating it as a compiler failure or deleting source files.

# Annual merchant rollover

- A separate target-year rule family preserves prior-year applicability; replacing the source family's latest version would erase its current historical suggestion. Saving a rollover copies no transaction approvals or linked evidence.
- Explicit null/global scope is a value. Use a presence check for an existing rule before falling back to the seed account; nullish fallback silently narrows all-account rules.
- Validate overlap against reviewed dates. A conflict with the default full-year proposal must allow narrowing to a non-overlapping period; the database remains the final authority.
- Every rollover ancestry insertion must remain atomic with a new rule version so the existing financial-stamp coverage stays complete. Audit-only mutation requires a corresponding stamp design change.

- A bank observation can retain an excluded ordinary record and several refund children. Tests and readers must select explicit status/link identities or aggregate all effects, never take the first bank-linked record or use the scalar pointer as a refund total. Preserve predecessor request fingerprints and actual retained result bytes when replacing financial writers.

- Match read-back catalog parsers to every valid persisted status, including unselected draft records; one unrelated valid row must not make a complete owner catalog unavailable. Use signedAmountToWords for signed deltas, and bind exact source links to both owner/import and transaction identity rather than the first paginated page.

# Currency and conversion evidence

- Rates must name their direction and distinguish major-unit rates from minor-unit ratios. Apply both currency exponents; use exact integer quotient/remainders for signed rounding, including near-half fractions with large denominators. Bound strings before BigInt/numeric parsing.
- Bind expected evidence revisions, valuation IDs and conversion-lot versions explicitly in reviewed intent. A global financial stamp cannot compensate for a projection that omitted new evidence history. Keep arithmetic helpers private until complete guarded writers/readers exist.
- Forward portions of one unchanged conversion lot use cumulative rounding. Preserve zero-cash portions, check selected prior-lot totals against receipt allocation, and never recompute historical tranches as arbitrary reversals. Unlike invoice currencies cannot be summed; invoice units and actual cash capacities stay independent.
- A retained document may have several purpose/year registrations. Fresh catalog, preview and writer must share deterministic purpose-aware selection. Version the review stamp when selection semantics change; keep historical snapshots and exact retries unchanged, and test predecessor-to-forward upgrade with an open stale preview.
- A STABLE source helper does not freeze snapshots across separate statements of a VOLATILE writer. Recheck reviewed context after all source capture and before the writer's own immutable inserts; ordinary document row locks may permit new FK registrations. Prove such windows with a deterministic barrier and actual independent registration, preserving exact recovery before live checks.
- Human local-original hashing must use an unnamed input cleared immediately, a byte-size bound and a generation token; retain only the digest, never filename/bytes in FormData or telemetry. Hash identity and personal original-read attestation are separate gates.
- Invoice currency alone does not authorize native PDF, VAT, delivery or paid-state paths: preserved external GBP needs the same origin boundary as foreign invoices. Select and validate origin/currency/non-null exact amount explicitly; do not treat missing columns or null as zero. Keep foreign-only original totals null on native rows to avoid a second mutable native amount.
- Additive native metadata changes must preserve existing row timestamps, stored snapshot bodies and request payloads. Tests should assert each financial boundary's actual invariant, rather than count every CHECK that happens to mention its currency.
- Canonicalize UUIDs for identity comparison without rewriting retained request/hash payloads. A valid mixed-case original invoice request must still recover against a database UUID serialized in lowercase; validate primitive string transport before calling string methods.

- Currency reporting distinguishes original invoice units from cash and recognised GBP effects. Validate origin and complete amount representation; group draft/finalised totals by currency, page complete inputs under a financial stamp, and require explicit unavailable coverage rather than zero for unsupported balances. Aggregate display bounds must support checked sums beyond a single-document bound. Native UI containment also needs server-side mutation guards.

- Version financial export contracts without rewriting historical artifact bytes. Build from raw cells and escape once; do not reparse exports through bounded source-import parsers. Put original document values in separate non-additive rows, keep cash/recognised units explicit, and export retained snapshots separately from current values. External evidence hashes identify retained proof, not current access.

- Partial account exports need their own consistency coverage for settings, clients, reminders and revision metadata; a financial reconciliation stamp alone is insufficient. Mirror explicit SQL/application allowlists, check all rows and counts, omit secret/path/raw-snapshot fields, preserve stored zero/null values and label omitted histories/files/keys. Before/after hashes are optimistic checks, not transaction snapshots or restore packages.

- Operational review counts must cover all selected rows and label bounded examples as samples. Count manual drafts and source-only unknowns, keep known exclusions resolved, and use actual invoice outstanding rather than gross amounts or paid assertions. Preserve historical check verification state explicitly; current operational results never certify tax completeness. AI review must reload authoritative data, require per-request consent, reject forged summaries and share bounded generated metadata rather than source text.

- Keep legacy GBP balance views restricted to complete native origin/amount/metadata identity, preserving column order, types, OID, ACLs and zero drafts. Apply the same shape to relationship guards. Upgrade fixtures should compare actual reviewed financial history and exact request recovery; inspect raw encrypted source rows only from a deliberately privileged disposable fixture context, never by widening application grants.

- New tax/filing currency coverage belongs in versioned current inputs and step digests, not rewritten financial/profile stamps or retained artifacts. Include external GBP; issue dates alone do not establish cash-basis tax-year relevance. Keep original document units separate from cash/tax amounts, independently gate optimistic SQL captures, and preserve completed-request recovery before live context checks. A page loading auxiliary history must reread complete input coverage, since older financial stamps can omit newly introduced metadata.

- Version current finance coverage around the retained manual scenario rather than rewriting its arithmetic or treating invoice units as cash. Gate effective free cash/drawings independently in SQL, bind invoice phantom writes into context locks, replay old/new snapshots from retained inputs, and keep deadline obligations independent of nested forecast figures.

- A parked reader remains a financial compatibility boundary. Never coerce unsupported/null invoice amounts to zero GBP or expose refund magnitudes without their accounting sign. Check service-role related-row ownership, exact quarter arithmetic/counts and actual audit success; containment does not authorise new scopes or make non-idempotent parked drafts safe to retry.

- A matching local original hash and a Storage metadata row do not prove retained ciphertext can be read. Verify the recorded key, owner/hash AAD, envelope length, plaintext hash/size and file signature privately; return no bytes/path/key. Bind a trusted server read outcome to immutable owned evidence and recheck currentness under locks. Label recovered success as historical, and never downgrade an uncertain audit into a competing write. SQL tests using native timestamp objects should project to JSON when modelling PostgREST JSON transport.

- Conversion evidence certifies bounded original/cash portions, not only a rate/date. Enforce the full documented limits and cumulative prior-plus-new lot totals independently of invoice/receipt availability, including zero-cash tranches. A private immutable lot is not a reservation or financial approval. Prevent same-family and same-document/rate/date recipes from creating independent rounding counters.
- PL/pgSQL can defer expression errors until execution. After adding a guard, execute the changed branch in focused SQL tests before the broad suite; keep computed-result checks after their variables are assigned. Successful migration creation alone does not validate a function body against live row shapes.

- Preserve entry-point function OIDs when wrapping current SQL APIs: copy the compatibility body to a private helper and CREATE OR REPLACE the existing function. Renaming it can leave views bound to the predecessor OID and revoked privileges. Verify dependent views, current/owner stamp parity and old requests. If context stamps include evidence provenance, zero-accounting-effect assertions must compare an explicit unchanged effect/commercial base while retaining full currentness checks.
- Keep allocation review bounds compatible with reversal bounds. A zero-cash FX event still blocks source/effect changes by existence; record guards must cover inserted effects and old/new source links, not only edits to existing linked records.

- A refund-side marker does not describe an original payment's refund children. FX eligibility must check both relationship directions; owner-locked relationship insert/reversal guards cover separate-child effects and legacy helpers that do not update the original source. Exact retained requests must recover before fresh dependency checks.
- Upgrade fixtures must replay predecessors, seed actual legacy state, then apply the target and all successors in timestamp order. Skipping one target while applying its successors can hide invalid deployment assumptions or fail when a successor correctly depends on the missing function.

- Boundary parsers used on both server output and client props must accept their own safe output without weakening validation. Preserve owner metadata required by nested retained-history parsers, and test the parsed DTO through the actual component; raw fixture success does not prove the server-to-client path.
- A complete dimensioned export must derive refund markers/totals and returned-cash assignment ancestry/caps from retained histories. Keep reversed historical parents exportable, preserve valid predecessor combinations, and require bound-lot receipt provenance even when no settlement events remain. A retained record UUID is a reference, not independent proof of historical record ownership.

- Ordinal continuity alone cannot prove complete retained history: dropping final reversal pairs may leave a valid prefix. Bind each selected lot to independently derived all-event/active counts, and select source events independently so an omitted lot cannot hide its history.
- New version guards must cover current and saved UI as well as serializers. Validate receipt balances against immutable source cash/date, not only their own internally consistent arithmetic, and retain references for reversed historical events.
- A concurrency test must give its synthetic writer the privilege needed to reach the intended lock. An immediate permission denial is not evidence of serialisation; inspect/await the actual competing operation and prove both commit orders with independent connections.

- Retained-proof enum validation must require a primitive string before checking allowed values; `String(value)` can accept arrays or objects. Cross-check nested conversion parent family/document identities against the separately selected invoice proof. Fresh authoritative checks do not excuse a permissive historical recovery parser.

- Separate execute/cancel forms for one financial request need a shared pending gate as well as SQL serialization. Disable both during either submission, retain the same request through uncertainty, and test each pending direction with inert promises.
- Versioned currency parsers must check selected monetary headers and currency symbols before delegating native normalization; explicit account currency cannot override a conflicting source declaration. Preserve and test intentional legacy header restrictions rather than silently weakening V1 recovery semantics. Foreign original units never belong in a GBP pence projection.

- A private review stamp must cover exactly the inputs its capture freezes. Reusing another feature's stamp silently inherits its transitive invoice/fact/history dependencies; either freeze that complete dependency set or define a narrower versioned stamp. Prove the actual advisory/table wait order in native tests rather than assuming every competing writer reaches NOWAIT.
- Separate captured classification decision versions from immutable economic source identity. A later posting must check the captured version before writing, but its own decision-version increment must not invalidate the exact valuation revision it links. Reviewed zero valuation is not missing and must never become a fake positive posting.

- Execute every patched SQL branch with actual valid intent, not only migration replay. A new native fence may reject cross-owner input earlier than a legacy scope guard; preserve denial and zero effects rather than requiring the old error text. Security-definer trigger helpers must retain original-caller posting restrictions; prove that control with an authenticated native direct-write rejection. Patch the actual private delegate when a public wrapper only forwards ingestion.

- Derive unresolved coverage as a distinct source set, not an addition of overlapping counters. Null native cash in a foreign Business row can turn materiality into SQL NULL and silently omit it. Keep cash-year/quarter activity separate from owner-wide context; source metadata availability and verified readable bytes are different claims. Run ESLint after repository-local test harness directories stop changing, since parallel globbing can race their removal.

- When joining tax/filing observations to complete bank coverage, validate shared source identity and reject duplicate effects or omitted active native sources. Distinguish discarded legacy context from explicit record/fact connections; ordinary discarded year rows must not become artificial completeness blockers. Prove SQL and TypeScript scope parity.

- Coverage version switches must update current SQL integration fixtures as well as production readers. Keep historical preparers and old upgrade tests explicit; a deadline obligation source can be incomplete for drawings without losing its retained tax commitments. Historical UI copy must describe only coverage that version actually retained.

- Scope guards for event-only writes must resolve authoritative owned parents and every connected source, including no-op duplicate verdicts and draft effect links. Do not let native balance views establish complete scope. Keep exact prior recovery before new guards, and confine native settlement edits to a uniquely identified branch so FX reversal logic remains byte-identical.

import Link from "next/link";
import { redactBankDetailsForPrompt } from "@/lib/ai/redaction";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { readAllExportRows } from "@/lib/records/export-pages";
import { readFinancialStamp } from "@/lib/records/consistent-reconciliation";
import BankSourceCoverageReadback from '../../BankSourceCoverage';
import { readBankSourceCoverage, bankSourceCoverageBlocks, nativeBankPence } from '@/lib/records/bank-source-coverage';
import {
  getCurrentTaxYearStart,
  getTaxYearLabel,
} from "@/lib/records/tax-periods";
import { formatPounds, signedAmountToWords } from "@/lib/invoices/money";
import {
  factKinds,
  type FactKind,
  type TaxFact,
  type TaxProfileRevision,
} from "@/lib/tax/facts";
import {
  TaxProfileReview,
  TaxFactReview,
  TaxSectionReview,
  type TaxSourceChoice,
  type SourceSelection,
} from "./TaxFactReview";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const pretty = (s: string) => s.replaceAll("_", " ");
type SourceStatus = {
  id: string;
  revision_id: string;
  document_id: string | null;
  transaction_id: string | null;
  record_id: string | null;
  snapshot: Record<string, unknown>;
  kind: FactKind;
  fact_state: string;
  current_recognized_pence: string | number;
  source_unresolved: boolean;
};
type Section = {
  id: string;
  kind: FactKind;
  verdict: string;
  is_current: boolean;
  created_at: string;
};
export default async function TaxFactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const db = await createClient(),
    {
      data: { user },
      error,
    } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const userId = user.id;
  const params = await searchParams,
    requested = Number(params.year),
    year =
      Number.isInteger(requested) && requested >= 2000 && requested <= 2100
        ? requested
        : getCurrentTaxYearStart() - 1;
  const cursor = (key: string) =>
    typeof params[key] === "string" && uuid.test(params[key] as string)
      ? (params[key] as string)
      : null;
  const read = async () => {
    const bankCoverage=await readBankSourceCoverage(db,userId);
    const stamp = await readFinancialStamp(() =>
      db.rpc("tax_review_stamp", { p_year: year }),
    );
    const rows = <T extends { id: string }>(table: string, select = "*") =>
      readAllExportRows<T>(async (after) => {
        let q = db
          .from(table)
          .select(select)
          .eq("user_id", userId)
          .eq("tax_year_start", year)
          .order("id")
          .limit(500);
        if (after) q = q.gt("id", after);
        const r = await q;
        return { data: r.data as unknown as T[] | null, error: r.error };
      });
    const facts = await rows<TaxFact>("current_tax_facts"),
      profiles = await rows<TaxProfileRevision>("current_tax_profiles"),
      sections = await rows<Section>("current_tax_sections"),
      sourceStatus = await rows<SourceStatus>("tax_fact_source_status");
    if (profiles.length > 1) throw new Error("Profile identity conflict.");
    const fact = cursor("edit")
      ? facts.find((f) => f.family_id === params.edit)
      : undefined;
    if (params.edit && !fact)
      throw new Error("Owned current fact unavailable.");
    const kind =
      fact?.kind ??
      (factKinds.includes(params.kind as FactKind)
        ? (params.kind as FactKind)
        : "employment");
    const selectedSources = sourceStatus.filter(
        (s) => s.revision_id === fact?.id,
      ),
      selected: SourceSelection = {
        document_ids: selectedSources.flatMap((s) =>
          s.document_id ? [s.document_id] : [],
        ),
        transaction_ids: selectedSources.flatMap((s) =>
          s.transaction_id ? [s.transaction_id] : [],
        ),
        record_ids: selectedSources.flatMap((s) =>
          s.record_id ? [s.record_id] : [],
        ),
      };
    async function choices(
      table: string,
      select: string,
      after: string | null,
    ) {
      let q = db
        .from(table)
        .select(select)
        .eq("user_id", userId)
        .order("id")
        .limit(21);
      if (table === "financial_records") q = q.eq("status", "approved");
      if (table === "duplicate_review_transactions")
        q = q.neq("import_status", "discarded").eq("dedupe_status", "clear").eq('currency','GBP').is('original_signed_minor',null).is('source_units_ruleset',null).not('signed_amount_pence','is',null);
      if (after) q = q.gt("id", after);
      const r = await q;
      if (r.error || !r.data) throw new Error("Source choices unavailable.");
      return r.data as unknown as Record<string, unknown>[];
    }
    const docs = await choices(
      "evidence_documents",
      "id,file_hash,media_type",
      cursor("documentsAfter"),
    );
    const transactions = await choices(
      "duplicate_review_transactions",
      "id,transaction_date,signed_amount_pence,currency,original_signed_minor,source_units_ruleset,description,account_label,account_mask,import_status,dedupe_status",
      cursor("transactionsAfter"),
    );
    const records = await choices(
      "financial_records",
      "id,record_date,description,amount,record_type,status,tax_year_start",
      cursor("recordsAfter"),
    );
    const documents: TaxSourceChoice[] = docs.slice(0, 20).map((d) => ({
      id: String(d.id),
      label: `${d.media_type} · SHA-256 ${d.file_hash}`,
    }));
    const banks: TaxSourceChoice[] = transactions.slice(0, 20).map((t) => ({
      id: String(t.id),
      label: `${t.transaction_date} · ${t.description} · ${formatPounds(nativeBankPence(t))} · ${t.account_label} ending ${t.account_mask} · ${t.import_status}/${t.dedupe_status}`,
    }));
    const ledger: TaxSourceChoice[] = records.slice(0, 20).map((r) => ({
      id: String(r.id),
      label: `${r.record_date} · ${redactBankDetailsForPrompt(String(r.description))} · ${r.record_type} ${r.amount} GBP · ${r.status} · year ${r.tax_year_start}`,
    }));
    for (const s of selectedSources) {
      const id = s.document_id ?? s.transaction_id ?? s.record_id!,
        list = s.document_id ? documents : s.transaction_id ? banks : ledger;
      if (!list.some((c) => c.id === id))
        list.push({
          id,
          label: s.document_id
            ? `Selected document · SHA-256 ${s.snapshot.file_sha256}`
            : s.transaction_id
              ? `Selected bank source ${s.snapshot.transaction_date} · row SHA-256 ${s.snapshot.row_sha256}`
              : `Selected trading record ${s.snapshot.record_date} · ${s.snapshot.amount} GBP`,
        });
    }
    let history = db
      .from("tax_fact_history")
      .select(
        "id,family_id,ordinal,state,kind,label,rationale,author,created_at",
      )
      .eq("user_id", userId)
      .eq("tax_year_start", year)
      .eq("kind", kind)
      .order("id")
      .limit(21);
    if (cursor("historyAfter"))
      history = history.gt("id", cursor("historyAfter")!);
    const past = await history;
    if (past.error) throw new Error("History unavailable.");
    if (
      (await readFinancialStamp(() =>
        db.rpc("tax_review_stamp", { p_year: year }),
      )) !== stamp
    )
      throw new Error("Tax review changed.");
    return {
      stamp,
      facts,
      profile: profiles[0],
      sections,
      sourceStatus,
      kind,
      fact,
      selected,
      documents,
      banks,
      ledger,
      docs,
      transactions,
      records,
      past: past.data ?? [],bankCoverage,
    };
  };
  let loaded;
  try {
    loaded = await read();
  } catch {
    return (
      <main className="mx-auto max-w-5xl space-y-4 p-5">
        <h1 className="text-2xl font-semibold">Tax facts unavailable</h1>
        <p role="alert">
          Could not read a complete, consistent tax-year review. No values or
          completeness approvals are available. Reload after resolving
          migrations or changed inputs.
        </p>
        <Link href="/dashboard/tax-prep">Tax preparation</Link>
      </main>
    );
  }
  const {
    bankCoverage,
    stamp,
    facts,
    profile,
    sections,
    sourceStatus,
    kind,
    fact,
    selected,
    documents,
    banks,
    ledger,
    docs,
    transactions,
    records,
    past,
  } = loaded;
  if(bankSourceCoverageBlocks(bankCoverage))return <main className="space-y-4 p-5"><h1>Tax facts need source currency review</h1><BankSourceCoverageReadback coverage={bankCoverage}/><p data-testid="tax-fact-bank-coverage-blocked">Current tax input/completeness confirmation is withheld. Native GBP source choices cannot establish the treatment of foreign observations. Existing retained facts and exports remain history.</p><Link href="/dashboard/imports">Review sources</Link></main>;
  const active = facts.filter(
    (f) => f.kind === kind && f.state !== "withdrawn",
  );
  const overlap = sourceStatus.filter(
    (s) =>
      s.fact_state === "verified" &&
      !["vehicle", "trade_adjustment"].includes(s.kind) &&
      Number(s.current_recognized_pence) !== 0,
  );
  const shared = { year, stamp };
  const link = (key: string, id: string) =>
    `?year=${year}&kind=${kind}${fact ? `&edit=${fact.family_id}` : ""}&${key}=${id}`;
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-5">
      <header>
        <h1 className="text-2xl font-semibold">
          Reviewed tax facts · {getTaxYearLabel(year)}
        </h1>
        <p>
          Draft — not submitted to HMRC. Reviewed inputs support a later
          explainable estimate; they do not create trading records, approve
          deductions or submit a return.
        </p>
      </header>
      <BankSourceCoverageReadback coverage={bankCoverage}/>
      <nav className="flex flex-wrap gap-4" aria-label="Tax review tools">
        <Link href={`/dashboard/tax-prep/calculation?year=${year}`} data-testid="tax-facts-calculation-link">
          Review draft calculation
        </Link>
        <Link
          href={`/dashboard/tax-prep?taxYearStart=${year}`}
          data-testid="tax-facts-prep-link"
        >
          Trading checklist
        </Link>
        <Link href="/dashboard/imports" data-testid="tax-facts-imports-link">
          Import evidence
        </Link>
        <a
          href={`/api/tax-prep/facts/export?year=${year}`}
          data-testid="tax-facts-export-link"
        >
          Export fact and source history
        </a>
      </nav>
      <form method="get" data-testid="tax-facts-year-form">
        <label>
          Tax-year start
          <input
            name="year"
            type="number"
            min="2000"
            max="2100"
            required
            defaultValue={year}
            className="ml-2 rounded border p-2"
            data-testid="tax-facts-year"
          />
        </label>
        <button
          data-testid="tax-facts-year-submit"
          className="ml-2 rounded border p-2"
        >
          Review year
        </button>
      </form>
      {typeof params.error === "string" && (
        <p role="alert">{params.error.slice(0, 500)}</p>
      )}
      {params.result === "saved" && (
        <p role="status">
          Reviewed input revision saved. Trading totals were not changed.
          Recheck any completeness confirmations invalidated by this revision.
        </p>
      )}
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Collection status</h2>
        <p>
          Missing is not zero. A “complete” collection means all facts have been
          entered and reviewed; calculation-specific missing inputs and
          unsupported cases can still block an estimate.
        </p>
        {factKinds.map((k) => {
          const s = sections.find((s) => s.kind === k);
          return (
            <p key={k}>
              {pretty(k)}:{" "}
              {s
                ? s.is_current
                  ? pretty(s.verdict)
                  : "Stale — facts changed"
                : "Unresolved — not reviewed"}
            </p>
          );
        })}
      </section>
      {overlap.length > 0 && (
        <section role="alert" className="space-y-2 rounded border p-4">
          <h2 className="font-semibold">Trading overlap needs correction</h2>
          <p>
            Some non-trading tax facts reference sources still recognised in
            business income/expenses. Future calculations must block double
            counting. Saving a tax fact does not remove these postings.
          </p>
          {overlap.map((s) => (
            <p key={s.id}>
              {pretty(s.kind)} · current trading effect{" "}
              {formatPounds(Number(s.current_recognized_pence))} (
              {signedAmountToWords(Number(s.current_recognized_pence))}) ·{" "}
              <Link
                href={
                  s.transaction_id
                    ? `/dashboard/imports?import=${s.snapshot.import_id}`
                    : "/dashboard/records"
                }
                data-testid={`tax-overlap-${s.id}`}
              >
                Review linked source
              </Link>
            </p>
          ))}
        </section>
      )}
      {sourceStatus.some(
        (s) => s.fact_state === "verified" && s.source_unresolved,
      ) && (
        <p role="alert">
          A verified fact has a source that is now reversed, unresolved or no
          longer approved. Review that provenance before using it in a
          calculation.
        </p>
      )}
      {profile?.state === "reviewed" && !profile.ledger_is_current && (
        <p role="alert">
          Financial inputs changed since the ledger completeness answer. Review
          a fresh profile revision before using it in a calculation.
        </p>
      )}
      <TaxProfileReview
        {...shared}
        profile={profile}
        requestId={randomUUID()}
      />
      <nav aria-label="Tax fact sections" className="flex flex-wrap gap-4">
        {factKinds.map((k) => (
          <Link
            key={k}
            href={`?year=${year}&kind=${k}`}
            data-testid={`tax-kind-${k}`}
            aria-current={kind === k ? "page" : undefined}
          >
            {pretty(k)}
          </Link>
        ))}
      </nav>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{pretty(kind)} current facts</h2>
        {facts
          .filter((f) => f.kind === kind)
          .map((f) => (
            <article key={f.id} className="rounded border p-3">
              <p>
                {f.label} · revision {f.ordinal} · {f.state} · {f.rationale}
              </p>
              <Link
                href={`?year=${year}&kind=${kind}&edit=${f.family_id}`}
                data-testid={`tax-edit-${f.family_id}`}
              >
                Review correction or withdrawal
              </Link>
            </article>
          ))}
        <Link href={`?year=${year}&kind=${kind}`} data-testid="tax-fact-new">
          Add a distinct fact
        </Link>
      </section>
      <TaxFactReview
        {...shared}
        kind={kind}
        fact={fact}
        selected={selected}
        documents={documents}
        transactions={banks}
        records={ledger}
        requestId={randomUUID()}
      />
      <nav aria-label="Tax source pages" className="flex flex-wrap gap-4">
        {[
          ["documentsAfter", docs, "More documents"],
          ["transactionsAfter", transactions, "More bank observations"],
          ["recordsAfter", records, "More trading records"],
        ].map(([key, items, label]) => {
          const rows = items as Record<string, unknown>[];
          return rows.length > 20 ? (
            <Link
              key={String(key)}
              href={link(String(key), String(rows[19].id))}
              data-testid={`tax-page-${key}`}
            >
              {String(label)}
            </Link>
          ) : null;
        })}
      </nav>
      <TaxSectionReview
        {...shared}
        kind={kind}
        activeCount={active.length}
        provisionalCount={
          active.filter((f) => f.state === "provisional").length
        }
        requestId={randomUUID()}
      />
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">
          {pretty(kind)} immutable revision history
        </h2>
        {past.slice(0, 20).map((h) => (
          <p key={h.id}>
            {h.created_at} · {h.label} · revision {h.ordinal} · {h.state} ·{" "}
            {h.rationale} · author {h.author}
          </p>
        ))}
        {past.length > 20 && (
          <Link
            href={link("historyAfter", past[19].id)}
            data-testid="tax-history-more"
          >
            More revisions
          </Link>
        )}
      </section>
      <p>
        Preserved documents, draft facts and estimates are preparation aids.
        Jurisdiction, timing, tax treatment, annual rules and form mapping must
        be reviewed before a filing pack can be complete.
      </p>
    </main>
  );
}

import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { readAllExportRows } from "@/lib/records/export-pages";
import { readFinancialStamp } from "@/lib/records/consistent-reconciliation";
import {
  buildMerchantQueue,
  type MerchantChoice,
  type MerchantCategory,
} from "@/lib/records/merchant-memory";
import {
  getCurrentTaxYearStart,
  getTaxYearLabel,
} from "@/lib/records/tax-periods";
import { formatPounds, amountToWords } from "@/lib/invoices/money";
import BankSourceCoverageReadback from '../../BankSourceCoverage';
import { readBankSourceCoverage, isNativeBankObservation } from '@/lib/records/bank-source-coverage';
import {
  MerchantRuleReview,
  MerchantBatchReview,
  MerchantBatchUndo,
  type MerchantRule,
} from "./MerchantReview";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const money = (n: number) => `${formatPounds(n)} (${amountToWords(n)})`;
export default async function MerchantMemoryPage({
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
  const params = await searchParams,
    candidate = Number(params.year),
    year =
      Number.isInteger(candidate) && candidate >= 2000 && candidate <= 2100
        ? candidate
        : getCurrentTaxYearStart() - 1;
  const page =
    typeof params.page === "string" && /^\d{1,6}$/.test(params.page)
      ? Math.max(1, Number(params.page))
      : 1;
  const afterDoc =
    typeof params.documentsAfter === "string" &&
    uuid.test(params.documentsAfter)
      ? params.documentsAfter
      : null;
  const afterHistory =
    typeof params.historyAfter === "string" && uuid.test(params.historyAfter)
      ? params.historyAfter
      : null;
  const read = async () => {
    const bankCoverage=await readBankSourceCoverage(db,user.id);
    const stamp = await readFinancialStamp(() =>
      db.rpc("reconciliation_export_stamp"),
    );
    const all = await readAllExportRows<MerchantChoice>(async (after) => {
      let q = db
        .from("merchant_transaction_choices")
        .select("*")
        .eq("user_id", user.id)
        .eq("tax_year_start", year)
        .order("id")
        .limit(500);
      if (after) q = q.gt("id", after);
      const r = await q;
      return { data: r.data as MerchantChoice[] | null, error: r.error };
    });
    const categories = await readAllExportRows<MerchantCategory>(
      async (after) => {
        let q = db
          .from("record_categories")
          .select("id,name,record_type")
          .or(`user_id.eq.${user.id},and(user_id.is.null,is_default.eq.true)`)
          .order("id")
          .limit(500);
        if (after) q = q.gt("id", after);
        return await q;
      },
    );
    const accounts = await readAllExportRows<{
      id: string;
      label: string;
      masked_identifier: string;
    }>(async (after) => {
      let q = db
        .from("financial_accounts")
        .select("id,label,masked_identifier")
        .eq("user_id", user.id)
        .order("id")
        .limit(500);
      if (after) q = q.gt("id", after);
      return await q;
    });
    const rules = await readAllExportRows<MerchantRule>(async (after) => {
      let q = db
        .from("current_merchant_rules")
        .select(
          "id,rule_id,ordinal,match_key,record_type,status,account_id,tax_year_start,effective_from,expires_on,priority,classification,business_use_bps,category_id,evidence_status,seed_transaction_id,category_valid",
        )
        .eq("user_id", user.id)
        .order("id")
        .limit(500);
      if (after) q = q.gt("id", after);
      return await q;
    });
    let docsQuery = db
      .from("evidence_documents")
      .select("id,file_hash,media_type")
      .eq("user_id", user.id)
      .order("id")
      .limit(21);
    if (afterDoc) docsQuery = docsQuery.gt("id", afterDoc);
    const documents = await docsQuery;
    let h = db
      .from("merchant_review_batches")
      .select("id,rationale,author,created_at")
      .eq("user_id", user.id)
      .order("id")
      .limit(21);
    if (afterHistory) h = h.gt("id", afterHistory);
    const history = await h;
    if (documents.error || history.error)
      throw new Error("History or evidence unavailable.");
    const rule =
      typeof params.rule === "string"
        ? rules.find((r) => r.rule_id === params.rule)
        : undefined;
    const selectedId =
      rule?.seed_transaction_id ??
      (typeof params.transaction === "string" && uuid.test(params.transaction)
        ? params.transaction
        : null);
    let seed = all.find((r) => r.id === selectedId);
    if (selectedId && !seed) {
      const r = await db
        .from("merchant_transaction_choices")
        .select("*")
        .eq("id", selectedId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (r.error) throw r.error;
      seed = r.data as MerchantChoice | undefined;
    }
    if(seed&&!isNativeBankObservation(seed)) seed=undefined;
    const queue = buildMerchantQueue(all.filter(isNativeBankObservation), year),
      visible = queue.slice((page - 1) * 20, page * 20),
      rows = visible.map((q) => q.row);
    if (seed && !rows.some((r) => r.id === seed!.id)) rows.unshift(seed);
    let undo: {
      id: string;
      items: { transaction_id: string; after_version: number }[];
      rows: MerchantChoice[];
      reversed: boolean;
    } | null = null;
    if (typeof params.batch === "string" && uuid.test(params.batch)) {
      const batch = await db
        .from("merchant_review_batches")
        .select("id")
        .eq("id", params.batch)
        .eq("user_id", user.id)
        .maybeSingle();
      if (batch.error || !batch.data)
        throw new Error("Owned batch unavailable.");
      const items = await db
        .from("merchant_review_items")
        .select("transaction_id,after_version")
        .eq("batch_id", batch.data.id)
        .eq("user_id", user.id)
        .limit(51);
      const rev = await db
        .from("merchant_review_reversals")
        .select("id")
        .eq("batch_id", batch.data.id)
        .eq("user_id", user.id);
      if (
        items.error ||
        !items.data?.length ||
        items.data.length > 50 ||
        rev.error
      )
        throw new Error("Complete batch unavailable.");
      const current = await db
        .from("merchant_transaction_choices")
        .select("*")
        .in(
          "id",
          items.data.map((i) => i.transaction_id),
        )
        .eq("user_id", user.id)
        .limit(50);
      if (current.error || current.data?.length !== items.data.length)
        throw new Error("Current batch sources unavailable.");
      undo = {
        id: batch.data.id,
        items: items.data,
        rows: current.data as MerchantChoice[],
        reversed: !!rev.data?.length,
      };
      if(!undo.rows.every(isNativeBankObservation))throw new Error('Native undo source currency unavailable.');
    }
    if (
      (await readFinancialStamp(() =>
        db.rpc("reconciliation_export_stamp"),
      )) !== stamp
    )
      throw new Error("Review state changed.");
    if((await readBankSourceCoverage(db,user.id)).stamp!==bankCoverage.stamp)throw new Error('Bank coverage changed.');
    return {
      bankCoverage,
      stamp,
      categories,
      accounts,
      rules,
      documents,
      history,
      selectedId,
      seed,
      rule,
      queue,
      visible,
      rows,
      undo,
    };
  };
  let loaded;
  try {
    loaded = await read();
  } catch {
    return (
      <main className="mx-auto max-w-5xl space-y-4 p-5">
        <h1 className="text-2xl font-semibold">Merchant review unavailable</h1>
        <p role="alert">
          Could not read a complete, consistent review. No approvals are
          available. Reload after resolving missing migrations or changing
          source state.
        </p>
        <Link href="/dashboard/imports">Imports</Link>
      </main>
    );
  }
  const {
    bankCoverage,
    stamp,
    categories,
    accounts,
    rules,
    documents,
    history,
    selectedId,
    seed,
    rule,
    queue,
    visible,
    rows,
    undo,
  } = loaded;
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-5">
      <header>
        <h1 className="text-2xl font-semibold">
          Expense review and merchant memory
        </h1>
        <p>
          Draft treatment and material exceptions for {getTaxYearLabel(year)}.
          This is preparation for review, not a final tax calculation.
        </p>
      </header>
      <BankSourceCoverageReadback coverage={bankCoverage}/>
      <p>Merchant decisions below cover eligible native GBP sources. Other source currencies remain in the complete coverage above.</p>
      <nav className="flex flex-wrap gap-4" aria-label="Review tools">
        {year < 2100 && <Link href={`/dashboard/review/memory/rollover?target=${year + 1}`} data-testid="merchant-rollover-link">Review next-year rule proposals</Link>}
        <Link href="/dashboard/imports" data-testid="merchant-imports-link">
          Imports
        </Link>
        <Link href="/dashboard/reconciliation">Reconciliation</Link>
        <a href="/api/review/memory/export" data-testid="merchant-export-link">
          Export decision and rule history
        </a>
      </nav>
      <form method="get" data-testid="merchant-year-form">
        <label>
          Tax-year start
          <input
            type="number"
            name="year"
            min="2000"
            max="2100"
            defaultValue={year}
            required
            data-testid="merchant-year"
            className="ml-2 rounded border p-2"
          />
        </label>
        <button
          className="ml-2 rounded border p-2"
          data-testid="merchant-year-submit"
        >
          Review year
        </button>
      </form>
      {typeof params.error === "string" && (
        <p role="alert">{params.error.slice(0, 500)}</p>
      )}
      {params.result === "rule-saved" && (
        <p role="status">
          New rule revision saved. No transaction was approved.
        </p>
      )}
      {params.result === "batch-approved" && (
        <p role="status">
          Selected decisions recorded. Unselected sources retain their
          treatment.
        </p>
      )}
      {params.result === "batch-reversed" && (
        <p role="status">
          Batch decisions undone. Rows are Unknown; previous approvals were not
          restored.
        </p>
      )}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Material exception queue</h2>
        <p>
          {queue.length} unresolved observations. Ordered by the largest of the
          individual amount, observed merchant spend and a recurring
          annual-spend scenario. Triage score is a heuristic, never a
          probability, business-use percentage or tax eligibility decision.
        </p>
        <p>
          Annual scenarios use median observed daily totals × days in this tax
          year ÷ median days between observed dates (minimum seven days).
          Incomplete statements and irregular purchases can distort this
          assumption; it is not a deduction or forecast commitment.
        </p>
        {visible.map((q) => (
          <article key={q.row.id} className="rounded border p-3">
            <h3>
              {q.row.transaction_date} · {q.row.description}
            </h3>
            <p>
              Materiality {money(q.priority)} · triage score {q.score}/100 ·
              observed merchant gross {money(q.observed)} across {q.occurrences}{" "}
              observations.
              {q.annualized !== null
                ? ` Annual-spend scenario ${money(q.annualized)}.`
                : " No recurring scenario inferred."}
            </p>
          </article>
        ))}
        {!queue.length && (
          <p>
            No unresolved observations in this year. This alone does not
            establish complete tax inputs.
          </p>
        )}
        <nav className="flex gap-4" aria-label="Exception pages">
          {page > 1 && (
            <Link href={`?year=${year}&page=${page - 1}`}>
              Previous exceptions
            </Link>
          )}
          {page * 20 < queue.length && (
            <Link href={`?year=${year}&page=${page + 1}`}>More exceptions</Link>
          )}
        </nav>
      </section>
      {rows.length > 0 && (
        <MerchantBatchReview
          rows={rows}
          categories={categories}
          documents={(documents.data ?? []).slice(0, 20)}
          stamp={stamp}
          requestId={randomUUID()}
          reviewYear={year}
        />
      )}
      <nav className="flex gap-4" aria-label="Evidence document pages">
        {afterDoc && (
          <Link
            href={`?year=${year}${selectedId ? `&transaction=${selectedId}` : ""}`}
          >
            First documents
          </Link>
        )}
        {documents.data && documents.data.length > 20 && (
          <Link
            href={`?year=${year}${selectedId ? `&transaction=${selectedId}` : ""}&documentsAfter=${documents.data[19].id}`}
          >
            More evidence documents
          </Link>
        )}
      </nav>
      {seed && (
        <MerchantRuleReview
          seed={seed}
          rule={rule}
          categories={categories}
          accounts={accounts}
          stamp={stamp}
          requestId={randomUUID()}
          reviewYear={year}
        />
      )}
      {!seed && (
        <p>
          Choose “Remember or override this merchant” on a source row to create
          a scoped suggestion.
        </p>
      )}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Rules and expiry</h2>
        {rules.map((r) => (
          <article key={r.id} className="rounded border p-3">
            <p>
              {r.match_key} · {r.record_type} · revision {r.ordinal} ·{" "}
              {r.status} · {r.classification}, {r.business_use_bps / 100}% ·
              priority {r.priority} ·{" "}
              {r.account_id
                ? accounts.find((a) => a.id === r.account_id)?.label
                : "all accounts"}{" "}
              ·{" "}
              {r.tax_year_start
                ? getTaxYearLabel(r.tax_year_start)
                : "all tax years"}{" "}
              · transaction dates {r.effective_from} to{" "}
              {r.expires_on ?? "no expiry"}
              {!r.category_valid
                ? " · category changed; revise before application"
                : ""}
            </p>
            <Link
              data-testid={`merchant-edit-${r.rule_id}`}
              href={`?year=${year}&rule=${r.rule_id}`}
            >
              Review new revision or disable
            </Link>
          </article>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Reviewed batch history</h2>
        {history.data?.slice(0, 20).map((b) => (
          <p key={b.id}>
            {b.created_at} · {b.rationale} · author {b.author} ·{" "}
            <Link href={`?year=${year}&batch=${b.id}`}>
              Review batch and undo
            </Link>
          </p>
        ))}
        <nav aria-label="Batch history pages">
          {afterHistory && <Link href={`?year=${year}`}>First batch page</Link>}
          {history.data && history.data.length > 20 && (
            <Link href={`?year=${year}&historyAfter=${history.data[19].id}`}>
              More batches
            </Link>
          )}
        </nav>
      </section>
      {undo && (
        <section>
          <h2 className="text-xl font-semibold">Batch {undo.id}</h2>
          {undo.rows.map((r) => (
            <p key={r.id}>
              {r.transaction_date} · {r.description} · current{" "}
              {r.classification} · version {r.decision_version} ·{" "}
              <Link href={`/dashboard/imports?import=${r.import_id}`}>
                Source import
              </Link>
            </p>
          ))}
          {undo.reversed ? (
            <p>
              This batch was reversed. History and evidence remain available in
              the export.
            </p>
          ) : (
            <MerchantBatchUndo
              batchId={undo.id}
              versions={undo.items}
              rows={undo.rows}
              stamp={stamp}
              requestId={randomUUID()}
              reviewYear={year}
            />
          )}
        </section>
      )}
    </main>
  );
}

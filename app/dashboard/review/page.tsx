import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTaxYearStart, getTaxYearLabel } from "@/lib/records/tax-periods";
import { readFinancialReview, FINANCIAL_REVIEW_VERSION } from "@/lib/records/financial-review";
import { fxAggregateReadback } from "@/lib/fx/readback";
import LogoutButton from "@/app/dashboard/LogoutButton";
import RecordsReviewAgent from "./RecordsReviewAgent";
import BatchCategorisePanel from "./BatchCategorisePanel";
import BankSourceCoverage from "@/app/dashboard/BankSourceCoverage";

export const metadata = {
  title: "Records Review — VibeCount",
  description: "AI-assisted read-only review of your records and invoices.",
};

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const {
    data: { user }, error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");

  const taxYearStart = getCurrentTaxYearStart();
  const taxYearLabel = getTaxYearLabel(taxYearStart);
  const resolvedParams = await searchParams;
  const batchApplied =
    resolvedParams.batchApplied !== undefined
      ? Number(resolvedParams.batchApplied)
      : null;

  const asOf = new Date().toISOString().slice(0,10);
  let summary;
  let latestCheck;
  let globalUncategorisedCount;
  try {
    summary = await readFinancialReview(supabase,user.id,taxYearStart,asOf);
    const [latest,batch] = await Promise.all([supabase.from("quarterly_readiness_checks")
      .select("tax_year_start,tax_quarter,checked_at,status,notes,coverage_version,source_stamp,checked_as_of")
      .eq("user_id",user.id).eq("tax_year_start",taxYearStart).order("checked_at",{ascending:false}).limit(1).maybeSingle(),
      supabase.from("financial_records").select("id",{count:"exact",head:true}).eq("user_id",user.id).in("status",["approved","review"]).is("category_id",null),
    ]);
    if(latest.error||batch.error||typeof batch.count!=="number"||!Number.isSafeInteger(batch.count)||batch.count<0)throw new Error();
    globalUncategorisedCount=batch.count;
    latestCheck=latest.data;
  } catch {
    return <main className="mx-auto max-w-3xl p-6"><h1>Records review</h1><p role="alert" data-testid="financial-review-unavailable">Complete owned review data is unavailable. Reload before relying on counts or running AI review.</p><Link href="/dashboard/records" data-testid="review-unavailable-records">Review records</Link></main>;
  }
  const quarters=summary.quarters;
  const approvedCount=summary.approved_count,reviewStateCount=summary.review_count;
  const currentCheck=latestCheck?.coverage_version===FINANCIAL_REVIEW_VERSION && latestCheck.source_stamp===summary.stamp && latestCheck.checked_as_of===asOf;

  return (
    <main className="min-h-screen bg-[#f0fdf4]">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#15803d] bg-[#15803d] px-6 py-4 sm:px-8">
        <div className="flex items-center gap-6">
          <span className="text-lg font-semibold text-white">VibeCount</span>
          <nav className="hidden items-center gap-1 sm:flex">
            <Link
              href="/dashboard"
              className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              Invoices
            </Link>
            <Link
              href="/dashboard/records"
              className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              Records
            </Link>
            <Link
              href="/dashboard/quotes"
              className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              Quotes
            </Link>
            <Link
              href="/dashboard/invoices/repeating"
              className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              Repeating
            </Link>
            <Link
              href="/dashboard/tax-prep"
              className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              Tax prep
            </Link>
            <Link
              href="/dashboard/review"
              className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium text-white"
            >
              Review
            </Link>
            <Link
              href="/dashboard/glossary"
              className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              Explain Simply
            </Link>
            <Link
              href="/dashboard/settings"
              className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              Settings
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <LogoutButton />
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-[#14532d]">
            Records review
          </h1>
          <p className="mt-1 text-sm text-[#166534]">
            Tax year {taxYearLabel} · {approvedCount} approved records ·{" "}
            {reviewStateCount} awaiting review
          </p>
        </div>

        {batchApplied !== null && (
          <div className="mb-6 rounded-xl border border-[#bbf7d0] bg-[#dcfce7] px-5 py-3 text-sm font-medium text-[#14532d]">
            {batchApplied > 0
              ? `${batchApplied} categor${batchApplied === 1 ? "y" : "ies"} applied.`
              : "No categories applied."}
          </div>
        )}

        {reviewStateCount > 0 && (
          <div className="mb-6 flex items-start gap-4 rounded-xl border border-[#fef08a] bg-[#fefce8] p-5">
            <div>
              <p className="text-sm font-medium text-[#713f12]">
                {reviewStateCount} record{reviewStateCount === 1 ? "" : "s"}{" "}
                awaiting your review
              </p>
              <p className="mt-0.5 text-xs text-[#854d0e]">
                Approve or exclude them in Records before running the AI review.
              </p>
              <Link
                href="/dashboard/records"
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#713f12] underline underline-offset-2"
              >
                Go to Records
              </Link>
            </div>
          </div>
        )}

        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          {quarters
            .filter((q) => q.approved_count > 0 || q.source_count > 0 || q.review_count > 0)
            .map((q) => (
              <div
                key={q.quarter}
                data-testid={`review-quarter-${q.quarter}`}
                className="rounded-xl border border-[#bbf7d0] bg-white p-4"
              >
                <p className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
                  {q.label}
                </p>
                <p className="mt-1 text-xs text-[#4b8068]">{q.period}</p>
                <p className="mt-2 text-base font-semibold text-[#14532d]">
                  {fxAggregateReadback(q.net_pence,"GBP")}
                </p>
                <p className="text-xs text-[#4b8068]">recognised ledger net profit; source review may be incomplete</p>
                <div className="mt-2 flex gap-3 text-xs text-[#4b8068]">
                  <span>Income: {fxAggregateReadback(q.income_pence,"GBP")}</span>
                  <span>Expenses: {fxAggregateReadback(q.expense_pence,"GBP")}</span>
                </div>
                <p>{q.source_count} active sources · {q.unresolved_source_count} unresolved · {q.unsupported_source_count} unsupported · {q.source_unavailable_count} with unavailable source metadata. Counts overlap.</p>
              </div>
            ))}
          {quarters.every((q) => q.approved_count === 0 && q.source_count === 0 && q.review_count === 0) && (
            <div className="col-span-3 rounded-xl border border-dashed border-[#bbf7d0] bg-white p-6 text-center">
              <p className="text-sm text-[#4b8068]">
                No approved records for {taxYearLabel} yet.
              </p>
              <Link
                href="/dashboard/records"
                className="mt-1 text-xs font-semibold text-[#15803d] underline"
              >
                Add records
              </Link>
            </div>
          )}
        </div>

        {latestCheck && (
          <div
            className={`mb-6 rounded-xl border p-5 ${
              (!currentCheck || latestCheck.status === "needs_attention")
                ? "border-[#fef08a] bg-[#fefce8]"
                : "border-[#bbf7d0] bg-[#dcfce7]"
            }`}
            data-testid="readiness-check-result"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p
                  className={`text-sm font-semibold ${(!currentCheck || latestCheck.status === "needs_attention") ? "text-[#713f12]" : "text-[#14532d]"}`}
                >
                  {!currentCheck ? "Historical quarter check — current coverage unverified" : (!currentCheck || latestCheck.status === "needs_attention")
                    ? "Quarter operational check: needs attention"
                    : "Quarter operational check: no listed issues"}
                </p>
                <p
                  className={`mt-0.5 text-xs ${(!currentCheck || latestCheck.status === "needs_attention") ? "text-[#854d0e]" : "text-[#166534]"}`}
                >
                  Quarter {latestCheck.tax_quarter} · {latestCheck.notes}
                </p>
              </div>
              <p className="flex-shrink-0 text-xs text-[#86a88e]">
                Checked {formatCheckDate(latestCheck.checked_at)}
              </p>
            </div>
          </div>
        )}

        <section className="mb-6 space-y-2" aria-label="Review coverage" data-testid="financial-review-coverage">
          <h2>Review coverage</h2>
          <p>As of {summary.as_of} (UTC date).</p>
          <p>GBP figures come from approved ledger records. This operational summary does not certify source completeness, expense eligibility or tax filing readiness.</p>
          <p>{summary.unresolved_source_count} imported transaction(s) need review. {summary.external_invoice_count} preserved external invoice balance(s) are unsupported here.</p>
          <p data-testid="review-bank-year-coverage">{summary.source_count} active bank observations in this tax year; {summary.unsupported_source_count} unsupported sources; {summary.source_unavailable_count} with unavailable source metadata. These counts overlap. Discarded and other-year observations remain context below.</p>
          <p>{summary.native_overdue_count} native GBP invoice(s) are past due with a positive reconciled balance. Manual paid markers do not establish cash receipt.</p>
          <ul>{summary.invoice_groups.map(g=><li key={g.currency} data-testid={`review-invoice-currency-${g.currency}`}>{g.invoice_count} finalised invoice(s): {fxAggregateReadback(g.original_total_minor,g.currency)} original document value, separate from cash.</li>)}</ul>
          <Link href="/dashboard/reconciliation/fx/evidence" data-testid="review-external-evidence">Review external invoice evidence</Link>
        </section>
        <BankSourceCoverage coverage={summary.bank_source_coverage}/>
        <div className="rounded-xl border border-[#bbf7d0] bg-white p-5">
          <RecordsReviewAgent key={summary.stamp} summary={summary} />
        </div>

        <BatchCategorisePanel uncategorisedCount={globalUncategorisedCount} />

        <p className="mt-6 text-center text-xs text-[#86a88e]">
          The AI review uses the displayed counts and generated sample labels after your consent. Category suggestions remain a separate review and write only after explicit approval.
        </p>
      </div>
    </main>
  );
}

function formatCheckDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

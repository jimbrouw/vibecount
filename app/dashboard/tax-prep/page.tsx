import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatPounds } from "@/lib/invoices/money";
import {
  getCurrentTaxYearStart,
  getTaxYearLabel,
} from "@/lib/records/tax-periods";
import { buildSelfAssessmentChecklist } from "@/lib/records/self-assessment";
import {
  readTaxPrepData,
  type TaxPrepRecord,
  type TaxPrepYear,
} from "@/lib/records/tax-prep-data";
import { AccountantHandoverPack } from "./AccountantHandoverPack";
import { buildAccountantHandover } from "@/lib/tax/accountant-handover";
import LogoutButton from "../LogoutButton";
import PlainLanguageNote from "../PlainLanguageNote";

export const metadata = {
  title: "Self Assessment Prep — VibeCount",
  description:
    "Plain-English Self Assessment preparation from approved records.",
};

type TaxYearRow = {
  tax_year_start: number;
};

export default async function TaxPrepPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const currentTaxYearStart = getCurrentTaxYearStart();
  const params = await searchParams;
  const selectedTaxYearStart = getSelectedTaxYearStart(
    params,
    currentTaxYearStart,
  );

  const data = await readTaxPrepData(
    async (afterId) => {
      let query = supabase
        .from("financial_records")
        .select(
          "id, record_type, amount, effect_sign, cash_effect_pence, cash_treatment, record_categories(name, sa103_box)",
        )
        .eq("user_id", user.id)
        .eq("status", "approved")
        .eq("tax_year_start", selectedTaxYearStart)
        .order("id", { ascending: true })
        .limit(1000);
      if (afterId) query = query.gt("id", afterId);
      const result = await query;
      return {
        data: result.data as unknown as TaxPrepRecord[] | null,
        error: result.error,
      };
    },
    async (afterId) => {
      let query = supabase
        .from("financial_records")
        .select("id, tax_year_start")
        .eq("user_id", user.id)
        .eq("status", "approved")
        .order("id", { ascending: true })
        .limit(1000);
      if (afterId) query = query.gt("id", afterId);
      const result = await query;
      return { data: result.data as TaxPrepYear[] | null, error: result.error };
    },
  );

  if (data.status === "unavailable") {
    return (
      <main className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="text-2xl font-semibold">Self Assessment prep</h1>
        <div
          role="alert"
          data-testid="tax-prep-load-error"
          className="my-6 rounded-lg border border-amber-400 bg-amber-50 p-4"
        >
          <p>
            We could not load your complete records. Your figures and tax
            estimate are unavailable.
          </p>
          <p className="mt-2">
            Try loading this page again before reviewing or exporting your
            figures.
          </p>
        </div>
        <Link
          href={`/dashboard/tax-prep?taxYearStart=${selectedTaxYearStart}`}
          data-testid="tax-prep-retry"
        >
          Try again
        </Link>
        <p className="mt-4">
          <Link
            href="/dashboard/records"
            data-testid="tax-prep-back-to-records"
          >
            Back to records
          </Link>
        </p>
      </main>
    );
  }

  const checklist = buildSelfAssessmentChecklist(data.records);
  const taxYearOptions = buildTaxYearOptions(currentTaxYearStart, data.years);

  const { data: userSettings } = await supabase
    .from("user_settings")
    .select("legal_name")
    .eq("id", user.id)
    .maybeSingle();

  const userName =
    userSettings?.legal_name || user.email?.split("@")[0] || "Sole Trader";

  const handoverData = buildAccountantHandover({
    userName,
    taxYearStart: selectedTaxYearStart,
    incomeTotalPence: checklist.incomeTotal,
    expenseTotalPence: checklist.expenseTotal,
    profitTotalPence: checklist.profitTotal,
    incomeCount: checklist.incomeCount,
    expenseCount: checklist.expenseCount,
    sa103Boxes: [],
  });

  return (
    <main className="min-h-screen bg-[#f0fdf4]">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#15803d] bg-[#15803d] px-6 py-4 sm:px-8">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-lg font-semibold text-white">
            VibeCount
          </Link>
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
              href="/dashboard/tax-prep"
              className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium text-white"
            >
              Tax prep
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
          <span className="hidden text-sm text-white/80 sm:block">
            {user.email}
          </span>
          <LogoutButton />
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#14532d]">
              Self Assessment prep
            </h1>
            <p className="mt-1 text-sm text-[#166534]">
              Plain-English SA103S / SA103F checklist for{" "}
              {getTaxYearLabel(selectedTaxYearStart)}.
            </p>
            <div className="mt-3 max-w-2xl">
              <PlainLanguageNote>
                This page helps prepare and review your self-employment figures.
                It does not file a tax return and is not tax advice.
              </PlainLanguageNote>
            </div>
          </div>
          <form
            className="flex items-center gap-2"
            action="/dashboard/tax-prep"
            data-testid="tax-prep-year-form"
          >
            <label
              htmlFor="taxYearStart"
              className="text-xs font-semibold uppercase tracking-widest text-[#166534]"
            >
              Tax year
            </label>
            <select
              id="taxYearStart"
              name="taxYearStart"
              data-testid="tax-prep-year-select"
              className="h-10 rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm font-semibold text-[#14532d]"
              defaultValue={selectedTaxYearStart}
            >
              {taxYearOptions.map((yearStart) => (
                <option key={yearStart} value={yearStart}>
                  {getTaxYearLabel(yearStart)}
                </option>
              ))}
            </select>
            <button
              type="submit"
              data-testid="tax-prep-year-submit-button"
              className="inline-flex h-10 items-center rounded-lg bg-[#15803d] px-4 text-sm font-semibold text-white transition hover:bg-[#14532d]"
            >
              Show
            </button>
          </form>
        </div>

        {checklist.cashExcludedCount>0&&<p data-testid="tax-prep-cash-exclusions" className="mb-4 text-sm">{checklist.cashExcludedCount} records excluded from GBP cash totals: unpaid, unsupported currency or not approved. Original evidence remains in Records.</p>}

        <AccountantHandoverPack
          taxYearStart={selectedTaxYearStart}
          taxYearLabel={getTaxYearLabel(selectedTaxYearStart)}
          incomeTotalPence={checklist.incomeTotal}
          expenseTotalPence={checklist.expenseTotal}
          profitTotalPence={checklist.profitTotal}
          incomeCount={checklist.incomeCount}
          expenseCount={checklist.expenseCount}
          emailTemplateText={handoverData.emailTemplateText}
        />

        <section className="mb-6 grid gap-4 sm:grid-cols-3">
          <SummaryTile
            label="Income"
            value={formatPounds(checklist.incomeTotal)}
          />
          <SummaryTile
            label="Expenses"
            value={formatPounds(checklist.expenseTotal)}
          />
          <SummaryTile
            label="Net profit before review"
            value={formatPounds(checklist.profitTotal)}
          />
        </section>

        <section className="mb-6 rounded-xl border border-[#bbf7d0] bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[#14532d]">
            Tax estimate needs reviewed facts
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#4b8068]">
            Trading net profit alone cannot establish your Income Tax, National
            Insurance or payments on account. Review jurisdiction, accounting
            basis, PAYE, pensions, other income and actual tax credits. Missing
            inputs stay unresolved.
          </p>
          <p className="mt-2 text-sm">
            Draft — not submitted to HMRC. This checklist is a preparation aid,
            not tax advice or a complete liability calculation.
          </p>
          <Link
            href={`/dashboard/tax-prep/facts?year=${selectedTaxYearStart}`}
            data-testid="tax-prep-reviewed-facts-link"
            className="mt-3 inline-block rounded border p-2"
          >
            Review tax-year profile and evidence-linked facts
          </Link>
          <Link
            href={`/dashboard/tax-prep/calculation?year=${selectedTaxYearStart}`}
            data-testid="tax-prep-calculation-link"
            className="ml-3 mt-3 inline-block rounded border p-2"
          >
            Review draft tax calculation
          </Link>
          <Link
            href={`/dashboard/tax-prep/filing-pack?year=${selectedTaxYearStart}`}
            data-testid="tax-prep-filing-pack-link"
            className="ml-3 mt-3 inline-block rounded border p-2"
          >
            Guided draft filing pack
          </Link>
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href={`/api/tax-prep/export?taxYearStart=${selectedTaxYearStart}`}
              data-testid="tax-prep-export-pack-link"
              className="inline-flex h-10 items-center rounded-lg bg-[#15803d] px-4 text-sm font-semibold text-white transition hover:bg-[#14532d]"
            >
              Export tax prep pack (CSV)
            </a>
            <a
              href={`/api/tax-prep/export?taxYearStart=${selectedTaxYearStart}&format=txt`}
              data-testid="tax-prep-export-text-link"
              className="inline-flex h-10 items-center rounded-lg border border-[#bbf7d0] bg-white px-4 text-sm font-semibold text-[#14532d] transition hover:bg-[#f0fdf4]"
            >
              Export text summary
            </a>
          </div>
        </section>

        <section className="rounded-xl border border-[#bbf7d0] bg-white shadow-sm">
          <div className="border-b border-[#f0fdf4] px-5 py-4">
            <h2 className="text-base font-semibold text-[#14532d]">
              Plain-English checklist
            </h2>
            <p className="mt-1 text-sm text-[#4b8068]">
              Suggested values come only from approved VibeCount records.
            </p>
          </div>
          <div className="divide-y divide-[#f0fdf4]">
            {checklist.items.map((item) => (
              <div
                key={item.id}
                className="grid gap-4 px-5 py-5 lg:grid-cols-[1.2fr_0.8fr]"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-[#14532d]">
                      {item.officialLabel}
                    </p>
                    <FillModeBadge mode={item.fillMode} />
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[#4b8068]">
                    {item.plainEnglish}
                  </p>
                  <p className="mt-2 text-xs text-[#166534]">
                    Why HMRC asks: {item.whyItMatters}
                  </p>
                  <p className="mt-1 text-xs text-[#4b8068]">
                    Review note: {item.reviewNote}
                  </p>
                </div>
                <div className="rounded-lg border border-[#dcfce7] bg-[#f7fef9] p-4">
                  <p className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
                    Suggested answer
                  </p>
                  <p className="mt-2 text-lg font-semibold text-[#14532d]">
                    {item.suggestedValue}
                  </p>
                  <p className="mt-2 text-xs text-[#4b8068]">
                    Source: {item.dataSource}
                  </p>
                  <p className="mt-1 text-xs text-[#4b8068]">
                    Evidence: {item.evidence}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#bbf7d0] bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold text-[#14532d]">{value}</p>
    </div>
  );
}

function FillModeBadge({
  mode,
}: {
  mode: "suggested" | "needs_user" | "accountant_review";
}) {
  const label =
    mode === "suggested"
      ? "Suggested"
      : mode === "needs_user"
        ? "Needs input"
        : "Review";
  const className =
    mode === "suggested"
      ? "bg-[#dcfce7] text-[#15803d]"
      : mode === "needs_user"
        ? "bg-[#e0f2fe] text-[#075985]"
        : "bg-[#fef3c7] text-[#92400e]";

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

function getSelectedTaxYearStart(
  params: { [key: string]: string | string[] | undefined },
  fallback: number,
) {
  const value = params.taxYearStart;
  const requested = Number(Array.isArray(value) ? value[0] : value);

  if (Number.isInteger(requested) && requested >= 2020 && requested <= 2100) {
    return requested;
  }

  return fallback;
}

function buildTaxYearOptions(currentTaxYearStart: number, rows: TaxYearRow[]) {
  const yearStarts = new Set([
    currentTaxYearStart + 1,
    currentTaxYearStart,
    currentTaxYearStart - 1,
    ...rows.map((row) => row.tax_year_start),
  ]);

  return [...yearStarts].sort((a, b) => b - a);
}

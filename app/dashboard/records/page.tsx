import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatPounds } from "@/lib/invoices/money";
import {
  ensureRecordCategories,
  withFallbackRecordCategories,
} from "@/lib/records/categories";
import {
  buildQuarterSummaries,
  getCurrentTaxYearStart,
  getTaxYearLabel,
  getThresholdStatus,
  MTD_THRESHOLDS_PENCE,
} from "@/lib/records/tax-periods";
import {
  commitApprovedBankRows,
  commitApprovedCsvRows,
  createManualRecord,
  setBankStatementRowStatus,
  setManualRecordStatus,
  setCsvImportRowStatus,
  updateManualRecord,
  uploadBankStatement,
  uploadRecordsCsv,
} from "./actions";
import LogoutButton from "../LogoutButton";
import PlainLanguageNote from "../PlainLanguageNote";
import SuggestCategoryButton from "./SuggestCategoryButton";

export const metadata = {
  title: "Records — VibeCount",
  description: "MTD-ready income and expense record summaries.",
};

type CategoryOption = {
  id: string;
  name: string;
  record_type: "income" | "expense";
  is_default?: boolean;
};

type ManualRecordRow = {
  id: string;
  record_type: "income" | "expense";
  record_date: string;
  description: string;
  amount: string | number;
  status: "draft" | "review" | "approved" | "excluded";
  source_type: string;
  category_id: string | null;
  tax_year_start: number;
  tax_quarter: number;
  record_categories: { name: string } | null;
};

type TaxYearRow = {
  tax_year_start: number;
};

type CsvImportReviewRow = {
  id: string;
  row_number: number;
  record_type: "income" | "expense";
  record_date: string | null;
  description: string | null;
  amount: string | number | null;
  status: "review" | "approved" | "discarded" | "committed" | "invalid";
  error_message: string | null;
  record_imports: { original_filename: string | null } | null;
  record_categories: { name: string } | null;
};

type BankStatementReviewRow = {
  id: string;
  row_number: number;
  record_type: "income" | "expense";
  record_date: string | null;
  description: string | null;
  amount: string | number | null;
  status: "review" | "approved" | "discarded" | "committed" | "invalid";
  error_message: string | null;
  redacted_line: string;
  record_imports: { original_filename: string | null } | null;
  record_categories: { name: string } | null;
};

export default async function RecordsPage({
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
  const resolvedSearchParams = await searchParams;
  const pageMessage = getPageMessage(resolvedSearchParams);
  const activeTab = getRecordsTab(resolvedSearchParams);
  const selectedTaxYearStart = getSelectedTaxYearStart(
    resolvedSearchParams,
    currentTaxYearStart
  );

  const categories = await ensureRecordCategories(supabase, user.id);
  const manualCategoryOptions = withFallbackRecordCategories(categories);

  const { data: settingsRow } = await supabase
    .from("user_settings")
    .select("tax_pot_percentage")
    .eq("id", user.id)
    .maybeSingle();

  const [
    summaryResult,
    categoryResult,
    recordsResult,
    attachmentResult,
    exportResult,
    manualRecordsResult,
    taxYearsResult,
    csvRowsResult,
    bankRowsResult,
  ] = await Promise.all([
      supabase
        .from("financial_record_quarter_summaries")
        .select(
          "tax_quarter, income_total, expense_total, net_total, income_count, expense_count"
        )
        .eq("user_id", user.id)
        .eq("tax_year_start", selectedTaxYearStart),
      supabase
        .from("record_categories")
        .select("id", { count: "exact", head: true })
        .or(`user_id.eq.${user.id},is_default.eq.true`),
      supabase
        .from("financial_records")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
      supabase
        .from("record_attachments")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "active"),
      supabase
        .from("record_exports")
        .select("requested_at")
        .eq("user_id", user.id)
        .order("requested_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("financial_records")
        .select(
          "id, record_type, record_date, description, amount, status, source_type, category_id, tax_year_start, tax_quarter, record_categories(name)"
        )
        .eq("user_id", user.id)
        .order("record_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("financial_records")
        .select("tax_year_start")
        .eq("user_id", user.id)
        .eq("status", "approved"),
      supabase
        .from("csv_import_rows")
        .select(
          "id, row_number, record_type, record_date, description, amount, status, error_message, record_imports(original_filename), record_categories(name)"
        )
        .eq("user_id", user.id)
        .in("status", ["review", "approved", "discarded", "invalid"])
        .order("created_at", { ascending: false })
        .order("row_number", { ascending: true })
        .limit(20),
      supabase
        .from("bank_statement_import_rows")
        .select(
          "id, row_number, record_type, record_date, description, amount, status, error_message, redacted_line, record_imports(original_filename), record_categories(name)"
        )
        .eq("user_id", user.id)
        .in("status", ["review", "approved", "discarded", "invalid"])
        .order("created_at", { ascending: false })
        .order("row_number", { ascending: true })
        .limit(20),
    ]);

  const manualRecords = (manualRecordsResult.data ?? []) as unknown as ManualRecordRow[];
  const csvRows = (csvRowsResult.data ?? []) as unknown as CsvImportReviewRow[];
  const bankRows = (bankRowsResult.data ?? []) as unknown as BankStatementReviewRow[];
  const taxYearOptions = buildTaxYearOptions(
    currentTaxYearStart,
    (taxYearsResult.data ?? []) as TaxYearRow[]
  );
  const summaries = buildQuarterSummaries(
    selectedTaxYearStart,
    (summaryResult.data ?? []) as Parameters<typeof buildQuarterSummaries>[1]
  );
  const annualIncomePence = summaries.reduce(
    (total, summary) => total + summary.incomePence,
    0
  );
  const annualExpensePence = summaries.reduce(
    (total, summary) => total + summary.expensePence,
    0
  );
  const thresholdStatus = getThresholdStatus(annualIncomePence);
  const netIncomePence = annualIncomePence - annualExpensePence;
  const taxPotPercentage = settingsRow?.tax_pot_percentage ?? 27.00;
  const taxPotEstimatePence = Math.max(0, Math.round(netIncomePence * (taxPotPercentage / 100)));

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
              className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium text-white"
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
              className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white"
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
          <span className="hidden text-sm text-white/80 sm:block">{user.email}</span>
          <LogoutButton />
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#14532d]">
              Records
            </h1>
            <p className="mt-1 text-sm text-[#166534]">
              Income, expenses, imports, and export packs for{" "}
              {getTaxYearLabel(selectedTaxYearStart)}.
            </p>
            <div className="mt-3 max-w-2xl">
              <PlainLanguageNote>
                This is a record-keeping foundation, not HMRC-recognised filing
                software. It keeps the figures organised before any tax submission
                workflow is added.
              </PlainLanguageNote>
            </div>
          </div>
          <div className="rounded-xl border border-[#bbf7d0] bg-white px-4 py-3 text-sm shadow-sm">
            <p className="font-semibold text-[#14532d]">
              {recordsResult.count ?? 0} approved records
            </p>
            <p className="mt-0.5 text-xs text-[#4b8068]">
              {Math.max(
                categoryResult.count ?? 0,
                categories.length,
                manualCategoryOptions.length
              )} categories ready
            </p>
          </div>
        </div>

        {pageMessage && (
          <div
            className={`mb-6 rounded-xl border p-4 text-sm ${
              pageMessage.type === "error"
                ? "border-red-200 bg-red-50 text-red-800"
                : "border-[#bbf7d0] bg-white text-[#14532d]"
            }`}
          >
            {pageMessage.text}
          </div>
        )}

        <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryTile
            label="Income"
            value={formatPounds(annualIncomePence)}
          />
          <SummaryTile
            label="Expenses"
            value={formatPounds(annualExpensePence)}
          />
          <SummaryTile
            label="Net"
            value={formatPounds(netIncomePence)}
          />
          <SummaryTile
            label="Tax pot nudge"
            value={formatPounds(taxPotEstimatePence)}
          />
          <SummaryTile
            label="Approved records"
            value={String(recordsResult.count ?? 0)}
          />
        </section>

        <nav className="mb-6 flex flex-wrap gap-2 border-b border-[#dfe5df]">
          {[
            ["records", "Records"],
            ["csv", "CSV import"],
            ["bank", "Bank import"],
            ["exports", "Exports"],
          ].map(([tab, label]) => (
            <Link
              key={tab}
              href={`/dashboard/records?taxYearStart=${selectedTaxYearStart}&tab=${tab}`}
              className={`-mb-px rounded-t-md border border-b-0 px-4 py-2 text-sm font-semibold ${
                activeTab === tab
                  ? "border-[#dfe5df] bg-white text-[#17251d]"
                  : "border-transparent text-[#66756b] hover:bg-white hover:text-[#17251d]"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        <section
          className={`mb-6 rounded-xl border border-[#bbf7d0] bg-white p-5 shadow-sm ${
            activeTab === "exports" ? "" : "hidden"
          }`}
        >
          <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <h2 className="text-base font-semibold text-[#14532d]">
                Secure records storage
              </h2>
              <p className="mt-1 text-sm leading-6 text-[#4b8068]">
                Approved records, attachment metadata, and change history are kept
                behind per-user row-level security. Attachments use private storage
                and short-lived signed links.
              </p>
              <p className="mt-2 text-xs font-medium text-[#166534]">
                Positioning: MTD-ready records, not HMRC-recognised MTD software.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-lg border border-[#dcfce7] bg-[#f7fef9] p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
                  Attachments
                </p>
                <p className="mt-2 text-lg font-semibold text-[#14532d]">
                  {attachmentResult.count ?? 0}
                </p>
                <p className="mt-1 text-xs text-[#4b8068]">Active stored files</p>
              </div>
              <div className="rounded-lg border border-[#dcfce7] bg-[#f7fef9] p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
                  Latest export
                </p>
                <p className="mt-2 text-sm font-semibold text-[#14532d]">
                  {formatExportDate(exportResult.data?.requested_at)}
                </p>
                <p className="mt-1 text-xs text-[#4b8068]">Logged for audit trail</p>
              </div>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href={`/api/records/export?taxYearStart=${selectedTaxYearStart}&format=json`}
              data-testid="records-export-json-link"
              className="inline-flex h-10 items-center rounded-lg bg-[#15803d] px-4 text-sm font-semibold text-white transition hover:bg-[#14532d]"
            >
              Export JSON
            </a>
            <a
              href={`/api/records/export?taxYearStart=${selectedTaxYearStart}&format=csv`}
              data-testid="records-export-csv-link"
              className="inline-flex h-10 items-center rounded-lg border border-[#bbf7d0] bg-white px-4 text-sm font-semibold text-[#14532d] transition hover:bg-[#f0fdf4]"
            >
              Export CSV
            </a>
          </div>
        </section>

        <section
          className={`mb-6 grid gap-6 lg:grid-cols-[0.95fr_1.25fr] ${
            activeTab === "records" ? "" : "hidden"
          }`}
        >
          <ManualRecordForm categories={manualCategoryOptions} />
          <ManualRecordsList records={manualRecords} categories={manualCategoryOptions} />
        </section>

        {activeTab === "csv" ? <CsvImportPanel rows={csvRows} /> : null}
        {activeTab === "bank" ? <BankStatementPanel rows={bankRows} /> : null}

        <section
          className={`mb-6 rounded-xl border border-[#bbf7d0] bg-white p-5 shadow-sm ${
            activeTab === "records" ? "" : "hidden"
          }`}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-[#14532d]">
                Tax year and threshold tracker
              </h2>
              <p className="mt-1 text-sm text-[#4b8068]">
                Self-employment totals by quarter, based on approved records only.
              </p>
            </div>
            <form className="flex items-center gap-2" action="/dashboard/records">
              <label
                htmlFor="taxYearStart"
                className="text-xs font-semibold uppercase tracking-widest text-[#166534]"
              >
                Tax year
              </label>
              <select
                id="taxYearStart"
                name="taxYearStart"
                data-testid="records-tax-year-select"
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
                data-testid="records-tax-year-submit-button"
                className="inline-flex h-10 items-center rounded-lg bg-[#15803d] px-4 text-sm font-semibold text-white transition hover:bg-[#14532d]"
              >
                Show
              </button>
            </form>
          </div>
          <div className="mt-5 rounded-lg border border-[#dcfce7] bg-[#f7fef9] p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-semibold text-[#14532d]">
                {thresholdStatus.highestReachedPence
                  ? `Reached ${formatPounds(thresholdStatus.highestReachedPence)} threshold`
                  : `Next threshold: ${formatPounds(thresholdStatus.nextThresholdPence)}`}
              </p>
              <p className="text-xs text-[#4b8068]">
                Income before expenses: {formatPounds(annualIncomePence)}
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {MTD_THRESHOLDS_PENCE.map((threshold) => {
              const progress = Math.min(100, (annualIncomePence / threshold) * 100);

              return (
                <div key={threshold}>
                  <div className="mb-1 flex items-center justify-between text-xs font-medium text-[#166534]">
                    <span>{formatPounds(threshold)}</span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#dcfce7]">
                    <div
                      className="h-full rounded-full bg-[#15803d]"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section
          className={`rounded-xl border border-[#bbf7d0] bg-white shadow-sm ${
            activeTab === "records" ? "" : "hidden"
          }`}
        >
          <div className="border-b border-[#f0fdf4] px-5 py-3">
            <h2 className="text-sm font-semibold text-[#14532d]">
              Quarter summaries for {getTaxYearLabel(selectedTaxYearStart)}
            </h2>
          </div>
          <div className="divide-y divide-[#f0fdf4]">
            {summaries.map((summary) => (
              <div
                key={summary.taxQuarter}
                className="grid gap-3 px-5 py-4 sm:grid-cols-[1.2fr_1fr_1fr_1fr]"
              >
                <div>
                  <p className="text-sm font-semibold text-[#14532d]">{summary.label}</p>
                  <p className="mt-0.5 text-xs text-[#4b8068]">{summary.period}</p>
                </div>
                <QuarterAmount
                  label={`${summary.incomeCount} income records`}
                  value={summary.incomePence}
                />
                <QuarterAmount
                  label={`${summary.expenseCount} expense records`}
                  value={summary.expensePence}
                />
                <QuarterAmount label="Net" value={summary.netPence} strong />
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function ManualRecordForm({ categories }: { categories: CategoryOption[] }) {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="rounded-xl border border-[#bbf7d0] bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-[#14532d]">Add a record</h2>
      <p className="mt-1 text-sm text-[#4b8068]">
        Enter income or expenses now. Imports can use the same record model later.
      </p>
      <form action={createManualRecord} className="mt-5 space-y-4" data-testid="record-create-form">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
              Type
            </span>
            <select
              name="recordType"
              data-testid="record-type-select"
              className="mt-1 h-11 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d]"
              defaultValue="income"
              required
            >
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
              Date
            </span>
            <input
              name="recordDate"
              data-testid="record-date-input"
              type="date"
              className="mt-1 h-11 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d]"
              defaultValue={today}
              required
            />
          </label>
        </div>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
            Description
          </span>
          <input
            name="description"
            data-testid="record-description-input"
            className="mt-1 h-11 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d]"
            placeholder="Client work, software, train fare"
            required
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
              Amount
            </span>
            <input
              name="amount"
              data-testid="record-amount-input"
              inputMode="decimal"
              className="mt-1 h-11 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d]"
              placeholder="125.00"
              required
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
              Category
            </span>
            <CategorySelect categories={categories} testId="record-category-select" />
          </label>
        </div>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
            Review state
          </span>
          <select
            name="status"
            data-testid="record-status-select"
            className="mt-1 h-11 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d]"
            defaultValue="review"
          >
            <option value="review">Needs review</option>
          </select>
          <span className="mt-1 block text-xs text-[#4b8068]">
            New records are saved for review first. Approve them from the review list.
          </span>
        </label>
        <button
          type="submit"
          data-testid="record-save-button"
          className="inline-flex h-11 items-center rounded-lg bg-[#15803d] px-5 text-sm font-semibold text-white transition hover:bg-[#14532d]"
        >
          Save record
        </button>
      </form>
    </section>
  );
}

function ManualRecordsList({
  records,
  categories,
}: {
  records: ManualRecordRow[];
  categories: CategoryOption[];
}) {
  return (
    <section className="rounded-xl border border-[#bbf7d0] bg-white shadow-sm">
      <div className="border-b border-[#f0fdf4] px-5 py-4">
        <h2 className="text-base font-semibold text-[#14532d]">Review records</h2>
        <p className="mt-1 text-sm text-[#4b8068]">
          Edit, approve, or exclude manual records before they count in summaries.
        </p>
      </div>
      {records.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm text-[#4b8068]">No manual records yet.</p>
          <p className="mt-1 text-xs text-[#86a88e]">
            Add one on the left to start your digital record book.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[#f0fdf4]">
          {records.map((record) => (
            <details key={record.id} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-[#14532d]">
                      {record.description}
                    </p>
                    <StatusBadge status={record.status} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#4b8068]">
                    <span>
                      {formatRecordDate(record.record_date)} ·{" "}
                      {record.record_categories?.name ?? "No category"} · Quarter{" "}
                      {record.tax_quarter}
                    </span>
                    {!record.category_id && (
                      <SuggestCategoryButton recordId={record.id} />
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-[#14532d]">
                    {record.record_type === "expense" ? "-" : ""}
                    {formatPounds(Math.round(Number(record.amount) * 100))}
                  </p>
                  <p className="mt-1 text-xs text-[#4b8068]">Edit</p>
                </div>
              </summary>
              <div className="border-t border-[#f0fdf4] bg-[#f7fef9] px-5 py-4">
                <form action={updateManualRecord} className="grid gap-4" data-testid={`record-review-form-${record.id}`}>
                  <input type="hidden" name="recordId" value={record.id} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
                        Type
                      </span>
                      <select
                        name="recordType"
                        data-testid={`record-review-type-select-${record.id}`}
                        className="mt-1 h-10 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d]"
                        defaultValue={record.record_type}
                      >
                        <option value="income">Income</option>
                        <option value="expense">Expense</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
                        Date
                      </span>
                      <input
                        name="recordDate"
                        data-testid={`record-review-date-input-${record.id}`}
                        type="date"
                        className="mt-1 h-10 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d]"
                        defaultValue={record.record_date}
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
                      Description
                    </span>
                    <input
                      name="description"
                      data-testid={`record-review-description-input-${record.id}`}
                      className="mt-1 h-10 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d]"
                      defaultValue={record.description}
                    />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="block">
                      <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
                        Amount
                      </span>
                      <input
                        name="amount"
                        data-testid={`record-review-amount-input-${record.id}`}
                        inputMode="decimal"
                        className="mt-1 h-10 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d]"
                        defaultValue={Number(record.amount).toFixed(2)}
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
                        Category
                      </span>
                      <CategorySelect
                        categories={categories}
                        defaultValue={record.category_id ?? undefined}
                        testId={`record-review-category-select-${record.id}`}
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="block min-w-44">
                      <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
                        Review state
                      </span>
                      <select
                        name="status"
                        data-testid={`record-review-status-select-${record.id}`}
                        className="mt-1 h-10 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d]"
                        defaultValue={record.status}
                      >
                        <option value="review">Needs review</option>
                        <option value="approved">Approved</option>
                        <option value="excluded">Excluded</option>
                      </select>
                    </label>
                    <button
                      type="submit"
                      data-testid={`record-review-save-button-${record.id}`}
                      className="inline-flex h-10 items-center rounded-lg bg-[#15803d] px-4 text-sm font-semibold text-white transition hover:bg-[#14532d]"
                    >
                      Save changes
                    </button>
                  </div>
                </form>
                <div className="mt-4 flex flex-wrap gap-3">
                  <ReviewButton recordId={record.id} status="approved" label="Approve" />
                  <ReviewButton recordId={record.id} status="excluded" label="Exclude" />
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

function CsvImportPanel({ rows }: { rows: CsvImportReviewRow[] }) {
  const approvedCount = rows.filter((row) => row.status === "approved").length;

  return (
    <section className="mb-6 rounded-xl border border-[#bbf7d0] bg-white shadow-sm">
      <div className="grid gap-5 border-b border-[#f0fdf4] p-5 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <h2 className="text-base font-semibold text-[#14532d]">CSV import</h2>
          <p className="mt-1 text-sm leading-6 text-[#4b8068]">
            Upload spreadsheet rows into review first. Only approved rows become
            income or expense records.
          </p>
          <p className="mt-2 text-xs text-[#166534]">
            Accepted headers include date, description/details, amount, debit/credit,
            paid in/paid out, and category. Rows are staged for review before they
            affect tax prep.
          </p>
        </div>
        <form action={uploadRecordsCsv} className="flex flex-col gap-3" data-testid="csv-import-upload-form">
          <label htmlFor="csvFile" className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
            Choose CSV file
          </label>
          <input
            id="csvFile"
            name="csvFile"
            data-testid="csv-import-file-input"
            type="file"
            accept=".csv,text/csv"
            className={fileInputCls}
            required
          />
          <div>
            <button
              type="submit"
              data-testid="csv-import-upload-button"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-[#15803d] px-5 text-sm font-semibold text-white transition hover:bg-[#14532d]"
            >
              Upload CSV
            </button>
          </div>
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm text-[#4b8068]">No CSV rows waiting for review.</p>
          <p className="mt-1 text-xs text-[#86a88e]">
            Uploaded rows will appear here before they affect your records.
          </p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-[#f0fdf4]">
            {rows.map((row) => (
              <div
                key={row.id}
                className="grid gap-3 px-5 py-4 lg:grid-cols-[0.8fr_1fr_0.7fr_0.8fr]"
              >
                <div>
                  <p className="text-sm font-semibold text-[#14532d]">
                    Row {row.row_number}
                  </p>
                  <p className="mt-1 text-xs text-[#4b8068]">
                    {row.record_imports?.original_filename ?? "CSV import"}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-[#14532d]">
                    {row.description || "Missing description"}
                  </p>
                  <p className="mt-1 text-xs text-[#4b8068]">
                    {row.record_date ? formatRecordDate(row.record_date) : "Missing date"} ·{" "}
                    {row.record_categories?.name ?? "No category"}
                  </p>
                  {row.error_message && (
                    <p className="mt-1 text-xs font-medium text-red-700">
                      {row.error_message}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
                    {row.record_type}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[#14532d]">
                    {row.amount === null
                      ? "Missing amount"
                      : formatPounds(Math.round(Number(row.amount) * 100))}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={row.status} />
                  {row.status !== "invalid" && (
                    <>
                      <CsvRowButton rowId={row.id} status="approved" label="Approve" />
                      <CsvRowButton rowId={row.id} status="discarded" label="Discard" />
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3 border-t border-[#f0fdf4] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[#4b8068]">
              {approvedCount} approved rows ready to commit.
            </p>
            <form action={commitApprovedCsvRows} data-testid="csv-import-commit-form">
              <button
                type="submit"
                data-testid="csv-import-commit-approved-button"
                className="inline-flex h-10 items-center rounded-lg bg-[#15803d] px-4 text-sm font-semibold text-white transition hover:bg-[#14532d]"
              >
                Commit approved rows
              </button>
            </form>
          </div>
        </>
      )}
    </section>
  );
}

function CsvRowButton({
  rowId,
  status,
  label,
}: {
  rowId: string;
  status: "approved" | "discarded";
  label: string;
}) {
  return (
    <form action={setCsvImportRowStatus} data-testid={`csv-import-row-form-${rowId}`}>
      <input type="hidden" name="rowId" value={rowId} />
      <input type="hidden" name="status" value={status} />
      <button
        type="submit"
        data-testid={`csv-import-row-${status}-button-${rowId}`}
        className="inline-flex h-9 items-center rounded-lg border border-[#bbf7d0] bg-white px-3 text-xs font-semibold text-[#14532d] transition hover:bg-[#f0fdf4]"
      >
        {label}
      </button>
    </form>
  );
}

function BankStatementPanel({ rows }: { rows: BankStatementReviewRow[] }) {
  const approvedCount = rows.filter((row) => row.status === "approved").length;

  return (
    <section className="mb-6 rounded-xl border border-[#bbf7d0] bg-white shadow-sm">
      <div className="grid gap-5 border-b border-[#f0fdf4] p-5 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <h2 className="text-base font-semibold text-[#14532d]">
            Bank statement prototype
          </h2>
          <p className="mt-1 text-sm leading-6 text-[#4b8068]">
            Upload statement text or a text-readable PDF. VibeCount redacts
            account-like numbers before staging rows, and does not store the raw
            statement file. Scanned image-only PDFs still need CSV or text export.
          </p>
        </div>
        <form action={uploadBankStatement} className="flex flex-col gap-3" data-testid="bank-import-upload-form">
          <label htmlFor="statementFile" className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
            Choose statement PDF or text file
          </label>
          <input
            id="statementFile"
            name="statementFile"
            data-testid="bank-import-file-input"
            type="file"
            accept=".pdf,.txt,text/plain,application/pdf"
            className={fileInputCls}
            required
          />
          <div>
            <button
              type="submit"
              data-testid="bank-import-upload-button"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-[#15803d] px-5 text-sm font-semibold text-white transition hover:bg-[#14532d]"
            >
              Upload statement
            </button>
          </div>
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm text-[#4b8068]">No bank statement rows waiting for review.</p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-[#f0fdf4]">
            {rows.map((row) => (
              <div
                key={row.id}
                className="grid gap-3 px-5 py-4 lg:grid-cols-[0.8fr_1fr_0.7fr_0.8fr]"
              >
                <div>
                  <p className="text-sm font-semibold text-[#14532d]">
                    Row {row.row_number}
                  </p>
                  <p className="mt-1 text-xs text-[#4b8068]">
                    {row.record_imports?.original_filename ?? "Bank statement"}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-[#14532d]">
                    {row.description || "Missing description"}
                  </p>
                  <p className="mt-1 text-xs text-[#4b8068]">
                    {row.record_date ? formatRecordDate(row.record_date) : "Missing date"} ·{" "}
                    {row.record_categories?.name ?? "No category"}
                  </p>
                  <p className="mt-1 text-xs text-[#86a88e]">
                    Redacted: {row.redacted_line}
                  </p>
                  {row.error_message && (
                    <p className="mt-1 text-xs font-medium text-red-700">
                      {row.error_message}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
                    {row.record_type}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[#14532d]">
                    {row.amount === null
                      ? "Missing amount"
                      : formatPounds(Math.round(Number(row.amount) * 100))}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={row.status} />
                  {row.status !== "invalid" && (
                    <>
                      <BankRowButton rowId={row.id} status="approved" label="Approve" />
                      <BankRowButton rowId={row.id} status="discarded" label="Discard" />
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3 border-t border-[#f0fdf4] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[#4b8068]">
              {approvedCount} approved bank rows ready to commit.
            </p>
            <form action={commitApprovedBankRows} data-testid="bank-import-commit-form">
              <button
                type="submit"
                data-testid="bank-import-commit-approved-button"
                className="inline-flex h-10 items-center rounded-lg bg-[#15803d] px-4 text-sm font-semibold text-white transition hover:bg-[#14532d]"
              >
                Commit approved bank rows
              </button>
            </form>
          </div>
        </>
      )}
    </section>
  );
}

function BankRowButton({
  rowId,
  status,
  label,
}: {
  rowId: string;
  status: "approved" | "discarded";
  label: string;
}) {
  return (
    <form action={setBankStatementRowStatus} data-testid={`bank-import-row-form-${rowId}`}>
      <input type="hidden" name="rowId" value={rowId} />
      <input type="hidden" name="status" value={status} />
      <button
        type="submit"
        data-testid={`bank-import-row-${status}-button-${rowId}`}
        className="inline-flex h-9 items-center rounded-lg border border-[#bbf7d0] bg-white px-3 text-xs font-semibold text-[#14532d] transition hover:bg-[#f0fdf4]"
      >
        {label}
      </button>
    </form>
  );
}

const fileInputCls =
  "min-h-14 w-full cursor-pointer rounded-xl border-2 border-dashed border-[#86efac] bg-[#f7fef9] px-3 py-3 text-sm font-medium text-[#14532d] file:mr-4 file:cursor-pointer file:rounded-lg file:border-0 file:bg-[#15803d] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:bg-[#f0fdf4]";

function CategorySelect({
  categories,
  defaultValue,
  testId,
}: {
  categories: CategoryOption[];
  defaultValue?: string;
  testId: string;
}) {
  const income = categories.filter((category) => category.record_type === "income");
  const expenses = categories.filter((category) => category.record_type === "expense");
  const selectedValue = defaultValue ?? income[0]?.id ?? categories[0]?.id ?? "";

  return (
    <select
      name="categoryId"
      data-testid={testId}
      className="mt-1 h-11 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d]"
      defaultValue={selectedValue}
      required
    >
      <optgroup label="Income">
        {income.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="Expenses">
        {expenses.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

function ReviewButton({
  recordId,
  status,
  label,
}: {
  recordId: string;
  status: "approved" | "excluded";
  label: string;
}) {
  return (
    <form action={setManualRecordStatus} data-testid={`record-review-${status}-form-${recordId}`}>
      <input type="hidden" name="recordId" value={recordId} />
      <input type="hidden" name="status" value={status} />
      <button
        type="submit"
        data-testid={`record-review-${status}-button-${recordId}`}
        className="inline-flex h-10 items-center rounded-lg border border-[#bbf7d0] bg-white px-4 text-sm font-semibold text-[#14532d] transition hover:bg-[#f0fdf4]"
      >
        {label}
      </button>
    </form>
  );
}

function StatusBadge({
  status,
}: {
  status:
    | ManualRecordRow["status"]
    | CsvImportReviewRow["status"]
    | BankStatementReviewRow["status"];
}) {
  const label =
    status === "approved"
      ? "Approved"
      : status === "excluded"
        ? "Excluded"
        : status === "discarded"
          ? "Discarded"
          : status === "committed"
            ? "Committed"
            : status === "invalid"
              ? "Check row"
              : "Needs review";

  const className =
    status === "approved" || status === "committed"
      ? "bg-[#dcfce7] text-[#15803d]"
    : status === "excluded" || status === "discarded"
        ? "bg-[#fef3c7] text-[#92400e]"
        : status === "invalid"
          ? "bg-red-50 text-red-800"
          : "bg-[#e0f2fe] text-[#075985]";

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}

function getPageMessage(params: { [key: string]: string | string[] | undefined }) {
  const error = getSingleParam(params.error);
  if (error) {
    return { type: "error" as const, text: error };
  }

  if (params.created) {
    return { type: "success" as const, text: "Record saved for review." };
  }

  if (params.updated) {
    return { type: "success" as const, text: "Record updated." };
  }

  if (params.reviewed) {
    return { type: "success" as const, text: "Record review state updated." };
  }

  if (params.categorised) {
    return { type: "success" as const, text: "Category applied." };
  }

  const csvImported = getSingleParam(params.csvImported);
  if (csvImported) {
    return {
      type: "success" as const,
      text: `${csvImported} CSV rows added for review.`,
    };
  }

  if (params.csvReviewed) {
    return { type: "success" as const, text: "CSV row review state updated." };
  }

  const csvCommitted = getSingleParam(params.csvCommitted);
  if (csvCommitted) {
    return {
      type: "success" as const,
      text: `${csvCommitted} CSV rows committed to approved records.`,
    };
  }

  const bankImported = getSingleParam(params.bankImported);
  if (bankImported) {
    return {
      type: "success" as const,
      text: `${bankImported} bank statement rows added for review after redaction.`,
    };
  }

  if (params.bankReviewed) {
    return { type: "success" as const, text: "Bank statement row review state updated." };
  }

  const bankCommitted = getSingleParam(params.bankCommitted);
  if (bankCommitted) {
    return {
      type: "success" as const,
      text: `${bankCommitted} bank statement rows committed to approved records.`,
    };
  }

  return null;
}

function getSelectedTaxYearStart(
  params: { [key: string]: string | string[] | undefined },
  fallback: number
) {
  const requested = Number(getSingleParam(params.taxYearStart));

  if (Number.isInteger(requested) && requested >= 2020 && requested <= 2100) {
    return requested;
  }

  return fallback;
}

function getRecordsTab(params: { [key: string]: string | string[] | undefined }) {
  const requested = getSingleParam(params.tab) ?? "";
  return ["records", "csv", "bank", "exports"].includes(requested)
    ? requested
    : "records";
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

function getSingleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatRecordDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatExportDate(value: string | null | undefined) {
  if (!value) {
    return "No exports yet";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
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

function QuarterAmount({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-[#4b8068]">{label}</p>
      <p
        className={`mt-1 text-sm ${
          strong ? "font-semibold text-[#14532d]" : "font-medium text-[#166534]"
        }`}
      >
        {formatPounds(value)}
      </p>
    </div>
  );
}

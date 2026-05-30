import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  buildQuarterSummaries,
  getCurrentTaxYearStart,
  getTaxYearLabel,
  moneyToPence,
} from "@/lib/records/tax-periods";
import { formatPounds } from "@/lib/invoices/money";
import LogoutButton from "@/app/dashboard/LogoutButton";
import RecordsReviewAgent from "./RecordsReviewAgent";

export const metadata = {
  title: "Records Review — VibeCount",
  description: "AI-assisted read-only review of your records and invoices.",
};

type ApprovedRecord = {
  record_type: "income" | "expense";
  record_date: string;
  description: string;
  amount: string | number;
  status: string;
  record_categories: { name: string } | null;
};


type InvoiceRow = {
  number: string;
  amount: string | number;
  due_date: string | null;
  delivery_status: string;
  clients: { name: string } | { name: string }[] | null;
};

export default async function ReviewPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const taxYearStart = getCurrentTaxYearStart();
  const taxYearLabel = getTaxYearLabel(taxYearStart);

  const [
    { data: approvedRecords },
    { count: reviewCount },
    { data: quarterRows },
    { data: sentInvoices },
  ] = await Promise.all([
    supabase
      .from("financial_records")
      .select("record_type, record_date, description, amount, status, record_categories(name)")
      .eq("user_id", user.id)
      .eq("status", "approved")
      .eq("tax_year_start", taxYearStart)
      .order("record_date", { ascending: false })
      .limit(20),
    supabase
      .from("financial_records")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "review"),
    supabase
      .from("financial_record_quarter_summaries")
      .select("tax_quarter, income_total, expense_total, net_total, income_count, expense_count")
      .eq("user_id", user.id)
      .eq("tax_year_start", taxYearStart),
    supabase
      .from("invoices")
      .select("number, amount, due_date, delivery_status, clients(name)")
      .eq("user_id", user.id)
      .eq("status", "finalised")
      .eq("delivery_status", "sent")
      .is("paid_at", null)
      .order("due_date", { ascending: true })
      .limit(10),
  ]);

  const quarters = buildQuarterSummaries(
    taxYearStart,
    (quarterRows ?? []) as Parameters<typeof buildQuarterSummaries>[1]
  );

  const records = (approvedRecords ?? []) as unknown as ApprovedRecord[];
  const invoices = (sentInvoices ?? []) as unknown as InvoiceRow[];

  const approvedCount = records.length;
  const reviewStateCount = reviewCount ?? 0;

  function invoiceClient(clients: InvoiceRow["clients"]) {
    return Array.isArray(clients) ? clients[0]?.name ?? "Client" : clients?.name ?? "Client";
  }

  const summary = {
    currentTaxYear: taxYearLabel,
    approvedCount,
    reviewCount: reviewStateCount,
    quarters: quarters.map((q) => ({
      label: `${q.label} (${q.period})`,
      incomeTotal: q.incomePence,
      expenseTotal: q.expensePence,
      netProfit: q.netPence,
      recordCount: q.incomeCount + q.expenseCount,
    })),
    recentRecords: records.map((r) => ({
      record_type: r.record_type,
      record_date: r.record_date,
      description: r.description,
      amount: moneyToPence(r.amount),
      category: r.record_categories?.name ?? null,
      status: r.status,
    })),
    overdueInvoices: invoices.map((inv) => ({
      number: inv.number,
      amount: moneyToPence(inv.amount),
      due_date: inv.due_date,
      delivery_status: inv.delivery_status,
      client: invoiceClient(inv.clients),
    })),
  };

  return (
    <main className="min-h-screen bg-[#f0fdf4]">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#15803d] bg-[#15803d] px-6 py-4 sm:px-8">
        <div className="flex items-center gap-6">
          <span className="text-lg font-semibold text-white">VibeCount</span>
          <nav className="hidden items-center gap-1 sm:flex">
            <Link href="/dashboard" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Invoices</Link>
            <Link href="/dashboard/records" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Records</Link>
            <Link href="/dashboard/quotes" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Quotes</Link>
            <Link href="/dashboard/invoices/repeating" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Repeating</Link>
            <Link href="/dashboard/tax-prep" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Tax prep</Link>
            <Link href="/dashboard/review" className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium text-white">Review</Link>
            <Link href="/dashboard/glossary" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Explain Simply</Link>
            <Link href="/dashboard/settings" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Settings</Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <LogoutButton />
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-[#14532d]">Records review</h1>
          <p className="mt-1 text-sm text-[#166534]">
            Tax year {taxYearLabel} · {approvedCount} approved records · {reviewStateCount} awaiting review
          </p>
        </div>

        {reviewStateCount > 0 && (
          <div className="mb-6 flex items-start gap-4 rounded-xl border border-[#fef08a] bg-[#fefce8] p-5">
            <div>
              <p className="text-sm font-medium text-[#713f12]">
                {reviewStateCount} record{reviewStateCount === 1 ? "" : "s"} awaiting your review
              </p>
              <p className="mt-0.5 text-xs text-[#854d0e]">
                Approve or exclude them in Records before running the AI review.
              </p>
              <Link href="/dashboard/records" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#713f12] underline underline-offset-2">
                Go to Records
              </Link>
            </div>
          </div>
        )}

        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          {quarters.filter((q) => q.incomeCount + q.expenseCount > 0).map((q) => (
            <div key={q.taxQuarter} className="rounded-xl border border-[#bbf7d0] bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#166534]">{q.label}</p>
              <p className="mt-1 text-xs text-[#4b8068]">{q.period}</p>
              <p className="mt-2 text-base font-semibold text-[#14532d]">{formatPounds(q.netPence)}</p>
              <p className="text-xs text-[#4b8068]">net profit</p>
              <div className="mt-2 flex gap-3 text-xs text-[#4b8068]">
                <span>In: {formatPounds(q.incomePence)}</span>
                <span>Out: {formatPounds(q.expensePence)}</span>
              </div>
            </div>
          ))}
          {quarters.every((q) => q.incomeCount + q.expenseCount === 0) && (
            <div className="col-span-3 rounded-xl border border-dashed border-[#bbf7d0] bg-white p-6 text-center">
              <p className="text-sm text-[#4b8068]">No approved records for {taxYearLabel} yet.</p>
              <Link href="/dashboard/records" className="mt-1 text-xs font-semibold text-[#15803d] underline">Add records</Link>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[#bbf7d0] bg-white p-5">
          <RecordsReviewAgent summary={summary} />
        </div>

        <p className="mt-6 text-center text-xs text-[#86a88e]">
          The AI review reads your approved records only. It never writes to your database or triggers any external actions. Treat findings as suggestions — verify before acting.
        </p>
      </div>
    </main>
  );
}

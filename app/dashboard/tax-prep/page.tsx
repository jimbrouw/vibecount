import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardShell from "../DashboardShell";
import { ukTaxYearStart, formatTaxYear } from "@/lib/tax/quarters";
import { estimateIncomeTax } from "@/lib/tax/estimate";
import { getMtdThresholdLabel } from "@/lib/records/mtd-thresholds";
import { formatPounds } from "@/lib/invoices/money";

export const metadata = {
  title: "Tax Prep — VibeCount",
  description: "Prepare for your accountant and Self Assessment with a plain-English summary of your records.",
};

export default async function TaxPrepPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const now = new Date();
  const yearStart = ukTaxYearStart(now);
  const taxYear = formatTaxYear(yearStart);

  // Load records
  const { data: records } = await supabase
    .from("financial_records")
    .select("record_type, amount_pence, category, tax_quarter")
    .eq("user_id", user.id)
    .eq("tax_year_start", yearStart);

  // Load finalised invoices
  const taxYearStartDate = new Date(Date.UTC(yearStart, 3, 6));
  const taxYearEndDate   = new Date(Date.UTC(yearStart + 1, 3, 5));
  const { data: invoices } = await supabase
    .from("invoices")
    .select("amount")
    .eq("user_id", user.id)
    .eq("status", "finalised")
    .gte("invoice_date", taxYearStartDate.toISOString().slice(0, 10))
    .lte("invoice_date", taxYearEndDate.toISOString().slice(0, 10));

  const rows = records ?? [];
  const invRows = invoices ?? [];

  const record_income_pence = rows.filter((r) => r.record_type === "income").reduce((s, r) => s + r.amount_pence, 0);
  const invoice_income_pence = invRows.reduce((s, i) => s + Math.round(Number(i.amount) * 100), 0);
  const total_income_pence = record_income_pence + invoice_income_pence;
  const total_expenses_pence = rows.filter((r) => r.record_type === "expense").reduce((s, r) => s + r.amount_pence, 0);
  const net_profit_pence = total_income_pence - total_expenses_pence;
  const estimate = estimateIncomeTax(net_profit_pence);
  const mtdLabel = getMtdThresholdLabel(now);

  const expenseByCategory: Record<string, number> = {};
  for (const r of rows.filter((r) => r.record_type === "expense")) {
    expenseByCategory[r.category] = (expenseByCategory[r.category] ?? 0) + r.amount_pence;
  }

  return (
    <DashboardShell active="tax-prep" userEmail={user.email ?? ""}>
      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
        <div className="mb-6">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e8f0eb] px-3 py-1 text-xs font-semibold uppercase tracking-widest text-[#2d6a4a]">
            Prepare for your accountant
          </span>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-[#1a3a2a]">
            Tax Prep — {taxYear}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#4a6a5a]">
            A review pack based on your VibeCount records. This is not a tax return and not a submission to HMRC.
            Take this to your accountant — they will calculate the final figures.
          </p>
        </div>

        {/* P&L summary */}
        <div className="mb-6 rounded-xl border border-[#d5d0c8] bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#4a6a5a]">Profit and loss summary</p>
          <p className="mt-1 text-xs text-[#4a6a5a]">SA103S Box 9 / SA103F Box 15 — Turnover</p>
          <div className="mt-4 space-y-2">
            <Row label="Invoice income" value={formatPounds(invoice_income_pence)} />
            <Row label="Other income records" value={formatPounds(record_income_pence)} />
            <Row label="Total income" value={formatPounds(total_income_pence)} bold />
            <div className="my-2 border-t border-[#f0ece4]" />
            <Row label="Total expenses" value={formatPounds(total_expenses_pence)} />
            <div className="my-2 border-t border-[#f0ece4]" />
            <Row label="Net profit" value={formatPounds(net_profit_pence)} bold />
          </div>
          <p className="mt-3 text-xs leading-5 text-[#4a6a5a]">
            Verify with your accountant. Check for cash payments, marketplace income, or unpaid invoices not yet in VibeCount.
          </p>
        </div>

        {/* Expense categories */}
        {Object.keys(expenseByCategory).length > 0 && (
          <div className="mb-6 rounded-xl border border-[#d5d0c8] bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#4a6a5a]">Expenses by category</p>
            <p className="mt-1 text-xs text-[#4a6a5a]">SA103S Box 20 / SA103F various allowable expense boxes</p>
            <ul className="mt-4 space-y-2">
              {Object.entries(expenseByCategory).map(([cat, pence]) => (
                <li key={cat} className="flex items-center justify-between text-sm">
                  <span className="text-[#4a6a5a]">{cat}</span>
                  <span className="font-medium text-[#1a3a2a]">{formatPounds(pence)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Tax estimate */}
        <div className="mb-6 rounded-xl border border-[#d5d0c8] bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#4a6a5a]">Tax estimate ({taxYear} rates)</p>
          <div className="mt-4 space-y-2">
            <Row label="Estimated income tax" value={formatPounds(estimate.income_tax_pence)} />
            <Row label="Estimated Class 4 NI" value={formatPounds(estimate.ni_class4_pence)} />
            <div className="my-2 border-t border-[#f0ece4]" />
            <Row label="Total estimated tax" value={formatPounds(estimate.total_estimated_tax_pence)} bold />
          </div>
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            {estimate.disclaimer}
          </p>
        </div>

        {/* MTD */}
        <div className="mb-6 rounded-xl border border-[#d5d0c8] bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#4a6a5a]">Making Tax Digital</p>
          <p className="mt-3 text-xs leading-5 text-[#4a6a5a]">{mtdLabel}</p>
        </div>

        {/* SA checklist */}
        <div className="mb-6 rounded-xl border border-[#d5d0c8] bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#4a6a5a]">What your accountant will still need</p>
          <p className="mt-1 text-xs text-[#4a6a5a]">These cannot be pre-filled from VibeCount — bring them to your accountant.</p>
          <ul className="mt-4 space-y-2 text-sm text-[#1a3a2a]">
            {[
              "Personal income outside your business (employment, dividends, savings interest)",
              "Pension contributions",
              "Capital allowances and machinery write-downs",
              "Losses carried forward from prior years",
              "Student loan repayments",
              "Capital gains",
              "Property income",
              "Any cash income not recorded in VibeCount",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-0.5 inline-block h-4 w-4 flex-shrink-0 rounded border border-[#d5d0c8]" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Export */}
        <div className="rounded-xl border border-[#d5d0c8] bg-white p-5">
          <p className="text-sm font-semibold text-[#1a3a2a]">Export for your accountant</p>
          <p className="mt-1 text-xs text-[#4a6a5a]">
            Download a plain-text review pack with your P&amp;L, quarterly breakdown, and SA103S/F checklist.
            Not a tax return — a document to review together.
          </p>
          <a
            href="/api/tax-prep/export"
            className="mt-4 inline-flex h-10 items-center rounded-xl bg-[#1a3a2a] px-5 text-sm font-semibold text-white transition hover:bg-[#2d6a4a]"
          >
            Download review pack
          </a>
        </div>
      </div>
    </DashboardShell>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={bold ? "font-semibold text-[#1a3a2a]" : "text-[#4a6a5a]"}>{label}</span>
      <span className={bold ? "font-semibold text-[#1a3a2a]" : "font-medium text-[#1a3a2a]"}>{value}</span>
    </div>
  );
}

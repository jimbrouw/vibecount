import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ukTaxYearStart, formatTaxYear, quarterBoundaries } from "@/lib/tax/quarters";
import { estimateIncomeTax, TAX_ESTIMATE_DISCLAIMER } from "@/lib/tax/estimate";

export const runtime = "nodejs";

const EXPORT_DISCLAIMER =
  "This is a review document prepared by VibeCount to help you prepare for your accountant. " +
  "It is NOT a filed tax return and NOT a submission to HMRC. " +
  TAX_ESTIMATE_DISCLAIMER;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to export tax prep." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const now = new Date();
  const yearStart = searchParams.get("tax_year")
    ? Number(searchParams.get("tax_year"))
    : ukTaxYearStart(now);
  const taxYear = formatTaxYear(yearStart);

  // Load approved records
  const { data: records, error: recError } = await supabase
    .from("financial_records")
    .select("record_type, record_date, amount_pence, description, category, source, tax_quarter")
    .eq("user_id", user.id)
    .eq("tax_year_start", yearStart)
    .order("record_date", { ascending: true });

  if (recError) {
    return NextResponse.json({ error: "Could not load records." }, { status: 500 });
  }

  // Load finalised invoices for the same tax year
  const taxYearStartDate = new Date(Date.UTC(yearStart, 3, 6));
  const taxYearEndDate   = new Date(Date.UTC(yearStart + 1, 3, 5));
  const { data: invoices, error: invError } = await supabase
    .from("invoices")
    .select("number, invoice_date, amount, description")
    .eq("user_id", user.id)
    .eq("status", "finalised")
    .gte("invoice_date", taxYearStartDate.toISOString().slice(0, 10))
    .lte("invoice_date", taxYearEndDate.toISOString().slice(0, 10))
    .order("invoice_date", { ascending: true });

  if (invError) {
    return NextResponse.json({ error: "Could not load invoices." }, { status: 500 });
  }

  const rows = records ?? [];
  const invRows = invoices ?? [];

  // Category totals for expenses
  const expenseByCategory: Record<string, number> = {};
  for (const r of rows.filter((r) => r.record_type === "expense")) {
    expenseByCategory[r.category] = (expenseByCategory[r.category] ?? 0) + r.amount_pence;
  }

  const record_income_pence = rows.filter((r) => r.record_type === "income").reduce((s, r) => s + r.amount_pence, 0);
  const invoice_income_pence = invRows.reduce((s, i) => s + Math.round(Number(i.amount) * 100), 0);
  const total_income_pence = record_income_pence + invoice_income_pence;
  const total_expenses_pence = rows.filter((r) => r.record_type === "expense").reduce((s, r) => s + r.amount_pence, 0);
  const net_profit_pence = total_income_pence - total_expenses_pence;
  const estimate = estimateIncomeTax(net_profit_pence);

  const fmt = (p: number) => `£${(p / 100).toFixed(2)}`;

  // Build plain-text export
  const sections = [
    `VibeCount — Tax Preparation Review Pack`,
    `Tax Year: ${taxYear}`,
    `Prepared: ${now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
    ``,
    `IMPORTANT: ${EXPORT_DISCLAIMER}`,
    ``,
    `=== PROFIT AND LOSS SUMMARY ===`,
    ``,
    `Business turnover (SA103S Box 9 / SA103F Box 15)`,
    `  Invoiced income:     ${fmt(invoice_income_pence)}`,
    `  Other income records: ${fmt(record_income_pence)}`,
    `  Total income:        ${fmt(total_income_pence)}`,
    ``,
    `  Note: Turnover figure — verify with your accountant. Check for cash payments,`,
    `  marketplace income, or unpaid invoices depending on your accounting method.`,
    ``,
    `Allowable expenses (SA103S Box 20 / SA103F various)`,
    ...Object.entries(expenseByCategory).map(([cat, p]) => `  ${cat.padEnd(30)} ${fmt(p)}`),
    `  ${"Total expenses:".padEnd(30)} ${fmt(total_expenses_pence)}`,
    ``,
    `Net profit (income − expenses): ${fmt(net_profit_pence)}`,
    ``,
    `=== TAX ESTIMATE (${taxYear} RATES) ===`,
    ``,
    `  Estimated income tax:       ${fmt(estimate.income_tax_pence)}`,
    `  Estimated Class 4 NI:       ${fmt(estimate.ni_class4_pence)}`,
    `  Total estimated tax:        ${fmt(estimate.total_estimated_tax_pence)}`,
    ``,
    `  ${estimate.disclaimer}`,
    ``,
    `=== QUARTERLY BREAKDOWN ===`,
    ``,
  ];

  const quarters = quarterBoundaries(yearStart);
  for (const q of quarters) {
    const qRows = rows.filter((r) => r.tax_quarter === q.quarter);
    const qIncome = qRows.filter((r) => r.record_type === "income").reduce((s, r) => s + r.amount_pence, 0);
    const qExpenses = qRows.filter((r) => r.record_type === "expense").reduce((s, r) => s + r.amount_pence, 0);
    sections.push(
      `${q.label}`,
      `  Income:   ${fmt(qIncome)}   Expenses: ${fmt(qExpenses)}   Net: ${fmt(qIncome - qExpenses)}`,
      ``
    );
  }

  sections.push(
    `=== INVOICES (${invRows.length}) ===`,
    ``
  );
  for (const inv of invRows) {
    sections.push(`  ${inv.number}  ${inv.invoice_date}  ${fmt(Math.round(Number(inv.amount) * 100))}  ${inv.description}`);
  }

  sections.push(
    ``,
    `=== SA103S/SA103F CHECKLIST ===`,
    ``,
    `The following items cannot be pre-filled by VibeCount. Review with your accountant:`,
    `  [ ] Personal income outside your business (employment, dividends, savings interest)`,
    `  [ ] Pension contributions`,
    `  [ ] Capital allowances and machinery write-downs`,
    `  [ ] Losses carried forward from prior years`,
    `  [ ] Student loan repayments`,
    `  [ ] Capital gains`,
    `  [ ] Property income`,
    `  [ ] Any cash income not in VibeCount`,
    ``,
    `=== END OF REVIEW PACK ===`,
    ``,
    `Prepare for your accountant — not a filing document.`,
  );

  const content = sections.join("\n");
  const filename = `vibecount-tax-prep-${taxYear.replace("/", "-")}.txt`;

  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

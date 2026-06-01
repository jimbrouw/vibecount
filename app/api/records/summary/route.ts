import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ukTaxYearStart, formatTaxYear, quarterBoundaries } from "@/lib/tax/quarters";
import { estimateIncomeTax } from "@/lib/tax/estimate";
import { getMtdThreshold, getMtdThresholdLabel } from "@/lib/records/mtd-thresholds";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to view your summary." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const now = new Date();
  const yearStart = searchParams.get("tax_year")
    ? Number(searchParams.get("tax_year"))
    : ukTaxYearStart(now);

  // Records from financial_records for the requested tax year
  const { data: records, error: recError } = await supabase
    .from("financial_records")
    .select("record_type, amount_pence, tax_quarter")
    .eq("user_id", user.id)
    .eq("tax_year_start", yearStart);

  if (recError) {
    return NextResponse.json({ error: "Could not load records." }, { status: 500 });
  }

  // Finalised invoices for the same tax year
  // invoices.amount is numeric(12,2) — convert to pence via ROUND(amount * 100)::bigint
  const taxYearStartDate = new Date(Date.UTC(yearStart, 3, 6));   // 6 Apr
  const taxYearEndDate   = new Date(Date.UTC(yearStart + 1, 3, 5)); // 5 Apr next year
  const { data: invoices, error: invError } = await supabase
    .from("invoices")
    .select("amount, invoice_date")
    .eq("user_id", user.id)
    .eq("status", "finalised")
    .gte("invoice_date", taxYearStartDate.toISOString().slice(0, 10))
    .lte("invoice_date", taxYearEndDate.toISOString().slice(0, 10));

  if (invError) {
    return NextResponse.json({ error: "Could not load invoices." }, { status: 500 });
  }

  // Build per-quarter sums
  const quarters = quarterBoundaries(yearStart).map((b) => ({
    quarter: b.quarter,
    label: b.label,
    income_pence: 0,
    expenses_pence: 0,
    net_profit_pence: 0,
  }));

  for (const r of records ?? []) {
    const q = quarters.find((qr) => qr.quarter === r.tax_quarter);
    if (!q) continue;
    if (r.record_type === "income") q.income_pence += r.amount_pence;
    else q.expenses_pence += r.amount_pence;
  }

  // Add invoice income to quarters — classify by invoice_date
  for (const inv of invoices ?? []) {
    const invDate = new Date(`${inv.invoice_date}T00:00:00Z`);
    // Find which quarter this date falls in
    const boundaries = quarterBoundaries(yearStart);
    const b = boundaries.find(
      (bnd) => invDate >= bnd.start && invDate <= bnd.end
    );
    if (!b) continue;
    const q = quarters.find((qr) => qr.quarter === b.quarter);
    if (!q) continue;
    // Convert invoices.amount (numeric) to pence
    q.income_pence += Math.round(Number(inv.amount) * 100);
  }

  for (const q of quarters) {
    q.net_profit_pence = q.income_pence - q.expenses_pence;
  }

  const total_income_pence   = quarters.reduce((s, q) => s + q.income_pence, 0);
  const total_expenses_pence = quarters.reduce((s, q) => s + q.expenses_pence, 0);
  const net_profit_pence     = total_income_pence - total_expenses_pence;

  const tax_estimate = estimateIncomeTax(net_profit_pence);
  const mtd_threshold = getMtdThreshold(now);
  const mtd_threshold_label = getMtdThresholdLabel(now);

  return NextResponse.json({
    tax_year: formatTaxYear(yearStart),
    tax_year_start: yearStart,
    income_pence: total_income_pence,
    expenses_pence: total_expenses_pence,
    net_profit_pence,
    tax_estimate,
    mtd_threshold_pence: mtd_threshold,
    mtd_threshold_label,
    quarters,
  });
}

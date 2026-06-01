import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateAgentToken, logAgentAction } from "@/lib/mcp/auth";
import { getCurrentTaxYearStart, getTaxYearLabel } from "@/lib/records/tax-periods";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await validateAgentToken(request.headers.get("authorization"), "read:pl_summary");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { session } = auth;
  const supabase = createAdminClient();
  if (!supabase) return NextResponse.json({ error: "Database not configured." }, { status: 503 });

  const taxYearStart = getCurrentTaxYearStart();

  const { data: rows } = await supabase
    .from("financial_record_quarter_summaries")
    .select("tax_quarter, income_total, expense_total, net_total, income_count, expense_count")
    .eq("user_id", session.user_id)
    .eq("tax_year_start", taxYearStart);

  const quarters = (rows ?? []).map((r: {
    tax_quarter: number;
    income_total: number | string | null;
    expense_total: number | string | null;
    net_total: number | string | null;
    income_count: number | null;
    expense_count: number | null;
  }) => ({
    quarter: r.tax_quarter,
    income_pence: Math.round(Number(r.income_total ?? 0) * 100),
    expense_pence: Math.round(Number(r.expense_total ?? 0) * 100),
    net_profit_pence: Math.round(Number(r.net_total ?? 0) * 100),
    record_count: (r.income_count ?? 0) + (r.expense_count ?? 0),
  }));

  await logAgentAction({
    userId: session.user_id,
    sessionId: session.id,
    tool: "get_pl_summary",
    scopeUsed: "read:pl_summary",
    paramsSummary: `tax_year=${taxYearStart}`,
    resultStatus: "ok",
  });

  return NextResponse.json({
    tax_year: getTaxYearLabel(taxYearStart),
    tax_year_start: taxYearStart,
    quarters,
    caveat: "These are estimates based on approved records only. Verify with your accountant.",
  });
}

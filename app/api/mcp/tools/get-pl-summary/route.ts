import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateAgentToken, logAgentAction } from "@/lib/mcp/auth";
import { getCurrentTaxYearStart, getTaxYearLabel } from "@/lib/records/tax-periods";
import { quarterReads } from "@/lib/mcp/read-boundary";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const auth = await validateAgentToken(request.headers.get("authorization"), "read:pl_summary");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { session } = auth, db = createAdminClient();
  if (!db) return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  const taxYearStart = getCurrentTaxYearStart();
  try {
    const { data, error, count } = await db.from("financial_record_quarter_summaries")
      .select("user_id,tax_year_start,tax_quarter,income_total,expense_total,net_total,income_count,expense_count", { count: "exact" })
      .eq("user_id", session.user_id).eq("tax_year_start", taxYearStart).limit(5);
    if (error || !data || count !== data.length || data.length > 4) throw new Error("Incomplete quarter read.");
    const quarters = quarterReads(data, session.user_id, taxYearStart);
    const logged = await logAgentAction({ userId: session.user_id, sessionId: session.id, tool: "get_pl_summary", scopeUsed: "read:pl_summary", paramsSummary: `tax_year=${taxYearStart}`, resultStatus: "ok" });
    if (!logged) throw new Error("Read audit unavailable.");
    return NextResponse.json({ tax_year: getTaxYearLabel(taxYearStart), tax_year_start: taxYearStart, quarters,
      caveat: "These are estimates based on approved records only. Verify with your accountant." }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Profit summary unavailable. Review the source records in VibeCount." }, { status: 503 }); }
}

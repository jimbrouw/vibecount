import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentTaxYearStart, getQuarterDates, type TaxQuarter } from "@/lib/records/tax-periods";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return POST(request);
}

function getCurrentQuarter(today = new Date()): TaxQuarter {
  const taxYearStart = getCurrentTaxYearStart(today);
  const quarters: TaxQuarter[] = [1, 2, 3, 4];
  for (const q of quarters.slice().reverse()) {
    const { start } = getQuarterDates(taxYearStart, q);
    if (today >= start) return q;
  }
  return 1;
}

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Database not configured." }, { status: 500 });
  }

  const now = new Date();
  const taxYearStart = getCurrentTaxYearStart(now);
  const taxQuarter = getCurrentQuarter(now);

  const { data: users, error: usersError } = await supabase
    .from("financial_records")
    .select("user_id")
    .eq("tax_year_start", taxYearStart)
    .eq("tax_quarter", taxQuarter);

  if (usersError) {
    return NextResponse.json({ error: "Could not list users." }, { status: 500 });
  }

  const uniqueUserIds = [...new Set((users ?? []).map((r: { user_id: string }) => r.user_id))];

  const results = { checked: uniqueUserIds.length, saved: 0, failed: 0 };

  for (const userId of uniqueUserIds) {
    try {
      const [
        { count: uncategorised },
        { count: inReview },
        { data: quarterSummary },
        { count: overdueInvoices },
      ] = await Promise.all([
        supabase
          .from("financial_records")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("tax_year_start", taxYearStart)
          .eq("tax_quarter", taxQuarter)
          .eq("status", "approved")
          .is("category_id", null),
        supabase
          .from("financial_records")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("tax_year_start", taxYearStart)
          .eq("tax_quarter", taxQuarter)
          .eq("status", "review"),
        supabase
          .from("financial_record_quarter_summaries")
          .select("net_total")
          .eq("user_id", userId)
          .eq("tax_year_start", taxYearStart)
          .eq("tax_quarter", taxQuarter)
          .maybeSingle(),
        supabase
          .from("invoices")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("status", "finalised")
          .eq("delivery_status", "sent")
          .is("paid_at", null)
          .lt("due_date", now.toISOString().slice(0, 10)),
      ]);

      const uncategorisedCount = uncategorised ?? 0;
      const reviewCount = inReview ?? 0;
      const overdueCount = overdueInvoices ?? 0;
      const netProfitPence = Math.round(Number(quarterSummary?.net_total ?? 0) * 100);
      const needsAttention = uncategorisedCount > 0 || reviewCount > 0 || overdueCount > 0;

      const notesParts: string[] = [];
      if (uncategorisedCount > 0) notesParts.push(`${uncategorisedCount} approved record(s) without a category`);
      if (reviewCount > 0) notesParts.push(`${reviewCount} record(s) awaiting review`);
      if (overdueCount > 0) notesParts.push(`${overdueCount} overdue invoice(s) not marked paid`);

      const { error: upsertError } = await supabase
        .from("quarterly_readiness_checks")
        .upsert({
          user_id: userId,
          tax_year_start: taxYearStart,
          tax_quarter: taxQuarter,
          checked_at: now.toISOString(),
          uncategorised_count: uncategorisedCount,
          review_count: reviewCount,
          overdue_invoice_count: overdueCount,
          net_profit_pence: netProfitPence,
          status: needsAttention ? "needs_attention" : "ok",
          notes: notesParts.join("; ") || "All clear.",
        }, { onConflict: "user_id,tax_year_start,tax_quarter" });

      if (upsertError) {
        results.failed++;
      } else {
        results.saved++;
      }
    } catch {
      results.failed++;
    }
  }

  return NextResponse.json({ ok: true, ...results });
}

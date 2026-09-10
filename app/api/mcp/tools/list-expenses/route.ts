import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateAgentToken, logAgentAction } from "@/lib/mcp/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await validateAgentToken(request.headers.get("authorization"), "read:records");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { session } = auth;
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 100);

  const supabase = createAdminClient();
  if (!supabase) return NextResponse.json({ error: "Database not configured." }, { status: 503 });

  const { data } = await supabase
    .from("financial_records")
    .select("id, record_date, description, amount, record_categories(name)")
    .eq("user_id", session.user_id)
    .eq("record_type", "expense")
    .eq("status", "approved")
    .order("record_date", { ascending: false })
    .limit(limit);

  const expenses = (data ?? []).map((r: {
    id: string;
    record_date: string;
    description: string;
    amount: number | string;
    record_categories: unknown;
  }) => ({
    id: r.id,
    date: r.record_date,
    description: r.description,
    amount_pence: Math.round(Number(r.amount) * 100),
    category: (r.record_categories as { name?: string } | { name?: string }[] | null | undefined) instanceof Array
      ? ((r.record_categories as { name?: string }[])[0]?.name ?? null)
      : ((r.record_categories as { name?: string } | null)?.name ?? null),
  }));

  await logAgentAction({
    userId: session.user_id,
    sessionId: session.id,
    tool: "list_expenses",
    scopeUsed: "read:records",
    paramsSummary: `limit=${limit}`,
    resultStatus: "ok",
  });

  return NextResponse.json({ expenses, count: expenses.length });
}

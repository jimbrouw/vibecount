import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateAgentToken, logAgentAction } from "@/lib/mcp/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await validateAgentToken(request.headers.get("authorization"), "read:records");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { session } = auth;
  const supabase = createAdminClient();
  if (!supabase) return NextResponse.json({ error: "Database not configured." }, { status: 503 });

  const { data } = await supabase
    .from("financial_records")
    .select("id, record_type, record_date, description, amount, status")
    .eq("user_id", session.user_id)
    .is("category_id", null)
    .in("status", ["approved", "review"])
    .order("record_date", { ascending: false })
    .limit(50);

  const records = (data ?? []).map((r: {
    id: string;
    record_type: string;
    record_date: string;
    description: string;
    amount: number | string;
    status: string;
  }) => ({
    id: r.id,
    record_type: r.record_type,
    date: r.record_date,
    description: r.description,
    amount_pence: Math.round(Number(r.amount) * 100),
    status: r.status,
  }));

  await logAgentAction({
    userId: session.user_id,
    sessionId: session.id,
    tool: "list_uncategorised",
    scopeUsed: "read:records",
    paramsSummary: `count=${records.length}`,
    resultStatus: "ok",
  });

  return NextResponse.json({ records, count: records.length });
}

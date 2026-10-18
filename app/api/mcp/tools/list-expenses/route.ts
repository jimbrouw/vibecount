import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateAgentToken, logAgentAction } from "@/lib/mcp/auth";
import { signedRecordRead, readLimit } from "@/lib/mcp/read-boundary";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const auth = await validateAgentToken(request.headers.get("authorization"), "read:records");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { session } = auth;
  let limit: number;
  try { limit = readLimit(new URL(request.url).searchParams, 50, 100); }
  catch { return NextResponse.json({ error: "Choose a valid list limit." }, { status: 400 }); }
  const db = createAdminClient();
  if (!db) return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  try {
    const { data, error } = await db.from("financial_records").select("id,user_id,record_type,record_date,description,amount,effect_sign,status,record_categories(name,user_id,is_default)")
      .eq("user_id", session.user_id).eq("record_type", "expense").eq("status", "approved")
      .order("record_date", { ascending: false }).limit(limit);
    if (error || !data || data.length > limit) throw new Error("Record read unavailable.");
    const expenses = data.map(value => signedRecordRead(value, session.user_id, true));
    if (new Set(expenses.map(r => r.id)).size !== expenses.length) throw new Error("Duplicate record projection.");
    const logged = await logAgentAction({ userId: session.user_id, sessionId: session.id, tool: "list_expenses", scopeUsed: "read:records", paramsSummary: `limit=${limit}`, resultStatus: "ok" });
    if (!logged) throw new Error("Read audit unavailable.");
    return NextResponse.json({ expenses, count: expenses.length }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Record list unavailable. Review the source records in VibeCount." }, { status: 503 }); }
}

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateAgentToken, logAgentAction } from "@/lib/mcp/auth";
import { signedRecordRead } from "@/lib/mcp/read-boundary";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const auth = await validateAgentToken(request.headers.get("authorization"), "read:records");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { session } = auth;
  const limit = 50;
  const db = createAdminClient();
  if (!db) return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  try {
    const { data, error } = await db.from("financial_records").select("id,user_id,record_type,record_date,description,amount,effect_sign,status")
      .eq("user_id", session.user_id).is("category_id", null).in("status", ["approved", "review"])
      .order("record_date", { ascending: false }).limit(limit);
    if (error || !data || data.length > limit) throw new Error("Record read unavailable.");
    const records = data.map(value => signedRecordRead(value, session.user_id, false));
    if (new Set(records.map(r => r.id)).size !== records.length) throw new Error("Duplicate record projection.");
    const logged = await logAgentAction({ userId: session.user_id, sessionId: session.id, tool: "list_uncategorised", scopeUsed: "read:records", paramsSummary: `count=${records.length}`, resultStatus: "ok" });
    if (!logged) throw new Error("Read audit unavailable.");
    return NextResponse.json({ records, count: records.length }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Record list unavailable. Review the source records in VibeCount." }, { status: 503 }); }
}

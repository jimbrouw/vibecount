import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateAgentToken, logAgentAction } from "@/lib/mcp/auth";
import { nativeInvoiceRead, readLimit } from "@/lib/mcp/read-boundary";
import { INVOICE_REPORTING_COLUMNS } from "@/lib/invoices/reporting";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const auth = await validateAgentToken(request.headers.get("authorization"), "read:invoices");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { session } = auth, { searchParams } = new URL(request.url);
  let limit: number;
  const status = searchParams.get("status");
  try {
    limit = readLimit(searchParams, 20, 50);
    if (searchParams.getAll("status").length > 1 || (status !== null && !["draft", "finalised"].includes(status))) throw new Error("Choose a valid invoice status.");
  } catch { return NextResponse.json({ error: "Choose a valid invoice status and list limit." }, { status: 400 }); }
  const db = createAdminClient();
  if (!db) return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  try {
    let query = db.from("invoices").select(`${INVOICE_REPORTING_COLUMNS},user_id,number,invoice_date,due_date,delivery_status,paid_at,clients(name,user_id)`)
      .eq("user_id", session.user_id).order("invoice_date", { ascending: false }).limit(limit);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error || !data || data.length > limit) throw new Error("Invoice read unavailable.");
    const invoices = data.map(value => nativeInvoiceRead(value, session.user_id));
    if (new Set(invoices.map(r => r.id)).size !== invoices.length) throw new Error("Duplicate invoice projection.");
    const logged = await logAgentAction({ userId: session.user_id, sessionId: session.id, tool: "list_invoices", scopeUsed: "read:invoices", paramsSummary: `status=${status ?? "all"} limit=${limit}`, resultStatus: "ok" });
    if (!logged) throw new Error("Read audit unavailable.");
    return NextResponse.json({ invoices, count: invoices.length }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Invoice list unavailable. Unsupported invoice representations require human evidence review." }, { status: 503 }); }
}

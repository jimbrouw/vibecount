import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateAgentToken, logAgentAction } from "@/lib/mcp/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await validateAgentToken(request.headers.get("authorization"), "read:invoices");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { session } = auth;
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const limit = Math.min(Number(searchParams.get("limit") ?? 20), 50);

  const supabase = createAdminClient();
  if (!supabase) return NextResponse.json({ error: "Database not configured." }, { status: 503 });

  let query = supabase
    .from("invoices")
    .select("id, number, invoice_date, due_date, amount, status, delivery_status, paid_at, clients(name)")
    .eq("user_id", session.user_id)
    .order("invoice_date", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);

  const { data } = await query;

  const invoices = (data ?? []).map((inv: {
    id: string;
    number: string;
    invoice_date: string;
    due_date: string | null;
    amount: number | string;
    status: string;
    delivery_status: string;
    paid_at: string | null;
    clients: unknown;
  }) => ({
    id: inv.id,
    number: inv.number,
    invoice_date: inv.invoice_date,
    due_date: inv.due_date,
    amount_pence: Math.round(Number(inv.amount) * 100),
    status: inv.status,
    delivery_status: inv.delivery_status,
    paid: !!inv.paid_at,
    client: (inv.clients as { name?: string } | null)?.name ?? null,
  }));

  await logAgentAction({
    userId: session.user_id,
    sessionId: session.id,
    tool: "list_invoices",
    scopeUsed: "read:invoices",
    paramsSummary: `status=${status ?? "all"} limit=${limit}`,
    resultStatus: "ok",
  });

  return NextResponse.json({ invoices, count: invoices.length });
}

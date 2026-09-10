import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateAgentToken, logAgentAction } from "@/lib/mcp/auth";

export const runtime = "nodejs";

// AI drafts. Humans confirm. Creates invoice in 'draft' status — never 'finalised'.
export async function POST(request: Request) {
  const auth = await validateAgentToken(request.headers.get("authorization"), "draft:invoice");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { session } = auth;

  const body = await request.json() as {
    client_name?: string;
    description?: string;
    amount_pence?: number;
    invoice_date?: string;
    payment_terms?: string;
  };

  const { client_name, description, amount_pence, invoice_date, payment_terms } = body;

  if (!client_name?.trim()) return NextResponse.json({ error: "client_name is required." }, { status: 400 });
  if (!description?.trim()) return NextResponse.json({ error: "description is required." }, { status: 400 });
  if (!amount_pence || amount_pence <= 0 || !Number.isInteger(amount_pence)) {
    return NextResponse.json({ error: "amount_pence must be a positive integer (pence)." }, { status: 400 });
  }

  const supabase = createAdminClient();
  if (!supabase) return NextResponse.json({ error: "Database not configured." }, { status: 503 });

  // Find or create client
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name")
    .eq("user_id", session.user_id);

  const normalised = client_name.trim().toLowerCase();
  const existingClient = (clients ?? []).find((c: { name: string }) => c.name.toLowerCase().trim() === normalised);

  let clientId: string;
  if (existingClient) {
    clientId = existingClient.id;
  } else {
    const { data } = await supabase
      .from("clients")
      .insert({ user_id: session.user_id, name: client_name.trim() })
      .select("id")
      .single();
    if (!data?.id) return NextResponse.json({ error: "Could not find or create client." }, { status: 500 });
    clientId = data.id;
  }

  const year = new Date().getFullYear();
  const { count } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("user_id", session.user_id);

  const number = `INV-${year}-${String((count ?? 0) + 1).padStart(4, "0")}`;
  const date = invoice_date ?? new Date().toISOString().slice(0, 10);

  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      user_id: session.user_id,
      client_id: clientId,
      number,
      invoice_date: date,
      description: description.trim(),
      amount: amount_pence / 100,
      payment_terms: payment_terms ?? "Payment due within 30 days",
      status: "draft",
    })
    .select("id, number, status")
    .single();

  if (error || !invoice) {
    await logAgentAction({
      userId: session.user_id,
      sessionId: session.id,
      tool: "draft_invoice",
      scopeUsed: "draft:invoice",
      paramsSummary: `client=${client_name} amount=${amount_pence}p`,
      resultStatus: "error",
      error: error?.message,
    });
    return NextResponse.json({ error: "Could not create draft invoice." }, { status: 500 });
  }

  await logAgentAction({
    userId: session.user_id,
    sessionId: session.id,
    tool: "draft_invoice",
    scopeUsed: "draft:invoice",
    paramsSummary: `client=${client_name} amount=${amount_pence}p number=${invoice.number}`,
    resultStatus: "ok",
  });

  return NextResponse.json({
    id: invoice.id,
    number: invoice.number,
    status: "draft",
    message: "Draft invoice created. A human must review and finalise it in VibeCount before it can be sent.",
  });
}

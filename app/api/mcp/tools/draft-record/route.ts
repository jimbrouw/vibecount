import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateAgentToken, logAgentAction } from "@/lib/mcp/auth";
import { getCurrentTaxYearStart } from "@/lib/records/tax-periods";

export const runtime = "nodejs";

// AI drafts. Humans confirm. Creates record in 'review' status — never 'approved'.
export async function POST(request: Request) {
  const auth = await validateAgentToken(request.headers.get("authorization"), "draft:record");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { session } = auth;

  const body = await request.json() as {
    record_type?: string;
    record_date?: string;
    description?: string;
    amount_pence?: number;
    category_id?: string;
  };

  const { record_type, record_date, description, amount_pence, category_id } = body;

  if (!["income", "expense"].includes(record_type ?? "")) {
    return NextResponse.json({ error: "record_type must be income or expense." }, { status: 400 });
  }
  if (!record_date || !/^\d{4}-\d{2}-\d{2}$/.test(record_date)) {
    return NextResponse.json({ error: "record_date must be YYYY-MM-DD." }, { status: 400 });
  }
  if (!description?.trim()) {
    return NextResponse.json({ error: "description is required." }, { status: 400 });
  }
  if (!amount_pence || amount_pence <= 0 || !Number.isInteger(amount_pence)) {
    return NextResponse.json({ error: "amount_pence must be a positive integer (pence)." }, { status: 400 });
  }

  const supabase = createAdminClient();
  if (!supabase) return NextResponse.json({ error: "Database not configured." }, { status: 503 });

  // Verify category ownership if provided
  if (category_id) {
    const { data: cat } = await supabase
      .from("record_categories")
      .select("id")
      .eq("id", category_id)
      .or(`user_id.eq.${session.user_id},is_default.eq.true`)
      .maybeSingle();

    if (!cat) return NextResponse.json({ error: "Category not found." }, { status: 400 });
  }

  const taxYearStart = getCurrentTaxYearStart(new Date(record_date));
  const date = new Date(record_date);
  const taxQuarter = getTaxQuarter(taxYearStart, date);

  const { data: record, error } = await supabase
    .from("financial_records")
    .insert({
      user_id: session.user_id,
      record_type,
      record_date,
      description: description.trim(),
      amount: amount_pence / 100,
      category_id: category_id ?? null,
      source_type: "agent_draft",
      status: "review",
      tax_year_start: taxYearStart,
      tax_quarter: taxQuarter,
    })
    .select("id, status")
    .single();

  if (error || !record) {
    await logAgentAction({
      userId: session.user_id,
      sessionId: session.id,
      tool: "draft_record",
      scopeUsed: "draft:record",
      paramsSummary: `type=${record_type} date=${record_date} amount=${amount_pence}p`,
      resultStatus: "error",
      error: error?.message,
    });
    return NextResponse.json({ error: "Could not create draft record." }, { status: 500 });
  }

  await logAgentAction({
    userId: session.user_id,
    sessionId: session.id,
    tool: "draft_record",
    scopeUsed: "draft:record",
    paramsSummary: `type=${record_type} date=${record_date} amount=${amount_pence}p id=${record.id}`,
    resultStatus: "ok",
  });

  return NextResponse.json({
    id: record.id,
    status: "review",
    message: "Draft record created. A human must review and approve it in VibeCount before it affects any summaries.",
  });
}

function getTaxQuarter(taxYearStart: number, date: Date): number {
  const boundaries = [
    new Date(Date.UTC(taxYearStart, 3, 6)),
    new Date(Date.UTC(taxYearStart, 6, 6)),
    new Date(Date.UTC(taxYearStart, 9, 6)),
    new Date(Date.UTC(taxYearStart + 1, 0, 6)),
  ];
  for (let i = boundaries.length - 1; i >= 0; i--) {
    if (date >= boundaries[i]) return i + 1;
  }
  return 1;
}

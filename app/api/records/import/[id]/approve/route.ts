import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, ctx: RouteContext<"/api/records/import/[id]/approve">) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to approve imports." }, { status: 401 });
  }

  const { id } = await ctx.params;

  // Load the pending import row
  const { data: importRow, error: fetchError } = await supabase
    .from("record_imports")
    .select("id, import_date, amount_pence, description, record_type, suggested_category, status, committed_record_id, source")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !importRow) {
    return NextResponse.json({ error: "Import row not found." }, { status: 404 });
  }

  // Idempotent: already approved
  if (importRow.status === "approved" && importRow.committed_record_id) {
    const { data: existing } = await supabase
      .from("financial_records")
      .select("id, record_type, record_date, amount_pence, description, category")
      .eq("id", importRow.committed_record_id)
      .single();
    return NextResponse.json({ record: existing, already_approved: true });
  }

  if (importRow.status === "rejected") {
    return NextResponse.json({ error: "This import row was rejected and cannot be approved." }, { status: 409 });
  }

  // Commit to financial_records
  const { data: record, error: recordError } = await supabase
    .from("financial_records")
    .insert({
      user_id: user.id,
      record_type: importRow.record_type,
      record_date: importRow.import_date,
      amount_pence: importRow.amount_pence,
      description: importRow.description,
      category: importRow.suggested_category ?? "Uncategorised",
      source: importRow.source,
    })
    .select("id, record_type, record_date, amount_pence, description, category, tax_year_start, tax_quarter")
    .single();

  if (recordError) {
    return NextResponse.json({ error: "Could not commit the record." }, { status: 500 });
  }

  // Mark import as approved
  await supabase
    .from("record_imports")
    .update({ status: "approved", committed_record_id: record.id })
    .eq("id", id)
    .eq("user_id", user.id);

  return NextResponse.json({ record }, { status: 201 });
}

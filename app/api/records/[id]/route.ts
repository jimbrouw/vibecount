import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/records/[id]">) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to edit a record." }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.record_date !== undefined) updates.record_date = body.record_date;
  if (body.amount_pence !== undefined) updates.amount_pence = body.amount_pence;
  if (body.description !== undefined) updates.description = body.description;
  if (body.category !== undefined) updates.category = body.category;

  const { data, error } = await supabase
    .from("financial_records")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id) // RLS also enforces this
    .select("id, record_type, record_date, amount_pence, description, category, tax_year_start, tax_quarter")
    .single();

  if (error) {
    return NextResponse.json({ error: "Could not update the record." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Record not found." }, { status: 404 });
  }

  return NextResponse.json({ record: data });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/records/[id]">) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to delete a record." }, { status: 401 });
  }

  const { id } = await ctx.params;

  const { error } = await supabase
    .from("financial_records")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "Could not delete the record." }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}

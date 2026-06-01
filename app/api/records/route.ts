import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to view records." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const taxYear = searchParams.get("tax_year");
  const quarter = searchParams.get("quarter");
  const type = searchParams.get("type");

  let query = supabase
    .from("financial_records")
    .select("id, record_type, record_date, amount_pence, description, category, source, tax_year_start, tax_quarter")
    .eq("user_id", user.id)
    .order("record_date", { ascending: false });

  if (taxYear) query = query.eq("tax_year_start", Number(taxYear));
  if (quarter) query = query.eq("tax_quarter", Number(quarter));
  if (type === "income" || type === "expense") query = query.eq("record_type", type);

  const { data: records, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Could not load records." }, { status: 500 });
  }

  const rows = records ?? [];
  const total_income_pence = rows
    .filter((r) => r.record_type === "income")
    .reduce((sum, r) => sum + r.amount_pence, 0);
  const total_expenses_pence = rows
    .filter((r) => r.record_type === "expense")
    .reduce((sum, r) => sum + r.amount_pence, 0);

  return NextResponse.json({ records: rows, total_income_pence, total_expenses_pence });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to add a record." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const record_type = body.record_type;
  if (record_type !== "income" && record_type !== "expense") {
    return NextResponse.json({ error: "record_type must be 'income' or 'expense'." }, { status: 400 });
  }

  const record_date = String(body.record_date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record_date)) {
    return NextResponse.json({ error: "record_date must be ISO format YYYY-MM-DD." }, { status: 400 });
  }

  const amount_pence = Number(body.amount_pence);
  if (!Number.isInteger(amount_pence) || amount_pence <= 0) {
    return NextResponse.json({ error: "amount_pence must be a positive integer." }, { status: 400 });
  }

  const description = String(body.description ?? "").trim();
  if (!description) {
    return NextResponse.json({ error: "description is required." }, { status: 400 });
  }

  const category = String(body.category ?? "Uncategorised").trim() || "Uncategorised";
  const source = body.source ?? "manual";

  const { data, error } = await supabase
    .from("financial_records")
    .insert({ user_id: user.id, record_type, record_date, amount_pence, description, category, source })
    .select("id, record_type, record_date, amount_pence, description, category, source, tax_year_start, tax_quarter")
    .single();

  if (error) {
    return NextResponse.json({ error: "Could not save the record." }, { status: 500 });
  }

  return NextResponse.json({ record: data }, { status: 201 });
}

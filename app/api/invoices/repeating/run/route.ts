import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { nextRunDateFrom, type RepeatingFrequency } from "@/lib/repeating-invoices";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return POST();
}

type TemplateRow = {
  id: string;
  user_id: string;
  client_id: string;
  title: string;
  description: string;
  amount: number | string;
  payment_terms: string;
  frequency: RepeatingFrequency;
  next_run_date: string;
};

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in to create repeating drafts." }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data: templates, error } = await supabase
    .from("repeating_invoice_templates")
    .select("id, user_id, client_id, title, description, amount, payment_terms, frequency, next_run_date")
    .eq("user_id", user.id)
    .eq("status", "active")
    .lte("next_run_date", today)
    .limit(20);

  if (error) {
    return NextResponse.json({ error: "Could not read repeating templates." }, { status: 500 });
  }

  const created: string[] = [];

  for (const template of (templates ?? []) as TemplateRow[]) {
    const number = await nextInvoiceNumber(supabase, user.id);
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .insert({
        user_id: user.id,
        client_id: template.client_id,
        number,
        invoice_date: template.next_run_date,
        description: template.description,
        amount: Number(template.amount),
        payment_terms: template.payment_terms,
        status: "draft",
      })
      .select("id")
      .single();

    if (invoiceError || !invoice) continue;

    const { error: runError } = await supabase.from("repeating_invoice_runs").insert({
      user_id: user.id,
      template_id: template.id,
      invoice_id: invoice.id,
      due_date: template.next_run_date,
    });

    if (runError) continue;

    await supabase
      .from("repeating_invoice_templates")
      .update({
        next_run_date: nextRunDateFrom(template.next_run_date, template.frequency),
      })
      .eq("id", template.id)
      .eq("user_id", user.id);

    created.push(invoice.id);
  }

  return NextResponse.json({ ok: true, createdDraftCount: created.length, invoiceIds: created });
}

async function nextInvoiceNumber(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
) {
  const year = new Date().getFullYear();
  const { count } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  return `DRAFT-${year}-${String((count ?? 0) + 1).padStart(4, "0")}`;
}

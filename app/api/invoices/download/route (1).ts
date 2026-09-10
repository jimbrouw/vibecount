import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to download invoices." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const invoiceId = searchParams.get("id");
  if (!invoiceId) return NextResponse.json({ error: "Missing invoice ID." }, { status: 400 });

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, number, pdf_path")
    .eq("id", invoiceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!invoice?.pdf_path) {
    return NextResponse.json({ error: "No stored PDF for this invoice." }, { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from("invoices")
    .createSignedUrl(invoice.pdf_path, 60 * 5, {
      download: `${invoice.number}.pdf`,
    });

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "Could not create download link." }, { status: 500 });
  }

  return NextResponse.redirect(data.signedUrl);
}

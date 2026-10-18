import { isNativeGbpInvoice } from "@/lib/invoices/native";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user }, error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user)
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const invoiceId = searchParams.get("id");
  if (!invoiceId)
    return NextResponse.json({ error: "Missing invoice ID." }, { status: 400 });

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("id, number, pdf_path, origin, currency, amount")
    .eq("id", invoiceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (invoiceError) return NextResponse.json({error:"Invoice metadata is unavailable."},{status:503});
  if (!invoice)
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });

  if (!isNativeGbpInvoice(invoice)) return NextResponse.json({error:"Use the preserved invoice evidence workflow. This endpoint serves native GBP invoice PDFs only."},{status:409});
  let pdfPath = invoice.pdf_path as string | null;
  const revisionId = searchParams.get("revision");
  if (revisionId) {
    const { data: revision, error: revisionError } = await supabase
      .from("invoice_revisions")
      .select("pdf_path,origin")
      .eq("id", revisionId)
      .eq("invoice_id", invoice.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (revisionError || !revision || revision.origin !== "native_gbp")
      return NextResponse.json(
        { error: "Invoice revision not found." },
        { status: 404 },
      );
    pdfPath = revision.pdf_path;
  }

  if (!pdfPath)
    return NextResponse.json(
      {
        error:
          "The original PDF is unavailable. Review the invoice and its VAT breakdown before creating a preserved revision.",
      },
      { status: 409 },
    );

  const { data, error } = await supabase.storage
    .from("invoices")
    .createSignedUrl(pdfPath, THIRTY_DAYS_SECONDS);

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: "Could not create share link." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    url: data.signedUrl,
    expiresInDays: 30,
    invoiceNumber: invoice.number,
  });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createInvoicePdf } from "@/lib/invoices/pdf";
import { loadPdfBranding } from "@/lib/pdf/settings-branding";

export const runtime = "nodejs";

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const invoiceId = searchParams.get("id");
  if (!invoiceId) return NextResponse.json({ error: "Missing invoice ID." }, { status: 400 });

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, number, pdf_path, invoice_date, description, amount, payment_terms, clients(name, address, vat_number)")
    .eq("id", invoiceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });

  let pdfPath = invoice.pdf_path as string | null;

  // Generate and upload PDF on demand for invoices created before Storage was set up
  if (!pdfPath) {
    const { data: settings } = await supabase
      .from("user_settings")
      .select("legal_name, address, contact_details, bank_details, payment_link_provider, payment_link_url, vat_registered, vat_number, vat_rate, late_payment_wording, pdf_logo_path, pdf_primary_color, pdf_accent_color")
      .eq("id", user.id)
      .maybeSingle();

    const client = invoice.clients as { name?: string; address?: string; vat_number?: string } | null;

    const pdfBytes = await createInvoicePdf({
      number: invoice.number as string,
      invoiceDate: invoice.invoice_date as string,
      clientName: client?.name ?? "",
      clientAddress: client?.address ?? "",
      clientVatNumber: settings?.vat_registered ? (client?.vat_number ?? "") : "",
      description: invoice.description as string,
      amountPence: Math.round(Number(invoice.amount) * 100),
      vatPence: 0,
      paymentTerms: invoice.payment_terms as string ?? "",
      freelancerEmail: user.email ?? "",
      freelancerName: settings?.legal_name ?? "",
      freelancerAddress: settings?.address ?? "",
      freelancerContact: settings?.contact_details ?? "",
      bankDetails: settings?.bank_details ?? "",
      paymentLinkProvider: settings?.payment_link_provider ?? "",
      paymentLinkUrl: settings?.payment_link_url ?? "",
      vatNumber: settings?.vat_number ?? "",
      vatRate: settings?.vat_rate ?? null,
      latePaymentWording: settings?.late_payment_wording ?? "",
      branding: await loadPdfBranding(supabase, settings),
    });

    const filename = `${invoice.number}.pdf`;
    const storagePath = `${user.id}/${filename}`;

    const { error: uploadError } = await supabase.storage
      .from("invoices")
      .upload(storagePath, Buffer.from(pdfBytes), {
        contentType: "application/pdf",
        upsert: true,
      });

    if (!uploadError) {
      await supabase
        .from("invoices")
        .update({ pdf_path: storagePath })
        .eq("id", invoice.id)
        .eq("user_id", user.id);
      pdfPath = storagePath;
    } else {
      console.error("On-demand PDF upload failed:", uploadError.message);
      return NextResponse.json({ error: "Could not generate and store the PDF for this invoice." }, { status: 500 });
    }
  }

  const { data, error } = await supabase.storage
    .from("invoices")
    .createSignedUrl(pdfPath, THIRTY_DAYS_SECONDS);

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "Could not create share link." }, { status: 500 });
  }

  return NextResponse.json({
    url: data.signedUrl,
    expiresInDays: 30,
    invoiceNumber: invoice.number,
  });
}

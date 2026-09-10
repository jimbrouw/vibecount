import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createInvoicePdf } from "@/lib/invoices/pdf";
import { loadPdfBranding } from "@/lib/pdf/settings-branding";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to preview PDF branding." }, { status: 401 });
  }

  const { data: settings } = await supabase
    .from("user_settings")
    .select(
      "legal_name, address, contact_details, bank_details, payment_link_provider, payment_link_url, vat_number, vat_rate, late_payment_wording, pdf_logo_path, pdf_primary_color, pdf_accent_color"
    )
    .eq("id", user.id)
    .maybeSingle();

  const bytes = await createInvoicePdf({
    number: "SAMPLE-0001",
    invoiceDate: new Date().toISOString().slice(0, 10),
    clientName: "Sample Client Ltd",
    clientAddress: "1 Example Street\nManchester\nM1 1AA",
    clientVatNumber: "",
    description: "Sample brand preview invoice",
    amountPence: 125000,
    vatPence: 0,
    paymentTerms: "Payment due within 30 days",
    freelancerEmail: user.email ?? "",
    freelancerName: settings?.legal_name ?? "Your business name",
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

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="vibecount-pdf-brand-preview.pdf"',
    },
  });
}

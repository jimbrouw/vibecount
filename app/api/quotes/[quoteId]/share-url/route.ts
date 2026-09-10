import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createQuotePdf } from "@/lib/quotes/pdf";
import { loadPdfBranding } from "@/lib/pdf/settings-branding";

export const runtime = "nodejs";

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

type Params = {
  params: Promise<{ quoteId: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Sign in to share quotes." }, { status: 401 });

  const { quoteId } = await params;
  const { data: quote } = await supabase
    .from("quotes")
    .select(
      "id, number, quote_date, valid_until, notes, pdf_path, clients(name), quote_line_items(description, quantity, unit_price)"
    )
    .eq("id", quoteId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!quote) return NextResponse.json({ error: "Quote not found." }, { status: 404 });

  let pdfPath = quote.pdf_path as string | null;

  if (!pdfPath) {
    const { data: settings } = await supabase
      .from("user_settings")
      .select("legal_name, address, contact_details, pdf_logo_path, pdf_primary_color, pdf_accent_color")
      .eq("id", user.id)
      .maybeSingle();

    const bytes = await createQuotePdf({
      number: quote.number as string,
      quoteDate: quote.quote_date as string,
      validUntil: quote.valid_until as string | null,
      clientName: (quote.clients as { name?: string } | null)?.name ?? "Client",
      freelancerName: settings?.legal_name ?? "",
      freelancerEmail: user.email ?? "",
      freelancerAddress: settings?.address ?? "",
      freelancerContact: settings?.contact_details ?? "",
      notes: (quote.notes as string | null) ?? "",
      branding: await loadPdfBranding(supabase, settings),
      items: ((quote.quote_line_items ?? []) as {
        description: string;
        quantity: number | string;
        unit_price: number | string;
      }[]).map((item) => ({
        description: item.description,
        quantity: Number(item.quantity),
        unitPricePence: Math.round(Number(item.unit_price) * 100),
      })),
    });

    const filename = `${quote.number}.pdf`;
    pdfPath = `${user.id}/quotes/${filename}`;
    const { error } = await supabase.storage
      .from("invoices")
      .upload(pdfPath, Buffer.from(bytes), {
        contentType: "application/pdf",
        upsert: true,
      });

    if (error) {
      console.error("Quote share PDF upload failed:", error.message);
      return NextResponse.json({ error: "Could not prepare quote PDF." }, { status: 500 });
    }

    await supabase.from("quotes").update({ pdf_path: pdfPath }).eq("id", quoteId).eq("user_id", user.id);
  }

  const { data, error } = await supabase.storage
    .from("invoices")
    .createSignedUrl(pdfPath, THIRTY_DAYS_SECONDS);

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "Could not create quote link." }, { status: 500 });
  }

  return NextResponse.json({ url: data.signedUrl, expiresInDays: 30, quoteNumber: quote.number });
}

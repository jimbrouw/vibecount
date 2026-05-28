import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createQuotePdf } from "@/lib/quotes/pdf";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ quoteId: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in to download quotes." }, { status: 401 });
  }

  const { quoteId } = await params;
  const { data: quote, error } = await supabase
    .from("quotes")
    .select(
      "id, number, quote_date, valid_until, notes, clients(name), quote_line_items(description, quantity, unit_price)"
    )
    .eq("id", quoteId)
    .eq("user_id", user.id)
    .single();

  if (error || !quote) {
    return NextResponse.json({ error: "Quote not found." }, { status: 404 });
  }

  const { data: settings } = await supabase
    .from("user_settings")
    .select("legal_name, address, contact_details")
    .eq("id", user.id)
    .maybeSingle();

  const bytes = await createQuotePdf({
    number: quote.number,
    quoteDate: quote.quote_date,
    validUntil: quote.valid_until,
    clientName: (quote.clients as { name?: string } | null)?.name ?? "Client",
    freelancerName: settings?.legal_name ?? "",
    freelancerEmail: user.email ?? "",
    freelancerAddress: settings?.address ?? "",
    freelancerContact: settings?.contact_details ?? "",
    notes: quote.notes ?? "",
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

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${quote.number}.pdf"`,
    },
  });
}

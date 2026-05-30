import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createProposalPdf } from "@/lib/proposals/pdf";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to download proposals." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const proposalId = searchParams.get("id");
  if (!proposalId) return NextResponse.json({ error: "Missing proposal ID." }, { status: 400 });

  const { data: proposal, error } = await supabase
    .from("proposals")
    .select("id, number, proposal_date, valid_until, title, scope, deliverables, timeline_start, timeline_end, payment_terms, notes, clients(name), proposal_line_items(description, quantity, unit_price, sort_order)")
    .eq("id", proposalId)
    .eq("user_id", user.id)
    .single();

  if (error || !proposal) return NextResponse.json({ error: "Proposal not found." }, { status: 404 });

  const { data: settings } = await supabase
    .from("user_settings")
    .select("legal_name, contact_details")
    .eq("id", user.id)
    .maybeSingle();

  const items = ((proposal.proposal_line_items ?? []) as {
    description: string;
    quantity: number | string;
    unit_price: number | string;
    sort_order: number;
  }[])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item) => ({
      description: item.description,
      quantity: Number(item.quantity),
      unitPricePence: Math.round(Number(item.unit_price) * 100),
    }));

  const bytes = await createProposalPdf({
    number: proposal.number,
    proposalDate: proposal.proposal_date,
    validUntil: proposal.valid_until ?? null,
    title: proposal.title,
    scope: proposal.scope ?? "",
    deliverables: proposal.deliverables ?? "",
    timelineStart: proposal.timeline_start ?? null,
    timelineEnd: proposal.timeline_end ?? null,
    paymentTerms: proposal.payment_terms ?? "Net 30",
    clientName: (proposal.clients as { name?: string } | null)?.name ?? "Client",
    freelancerName: settings?.legal_name ?? "",
    freelancerEmail: user.email ?? "",
    notes: proposal.notes ?? "",
    items,
  });

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${proposal.number}.pdf"`,
    },
  });
}

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

  const filename = `${proposal.number}.pdf`;

  // Upload to Supabase Storage at {userId}/proposals/{number}.pdf (best-effort)
  const storagePath = `${user.id}/proposals/${filename}`;
  const { error: uploadError } = await supabase.storage
    .from("invoices")
    .upload(storagePath, Buffer.from(bytes), {
      contentType: "application/pdf",
      upsert: true,
    });

  if (!uploadError) {
    await supabase
      .from("proposals")
      .update({ pdf_path: storagePath })
      .eq("id", proposalId)
      .eq("user_id", user.id);
  } else {
    console.error("Proposal PDF storage upload failed:", uploadError.message);
  }

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

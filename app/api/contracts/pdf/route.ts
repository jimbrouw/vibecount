import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createContractPdf } from "@/lib/contracts/pdf";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to download contracts." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const contractId = searchParams.get("id");
  if (!contractId) return NextResponse.json({ error: "Missing contract ID." }, { status: 400 });

  const { data: contract, error } = await supabase
    .from("contracts")
    .select("id, number, contract_date, title, scope, deliverables, timeline_start, timeline_end, payment_terms, total_pence, custom_terms, status, clients(name)")
    .eq("id", contractId)
    .eq("user_id", user.id)
    .single();

  if (error || !contract) return NextResponse.json({ error: "Contract not found." }, { status: 404 });

  const { data: settings } = await supabase
    .from("user_settings")
    .select("legal_name")
    .eq("id", user.id)
    .maybeSingle();

  const bytes = await createContractPdf({
    number: contract.number,
    contractDate: contract.contract_date,
    title: contract.title,
    scope: contract.scope ?? "",
    deliverables: contract.deliverables ?? "",
    timelineStart: contract.timeline_start ?? null,
    timelineEnd: contract.timeline_end ?? null,
    paymentTerms: contract.payment_terms ?? "Net 30",
    totalPence: Number(contract.total_pence),
    customTerms: contract.custom_terms ?? "",
    clientName: (contract.clients as { name?: string } | null)?.name ?? "Client",
    freelancerName: settings?.legal_name ?? "",
    freelancerEmail: user.email ?? "",
    status: contract.status,
  });

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${contract.number}.pdf"`,
    },
  });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createContractPdf } from "@/lib/contracts/pdf";
import { PDFDocument } from "pdf-lib";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to sign contracts." }, { status: 401 });

  const body = await request.json() as { contractId: string; signatureDataUrl: string };
  const { contractId, signatureDataUrl } = body;

  if (!contractId || !signatureDataUrl?.startsWith("data:image/png;base64,")) {
    return NextResponse.json({ error: "Missing contract ID or invalid signature." }, { status: 400 });
  }

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

  // Generate base PDF
  const pdfBytes = await createContractPdf({
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
    status: "signed",
  });

  // Embed signature image into the signature block
  const pngBase64 = signatureDataUrl.replace("data:image/png;base64,", "");
  const pngBytes = Buffer.from(pngBase64, "base64");

  const pdf = await PDFDocument.load(pdfBytes);
  const page = pdf.getPage(0);
  const sigImage = await pdf.embedPng(pngBytes);

  // Signature block is at y=100 (from bottom), x=48, width=180
  page.drawImage(sigImage, { x: 50, y: 102, width: 160, height: 36 });

  const signedBytes = await pdf.save();

  // Mark as signed
  await supabase
    .from("contracts")
    .update({ status: "signed", signed_at: new Date().toISOString() })
    .eq("id", contractId)
    .eq("user_id", user.id);

  return new NextResponse(Buffer.from(signedBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${contract.number}-signed.pdf"`,
    },
  });
}

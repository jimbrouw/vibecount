import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PDFDocument } from "pdf-lib";
import { renderReceiptPdfPage } from "@/lib/records/receipt-extraction";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request, { params }: { params: Promise<{ receiptId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to open receipts." }, { status: 401 });
  const { receiptId } = await params;
  const { data } = await supabase.from("record_attachments").select("object_path, content_type").eq("id", receiptId).eq("user_id", user.id).eq("status", "active").not("receipt_state", "is", null).maybeSingle();
  if (!data) return NextResponse.json({ error: "Receipt not found." }, { status: 404 });
  const { data: file, error } = await supabase.storage.from("record-attachments").download(data.object_path);
  if (error || !file) return NextResponse.json({ error: "Could not open this receipt." }, { status: 503 });
  const bytes = await file.arrayBuffer();
  const query = new URL(request.url).searchParams;
  if (data.content_type === "application/pdf" && (query.has("preview") || query.has("info"))) {
    try {
      if (query.has("info")) {
        const pdf = await PDFDocument.load(bytes);
        return NextResponse.json({ pageCount: pdf.getPageCount() }, { headers: { "Cache-Control": "private, no-store" } });
      }
      const png = await renderReceiptPdfPage(Buffer.from(bytes), Number(query.get("page") ?? 1));
      return new NextResponse(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    } catch { return NextResponse.json({ error: "Preview unavailable. Open the original PDF." }, { status: 422, headers: { "Cache-Control": "no-store" } }); }
  }
  return new NextResponse(bytes, { headers: { "Content-Type": data.content_type, "Content-Disposition": "inline", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

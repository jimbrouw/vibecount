import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ receiptId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to open receipts." }, { status: 401 });
  const { receiptId } = await params;
  const { data } = await supabase.from("record_attachments").select("object_path, content_type").eq("id", receiptId).eq("user_id", user.id).eq("status", "active").not("receipt_state", "is", null).maybeSingle();
  if (!data) return NextResponse.json({ error: "Receipt not found." }, { status: 404 });
  const { data: file, error } = await supabase.storage.from("record-attachments").download(data.object_path);
  if (error || !file) return NextResponse.json({ error: "Could not open this receipt." }, { status: 503 });
  return new NextResponse(await file.arrayBuffer(), { headers: { "Content-Type": data.content_type, "Content-Disposition": "inline", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

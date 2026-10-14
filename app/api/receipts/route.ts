import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureRecordCategories } from "@/lib/records/categories";
import { extractReceipt, receiptContentType, RECEIPT_MAX_BYTES } from "@/lib/records/receipt-extraction";

export const runtime = "nodejs";
export const maxDuration = 60;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return reply({ error: "Sign in to review receipts." }, 401);
  const categories = await ensureRecordCategories(supabase, user.id);
  const [receipts, expenses, pending] = await Promise.all([
    supabase.from("record_attachments").select("id, original_filename, content_type, receipt_state, extraction, reviewed, extraction_method, receipt_error, record_id")
      .eq("user_id", user.id).eq("status", "active").not("receipt_state", "is", null).order("created_at", { ascending: false }).limit(100),
    supabase.from("financial_records").select("id, description, record_date, amount, source_type, status, payment_status, expense_kind, gross_pence, business_use_percent")
      .eq("user_id", user.id).eq("record_type", "expense").order("created_at", { ascending: false }).limit(200),
    supabase.from("record_attachments").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "active").in("receipt_state", ["review", "reading", "failed"]),
  ]);
  if (receipts.error || expenses.error || pending.error) return reply({ error: "Receipt review is unavailable. Check the receipt migration and try again." }, 503);
  return reply({ receipts: receipts.data, expenses: expenses.data, categories: categories.filter(c => c.record_type === "expense"), awaitingReview: pending.count });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return reply({ error: "Sign in to import receipts." }, 401);
  if (Number(request.headers.get("content-length")) > RECEIPT_MAX_BYTES + 100_000) return reply({ error: "Use a receipt under 3 MB." }, 413);
  let attachmentId: string | null = null;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > RECEIPT_MAX_BYTES) return reply({ error: "Choose a PDF, JPEG, or PNG receipt under 3 MB." }, 400);
    const bytes = Buffer.from(await file.arrayBuffer());
    const contentType = receiptContentType(bytes);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const { data: duplicate, error: lookupError } = await supabase.from("record_attachments").select("id").eq("user_id", user.id).eq("content_hash", hash).eq("status", "active").maybeSingle();
    if (lookupError) return reply({ error: "Receipt import is unavailable. Check the receipt migration." }, 503);
    if (duplicate) return reply({ id: duplicate.id, duplicate: true });
    const extension = contentType === "application/pdf" ? "pdf" : contentType === "image/png" ? "png" : "jpg";
    const path = `${user.id}/receipts/${hash}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("record-attachments").upload(path, bytes, { contentType, upsert: false });
    if (uploadError) return reply({ error: "Could not store the receipt privately. Retry the upload." }, 409);
    const { data: attachment, error } = await supabase.from("record_attachments").insert({ user_id: user.id, object_path: path,
      original_filename: file.name.replace(/[\x00-\x1f]/g, "").slice(0, 160) || `receipt.${extension}`, content_type: contentType,
      size_bytes: bytes.length, content_hash: hash, receipt_state: "reading" }).select("id").single();
    if (error || !attachment) {
      await supabase.storage.from("record-attachments").remove([path]);
      return reply({ error: "Could not save the receipt review. Retry the upload." }, 500);
    }
    attachmentId = attachment.id;
    const categories = await ensureRecordCategories(supabase, user.id);
    const { draft, method } = await extractReceipt(bytes, contentType, categories);
    const { error: updateError } = await supabase.from("record_attachments").update({ extraction: draft, extraction_method: method, receipt_state: "review", receipt_error: null }).eq("id", attachmentId).eq("user_id", user.id);
    if (updateError) throw new Error("Could not save the extracted details. Retry reading this receipt.");
    return reply({ id: attachmentId, draft, method });
  } catch (error) {
    // Never log source bytes, text, model output or financial fields.
    const message = error instanceof Error && /^(Choose|Use a receipt|Receipt reading|This looks|Could not save)/.test(error.message)
      ? error.message : "Could not read this receipt. Retry, or enter its details yourself.";
    if (attachmentId) {
      if (message.startsWith("This looks")) {
        const { data } = await supabase.from("record_attachments").select("object_path").eq("id", attachmentId).eq("user_id", user.id).single();
        if (data) await supabase.storage.from("record-attachments").remove([data.object_path]);
        await supabase.from("record_attachments").update({ status: "deleted", deleted_at: new Date().toISOString(), receipt_state: "failed", receipt_error: message }).eq("id", attachmentId).eq("user_id", user.id);
      } else {
        await supabase.from("record_attachments").update({ receipt_state: "failed", receipt_error: message }).eq("id", attachmentId).eq("user_id", user.id);
      }
    }
    return reply({ id: attachmentId, error: message }, 422);
  }
}

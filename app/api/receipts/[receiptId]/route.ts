import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ensureRecordCategories } from "@/lib/records/categories";
import { extractReceipt, UnsupportedReceiptError } from "@/lib/records/receipt-extraction";
import { validateReceiptConfirmation } from "@/lib/records/receipts";

export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ receiptId: string }> };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request, context: Context) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return reply({ error: "Sign in to review receipts." }, 401);
  const { receiptId } = await context.params;
  const { data: receipt } = await supabase.from("record_attachments").select("id, object_path, content_type, receipt_state, record_id")
    .eq("id", receiptId).eq("user_id", user.id).eq("status", "active").not("receipt_state", "is", null).maybeSingle();
  if (!receipt) return reply({ error: "Receipt not found." }, 404);
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return reply({ error: "Check the review details." }, 400); }
  if (input.action === "retry") {
    if (receipt.record_id) return reply({ error: "This expense is already saved. Correct the reviewed details instead." }, 409);
    try {
      const { error: stateError } = await supabase.from("record_attachments").update({ receipt_state: "reading" }).eq("id", receiptId).eq("user_id", user.id);
      if (stateError) throw new Error();
      const { data: file, error } = await supabase.storage.from("record-attachments").download(receipt.object_path);
      if (error || !file) throw new Error();
      const categories = await ensureRecordCategories(supabase, user.id);
      const result = await extractReceipt(Buffer.from(await file.arrayBuffer()), receipt.content_type, categories);
      const { error: updateError } = await supabase.from("record_attachments").update({ extraction: result.draft, extraction_method: result.method, receipt_state: "review", receipt_error: null }).eq("id", receiptId).eq("user_id", user.id).is("record_id", null);
      if (updateError) throw new Error();
      return reply({ id: receiptId });
    } catch (failure) {
      if (failure instanceof UnsupportedReceiptError) {
        const { error: removalError } = await supabase.storage.from("record-attachments").remove([receipt.object_path]);
        if (!removalError) await supabase.from("record_attachments").update({ status: "deleted", deleted_at: new Date().toISOString(), receipt_state: "failed", receipt_error: failure.message }).eq("id", receiptId).eq("user_id", user.id);
        return reply({ error: failure.message }, 422);
      }
      const error = "Receipt reading failed. Retry, or enter the details yourself.";
      await supabase.from("record_attachments").update({ receipt_state: "failed", receipt_error: error }).eq("id", receiptId).eq("user_id", user.id);
      return reply({ error }, 422);
    }
  }
  if (input.action === "exclude") {
    if (receipt.record_id) return reply({ error: "Use Records to exclude a saved expense." }, 409);
    const { error } = await supabase.from("record_attachments").update({ receipt_state: "excluded" }).eq("id", receiptId).eq("user_id", user.id);
    if (error) return reply({ error: "Could not exclude this receipt." }, 500);
    revalidatePath("/dashboard"); return reply({ ok: true });
  }
  let details;
  try { details = validateReceiptConfirmation(input); }
  catch (error) { return reply({ error: error instanceof Error ? error.message : "Check the expense details." }, 400); }
  const { data: recordId, error } = await supabase.rpc("confirm_receipt_document", { attachment_id: receiptId, details });
  if (error) return reply({ error: "Could not confirm this expense. Check the matching record, refund link, amount, and date, then retry." }, 409);
  for (const path of ["/dashboard", "/dashboard/records", "/dashboard/tax-prep"]) revalidatePath(path);
  return reply({ ok: true, recordId });
}

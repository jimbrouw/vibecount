"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redactBankDetailsForPrompt } from "@/lib/ai/redaction";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export async function reverseCredit(form: FormData) {
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const credit = String(form.get("creditId") ?? ""),
    request = String(form.get("requestId") ?? ""),
    stamp = String(form.get("stamp") ?? ""),
    reason = redactBankDetailsForPrompt(
      String(form.get("reason") ?? "").trim(),
    );
  let message = "";
  if (
    !uuid.test(credit) ||
    !uuid.test(request) ||
    !/^[a-f0-9]{32}$/.test(stamp) ||
    reason.length < 1 ||
    reason.length > 1000 ||
    form.get("humanConfirmed") !== "yes"
  )
    message = "Review the credit reversal, add a reason and confirm.";
  if (!message) {
    const result = await db.rpc("reverse_invoice_credit", {
      p_credit: credit,
      p_stamp: stamp,
      p_reason: reason,
      p_request: request,
    });
    if (result.error)
      message =
        "Reverse linked invoice refund assignments first, then reload and reverse the latest active credit.";
  }
  if (message)
    redirect(
      "/dashboard/reconciliation/credits?error=" + encodeURIComponent(message),
    );
  for (const path of [
    "/dashboard",
    "/dashboard/reconciliation",
    "/dashboard/reconciliation/credits",
    "/dashboard/invoices/history",
  ])
    revalidatePath(path);
  redirect("/dashboard/reconciliation/credits?result=reversed");
}

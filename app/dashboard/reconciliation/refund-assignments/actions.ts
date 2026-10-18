"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { decimalToPence } from "@/lib/money";
import { redactBankDetailsForPrompt } from "@/lib/ai/redaction";
import { readCurrentAssignmentContext } from "@/lib/records/native-connected-store";
import { requireSourceConfirmation } from "@/lib/records/native-source-context";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function fail(message: string): never {
  redirect(
    "/dashboard/reconciliation/refund-assignments?error=" +
      encodeURIComponent(message),
  );
}
async function context(form: FormData) {
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const stamp = String(form.get("stamp") ?? ""),
    reason = redactBankDetailsForPrompt(
      String(form.get("reason") ?? "").trim(),
    ),
    request = String(form.get("requestId") ?? "");
  if (
    form.get("humanConfirmed") !== "yes" ||
    !uuid.test(request) ||
    !/^[a-f0-9]{32}$/.test(stamp) ||
    reason.length < 1 ||
    reason.length > 1000
  )
    fail("Review the exact assignment effects, add a reason and confirm.");
  return { db, user, stamp, reason, request };
}
function refresh() {
  for (const path of [
    "/dashboard",
    "/dashboard/reconciliation",
    "/dashboard/reconciliation/credits",
    "/dashboard/reconciliation/refunds",
    "/dashboard/reconciliation/refund-assignments",
    "/dashboard/imports",
  ])
    revalidatePath(path);
}
export async function approveInvoiceRefund(form: FormData) {
  const { db, user, stamp, reason, request } = await context(form);
  const credit = String(form.get("creditId") ?? ""),
    allocation = String(form.get("allocationId") ?? ""),
    refund = String(form.get("refundId") ?? ""),
    amount = decimalToPence(String(form.get("amount") ?? ""));
  if (
    ![credit, allocation, refund].every((id) => uuid.test(id)) ||
    amount === null ||
    amount <= 0
  )
    fail("Choose valid parents and a positive exact amount.");
  const prior = await db.from("invoice_refund_requests").select("request_id").eq("user_id", user.id).eq("request_id", request).maybeSingle();
  if (prior.error) fail("Could not verify the retained assignment request. Reload before confirming.");
  if (!prior.data) {
    try {
      const dependencies = await readCurrentAssignmentContext(db, user.id, allocation, refund);
      requireSourceConfirmation(form,dependencies.source_context);
      if (dependencies.blocked || dependencies.financial_stamp !== stamp) throw new Error('Dependency review changed');
    } catch { fail("Receipt dependencies changed or include active FX. Reload and review linked conversion lots before assigning returned cash."); }
  }
  const { error } = await db.rpc("approve_invoice_refund_assignment", {
    p_credit: credit,
    p_allocation: allocation,
    p_refund: refund,
    p_amount: amount,
    p_stamp: stamp,
    p_reason: reason,
    p_request: request,
  });
  if (error)
    fail(
      "Refund, credit or receipt capacity changed. Reload and review the assignment again.",
    );
  refresh();
  redirect("/dashboard/reconciliation/refund-assignments?result=assigned");
}
export async function reverseInvoiceRefund(form: FormData) {
  const { db, stamp, reason, request } = await context(form);
  const assignment = String(form.get("assignmentId") ?? "");
  if (!uuid.test(assignment)) fail("Choose a valid refund assignment.");
  const { error } = await db.rpc("reverse_invoice_refund_assignment", {
    p_assignment: assignment,
    p_stamp: stamp,
    p_reason: reason,
    p_request: request,
  });
  if (error)
    fail("Refund assignment or balances changed. Reload before reversing.");
  refresh();
  redirect("/dashboard/reconciliation/refund-assignments?result=reversed");
}

"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redactBankDetailsForPrompt } from "@/lib/ai/redaction";
import { readFxSourceDependencies } from "@/lib/fx/dependency-store";
import { readRefundReversalDependencies } from "@/lib/records/refund-closure-store";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function fail(message: string): never {
  redirect(
    "/dashboard/reconciliation/refunds?error=" + encodeURIComponent(message),
  );
}
function refresh() {
  for (const path of [
    "/dashboard",
    "/dashboard/reconciliation",
    "/dashboard/reconciliation/refunds",
    "/dashboard/reconciliation/transfers",
    "/dashboard/imports",
    "/dashboard/records",
    "/dashboard/tax-prep",
    "/dashboard/projects",
    "/dashboard/review",
  ])
    revalidatePath(path);
}
async function context(form: FormData) {
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const original = String(form.get("original") ?? ""),
    request = String(form.get("requestId") ?? ""),
    stamp = String(form.get("stamp") ?? ""),
    reason = redactBankDetailsForPrompt(
      String(form.get("reason") ?? "").trim(),
    );
  if (
    !uuid.test(original) ||
    !uuid.test(request) ||
    !/^[a-f0-9]{32}$/.test(stamp) ||
    reason.length < 1 ||
    reason.length > 1000 ||
    form.get("humanConfirmed") !== "yes"
  )
    fail("Review the complete refund effects, add a reason and confirm.");
  return { db, user, original, request, stamp, reason };
}
export async function approveRefund(form: FormData) {
  const { db, user, original, request, stamp, reason } = await context(form);
  const refund = String(form.get("refund") ?? "");
  const originalVersion = Number(form.get("originalVersion")),
    refundVersion = Number(form.get("refundVersion"));
  if (
    !uuid.test(refund) ||
    form.get("originalVersion") === null ||
    form.get("refundVersion") === null ||
    !Number.isInteger(originalVersion) ||
    originalVersion < 0 ||
    !Number.isInteger(refundVersion) ||
    refundVersion < 0
  )
    fail("Review both source versions before confirming.");
  const prior = await db.from("refund_requests").select("request_id").eq("user_id", user.id).eq("request_id", request).maybeSingle();
  if (prior.error) fail("Could not verify the retained refund request. Reload before confirming.");
  if (!prior.data) {
    try {
      const dependencies = await readFxSourceDependencies(db, user.id, [original, refund]);
      if (dependencies.blocked) throw new Error('Linked FX');
    } catch { fail("Refund sources are unavailable or linked to active FX. Reload and review linked conversion lots first."); }
  }
  const { error } = await db.rpc("approve_refund", {
    p_original: original,
    p_original_version: originalVersion,
    p_refund: refund,
    p_refund_version: refundVersion,
    p_stamp: stamp,
    p_reason: reason,
    p_request: request,
  });
  if (error)
    fail(
      "Could not approve this refund. Reload the current source state and remaining original amount.",
    );
  refresh();
  redirect("/dashboard/reconciliation/refunds?result=approved");
}
export async function reverseRefundGroup(form: FormData) {
  const { db, user, original, request, stamp, reason } = await context(form);
  const prior = await db.from("refund_requests").select("request_id").eq("user_id", user.id).eq("request_id", request).maybeSingle();
  if (prior.error) fail("Could not verify the retained refund request. Reload before confirming.");
  if (!prior.data) {
    try {
      const review = await readRefundReversalDependencies(db, user.id, { kind: 'original', id: original });
      if (review.dependencies.blocked || !review.native_review) throw new Error('Linked FX');
    } catch { fail("Refund sources are unavailable or linked to active FX. Reload the complete refund reversal review."); }
  }
  const { error } = await db.rpc("reverse_refund_group", {
    p_original: original,
    p_stamp: stamp,
    p_reason: reason,
    p_request: request,
  });
  if (error)
    fail(
      "Reverse linked invoice refund assignments first, then reload the current refund group before reversing.",
    );
  refresh();
  redirect("/dashboard/reconciliation/refunds?result=reversed");
}

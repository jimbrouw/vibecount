"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redactBankDetailsForPrompt } from "@/lib/ai/redaction";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function fail(message: string): never {
  redirect(
    "/dashboard/reconciliation/duplicates?error=" + encodeURIComponent(message),
  );
}
async function context(form: FormData) {
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const transaction = String(form.get("transaction") ?? ""),
    stamp = String(form.get("stamp") ?? ""),
    request = String(form.get("requestId") ?? ""),
    reason = redactBankDetailsForPrompt(
      String(form.get("reason") ?? "").trim(),
    );
  if (
    !uuid.test(transaction) ||
    !uuid.test(request) ||
    !/^[a-f0-9]{32}$/.test(stamp) ||
    reason.length < 1 ||
    reason.length > 1000 ||
    form.get("humanConfirmed") !== "yes"
  )
    fail(
      "Review the complete source evidence, exact effects and reason before confirming.",
    );
  return { db, transaction, stamp, request, reason };
}
function refresh() {
  for (const path of [
    "/dashboard",
    "/dashboard/imports",
    "/dashboard/reconciliation",
    "/dashboard/reconciliation/duplicates",
    "/dashboard/records",
    "/dashboard/tax-prep",
    "/dashboard/review",
    "/dashboard/projects",
  ])
    revalidatePath(path);
}
export async function approveDuplicate(form: FormData) {
  const { db, transaction, stamp, request, reason } = await context(form),
    verdict = String(form.get("verdict") ?? ""),
    retained = String(form.get("retained") ?? "");
  if (
    !["duplicate", "distinct"].includes(verdict) ||
    (verdict === "duplicate" ? !uuid.test(retained) : retained !== "")
  )
    fail("Choose whether this is a duplicate or a separate real payment.");
  const { error } = await db.rpc("approve_duplicate_decision", {
    p_transaction: transaction,
    p_retained: retained || null,
    p_verdict: verdict,
    p_stamp: stamp,
    p_reason: reason,
    p_request: request,
  });
  if (error)
    fail(
      "Evidence or financial relationships changed. Reload the overlap and reverse existing identity, receipt, transfer or refund links before reviewing again.",
    );
  refresh();
  redirect(
    "/dashboard/reconciliation/duplicates?transaction=" +
      transaction +
      "&result=approved",
  );
}
export async function reverseDuplicate(form: FormData) {
  const { db, transaction, stamp, request, reason } = await context(form),
    decision = String(form.get("decision") ?? "");
  if (!uuid.test(decision)) fail("Choose an active identity verdict.");
  const { error } = await db.rpc("reverse_duplicate_decision", {
    p_decision: decision,
    p_stamp: stamp,
    p_reason: reason,
    p_request: request,
  });
  if (error)
    fail(
      "Evidence changed or this observation still supports other relationships. Reverse dependants and reload before reversing.",
    );
  refresh();
  redirect(
    "/dashboard/reconciliation/duplicates?transaction=" +
      transaction +
      "&result=reversed",
  );
}

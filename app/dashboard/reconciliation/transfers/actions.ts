"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redactBankDetailsForPrompt } from "@/lib/ai/redaction";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function fail(message: string): never {
  redirect(
    `/dashboard/reconciliation/transfers?error=${encodeURIComponent(message)}`,
  );
}
function refresh() {
  for (const path of [
    "/dashboard",
    "/dashboard/reconciliation",
    "/dashboard/reconciliation/transfers",
    "/dashboard/imports",
    "/dashboard/records",
    "/dashboard/tax-prep",
  ])
    revalidatePath(path);
}
export async function approveTransfer(form: FormData) {
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const outgoing = String(form.get("outgoing") ?? ""),
    incoming = String(form.get("incoming") ?? ""),
    request = String(form.get("requestId") ?? "");
  const outVersion = Number(form.get("outgoingVersion")),
    inVersion = Number(form.get("incomingVersion")),
    kind = String(form.get("kind") ?? "");
  const reason = redactBankDetailsForPrompt(
    String(form.get("reason") ?? "").trim(),
  );
  if (
    !uuid.test(outgoing) ||
    !uuid.test(incoming) ||
    !uuid.test(request) ||
    form.get("outgoingVersion") === null ||
    form.get("incomingVersion") === null ||
    !Number.isInteger(outVersion) ||
    outVersion < 0 ||
    !Number.isInteger(inVersion) ||
    inVersion < 0 ||
    !["transfer", "card_repayment"].includes(kind) ||
    reason.length < 1 ||
    reason.length > 1000 ||
    form.get("humanConfirmed") !== "yes"
  )
    fail("Review both source transactions, add a reason and confirm the pair.");
  const { error: pairError } = await db.rpc("approve_transfer_pair", {
    p_outgoing: outgoing,
    p_outgoing_version: outVersion,
    p_incoming: incoming,
    p_incoming_version: inVersion,
    p_kind: kind,
    p_reason: reason,
    p_request: request,
  });
  if (pairError)
    fail(
      "Could not pair these transactions. Review their amounts, account types, versions and existing allocations again.",
    );
  refresh();
  redirect("/dashboard/reconciliation/transfers?result=paired");
}
export async function reverseTransfer(form: FormData) {
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const pair = String(form.get("pairId") ?? ""),
    request = String(form.get("requestId") ?? "");
  const reason = redactBankDetailsForPrompt(
    String(form.get("reason") ?? "").trim(),
  );
  if (
    !uuid.test(pair) ||
    !uuid.test(request) ||
    reason.length < 1 ||
    reason.length > 1000 ||
    form.get("humanConfirmed") !== "yes"
  )
    fail("Add a reason and confirm both sides will become unresolved.");
  const { error: reverseError } = await db.rpc("reverse_transfer_pair", {
    p_pair: pair,
    p_reason: reason,
    p_request: request,
  });
  if (reverseError)
    fail(
      "Could not reverse this active pair. Reload the current source state.",
    );
  refresh();
  redirect("/dashboard/reconciliation/transfers?result=reversed");
}

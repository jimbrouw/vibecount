"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redactBankDetailsForPrompt } from "@/lib/ai/redaction";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function fail(message: string): never {
  redirect(`/dashboard/reconciliation?error=${encodeURIComponent(message)}`);
}
export async function approveAllocations(form: FormData) {
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const transaction = String(form.get("transactionId") ?? ""),
    request = String(form.get("requestId") ?? "");
  const version = Number(form.get("version"));
  const expectedAllocated = Number(form.get("expectedAllocated"));
  const reason = redactBankDetailsForPrompt(
    String(form.get("reason") ?? "").trim(),
  );
  if (
    !uuid.test(transaction) ||
    !uuid.test(request) ||
    !Number.isInteger(version) ||
    version < 1 ||
    !Number.isSafeInteger(expectedAllocated) ||
    expectedAllocated < 0 ||
    form.get("expectedAllocated") === null ||
    form.get("humanConfirmed") !== "yes" ||
    reason.length < 1 ||
    reason.length > 1000
  )
    fail("Review the exact allocations, add a reason and confirm.");
  let allocations: unknown;
  try {
    allocations = JSON.parse(String(form.get("allocations") ?? ""));
    if (
      !Array.isArray(allocations) ||
      allocations.length < 1 ||
      allocations.length > 50 ||
      allocations.some(
        (a) =>
          !a ||
          !uuid.test(a.invoice_id) ||
          !Number.isSafeInteger(a.amount_pence) ||
          a.amount_pence <= 0 ||
          typeof a.invoice_updated_at !== "string",
      )
    )
      throw new Error();
  } catch {
    fail("Choose valid exact invoice allocations.");
  }
  const { error: allocationError } = await db.rpc(
    "approve_invoice_allocations",
    {
      p_transaction: transaction,
      p_version: version,
      p_allocations: allocations,
      p_reason: reason,
      p_request: request,
      p_expected_allocated: expectedAllocated,
    },
  );
  if (allocationError)
    fail(
      "Could not approve these allocations. The receipt or invoice balances may have changed. Reload and review the amounts again.",
    );
  for (const path of [
    "/dashboard",
    "/dashboard/reconciliation",
    "/dashboard/imports",
  ])
    revalidatePath(path);
  redirect(`/dashboard/reconciliation?receipt=${transaction}&result=allocated`);
}
export async function reverseAllocation(form: FormData) {
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const allocation = String(form.get("allocationId") ?? ""),
    request = String(form.get("requestId") ?? "");
  const reason = redactBankDetailsForPrompt(
    String(form.get("reason") ?? "").trim(),
  );
  if (
    !uuid.test(allocation) ||
    !uuid.test(request) ||
    form.get("humanConfirmed") !== "yes" ||
    reason.length < 1 ||
    reason.length > 1000
  )
    fail("Add a reason and confirm this allocation reversal.");
  const { error: reversalError } = await db.rpc("reverse_invoice_allocation", {
    p_allocation: allocation,
    p_reason: reason,
    p_request: request,
  });
  if (reversalError)
    fail("Could not reverse this allocation. Reload its current review state.");
  for (const path of [
    "/dashboard",
    "/dashboard/reconciliation",
    "/dashboard/imports",
  ])
    revalidatePath(path);
  redirect("/dashboard/reconciliation?result=reversed");
}

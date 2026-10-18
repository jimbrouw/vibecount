"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redactBankDetailsForPrompt } from "@/lib/ai/redaction";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function fail(message: string): never {
  redirect("/dashboard/review/memory?error=" + encodeURIComponent(message));
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
    !/^[a-f0-9]{32}$/.test(stamp) ||
    !uuid.test(request) ||
    reason.length < 1 ||
    reason.length > 1000
  )
    fail("Review the full scope, exact effects and reason before confirming.");
  const year = Number(form.get("reviewYear"));
  const suffix =
    Number.isInteger(year) && year >= 2000 && year <= 2100
      ? `&year=${year}`
      : "";
  return { db, stamp, reason, request, suffix };
}
function refresh() {
  for (const path of [
    "/dashboard",
    "/dashboard/review",
    "/dashboard/review/memory",
    "/dashboard/imports",
    "/dashboard/records",
    "/dashboard/tax-prep",
    "/dashboard/projects",
  ])
    revalidatePath(path);
}
export async function saveMerchantRule(form: FormData) {
  const { db, stamp, reason, request, suffix } = await context(form);
  let definition;
  try {
    definition = JSON.parse(String(form.get("definition") ?? ""));
  } catch {
    fail("Review a valid merchant rule.");
  }
  const rule = String(form.get("ruleId") ?? ""),
    version = Number(form.get("version"));
  if (
    (rule && !uuid.test(rule)) ||
    !Number.isInteger(version) ||
    version < 0 ||
    !definition ||
    typeof definition !== "object"
  )
    fail("Review the current rule revision.");
  const { error } = await db.rpc("save_merchant_rule", {
    p_rule: rule || null,
    p_expected_version: version,
    p_definition: definition,
    p_stamp: stamp,
    p_reason: reason,
    p_request: request,
  });
  if (error)
    fail(
      "Rule scope or source/category changed. Reload and review the current merchant rule.",
    );
  refresh();
  redirect("/dashboard/review/memory?result=rule-saved" + suffix);
}
export async function saveMerchantRollover(form: FormData) {
  const { db, stamp, reason, request } = await context(form);
  const source = String(form.get("sourceVersionId") ?? ""), target = Number(form.get("targetYear"));
  const failure = (message: string): never => redirect(`/dashboard/review/memory/rollover?target=${Number.isInteger(target) ? target : ""}&error=${encodeURIComponent(message)}`);
  let definition;
  try { definition = JSON.parse(String(form.get("definition") ?? "")); }
  catch { return failure("Review a complete rollover definition."); }
  if (!uuid.test(source) || !Number.isInteger(target) || target < 2001 || target > 2100 || !definition || typeof definition !== "object" || Array.isArray(definition))
    failure("Review the source version and adjacent target tax year.");
  const r = await db.rpc("rollover_merchant_rule", { p_source_version: source, p_target_year: target, p_definition: definition, p_stamp: stamp, p_reason: reason, p_request: request });
  if (r.error || !uuid.test(String(r.data?.rule_id))) failure("Source, category or target scope changed or conflicts with an existing rollover. Reload and review the current rule.");
  refresh(); revalidatePath("/dashboard/review/memory/rollover");
  redirect(`/dashboard/review/memory/rollover?target=${target}&saved=${r.data.rule_id}`);
}
export async function approveMerchantBatch(form: FormData) {
  const { db, stamp, reason, request, suffix } = await context(form);
  let entries;
  try {
    entries = JSON.parse(String(form.get("entries") ?? ""));
  } catch {
    fail("Choose explicit reviewed rows.");
  }
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 50)
    fail("Choose 1 to 50 explicit reviewed rows.");
  const { error } = await db.rpc("approve_merchant_batch", {
    p_entries: entries,
    p_stamp: stamp,
    p_reason: reason,
    p_request: request,
  });
  if (error)
    fail(
      "Batch changed, has conflicting rules or contains unresolved financial dependencies. Reload and review every selected row.",
    );
  refresh();
  redirect("/dashboard/review/memory?result=batch-approved" + suffix);
}
export async function undoMerchantBatch(form: FormData) {
  const { db, stamp, reason, request, suffix } = await context(form),
    batch = String(form.get("batchId") ?? "");
  if (!uuid.test(batch)) fail("Choose a reviewed batch.");
  const { error } = await db.rpc("reverse_merchant_batch", {
    p_batch: batch,
    p_stamp: stamp,
    p_reason: reason,
    p_request: request,
  });
  if (error)
    fail(
      "A decision changed or now supports another relationship. Review corrections individually before retrying undo.",
    );
  refresh();
  redirect("/dashboard/review/memory?result=batch-reversed" + suffix);
}

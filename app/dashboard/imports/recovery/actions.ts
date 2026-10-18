"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redactBankDetailsForPrompt } from "@/lib/ai/redaction";
import { recoverEvidenceAttempt } from "@/lib/records/recovery-store";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function fail(message: string): never {
  redirect("/dashboard/imports/recovery?error=" + encodeURIComponent(message));
}
export async function recoverUpload(form: FormData) {
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const kind = String(form.get("kind") ?? ""),
    attempt = String(form.get("attempt") ?? ""),
    stamp = String(form.get("stamp") ?? ""),
    request = String(form.get("requestId") ?? ""),
    reason = redactBankDetailsForPrompt(
      String(form.get("reason") ?? "").trim(),
    );
  if (
    !["source", "document"].includes(kind) ||
    !uuid.test(attempt) ||
    !uuid.test(request) ||
    !/^[a-f0-9]{32}$/.test(stamp) ||
    reason.length < 1 ||
    reason.length > 1000 ||
    form.get("humanConfirmed") !== "yes"
  )
    fail(
      "Review the preserved source identity and scope, add a reason, and confirm recovery.",
    );
  try {
    await recoverEvidenceAttempt({
      owner: user.id,
      kind: kind as "source" | "document",
      attempt,
      stamp,
      request,
      reason,
    });
  } catch {
    fail(
      "Recovery could not verify every original or the reviewed scope changed. Reload the attempt. If a retained key or original is missing, restore it through the secure evidence process; legacy scope requires re-upload and review.",
    );
  }
  revalidatePath("/dashboard/imports");
  revalidatePath("/dashboard/imports/recovery");
  redirect("/dashboard/imports/recovery?result=recovered");
}

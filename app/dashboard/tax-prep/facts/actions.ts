"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redactBankDetailsForPrompt } from "@/lib/ai/redaction";
import { validateFact, validateProfile, type FactKind } from "@/lib/tax/facts";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export async function reviewTaxInputs(form: FormData) {
  const db = await createClient(),
    {
      data: { user },
      error,
    } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const year = Number(form.get("year")),
    stamp = String(form.get("stamp") ?? ""),
    request = String(form.get("requestId") ?? ""),
    reason = redactBankDetailsForPrompt(
      String(form.get("reason") ?? "").trim(),
    );
  const fail = (message: string): never =>
    redirect(
      `/dashboard/tax-prep/facts?year=${Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : ""}&error=${encodeURIComponent(message)}`,
    );
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100 ||
    form.get("humanConfirmed") !== "yes" ||
    !/^[a-f0-9]{32}$/.test(stamp) ||
    !uuid.test(request) ||
    reason.length < 1 ||
    reason.length > 1000
  )
    fail(
      "Review the complete tax-year scope, values, sources and reason before confirming.",
    );
  let review: Record<string, unknown>;
  try {
    review = JSON.parse(String(form.get("review") ?? ""));
    if (!review || typeof review !== "object" || Array.isArray(review))
      throw new Error();
    if (review.action === "profile")
      validateProfile(review.data, review.state === "reviewed");
    else if (review.action === "fact") {
      review.label = redactBankDetailsForPrompt(
        String(review.label ?? "").trim(),
      );
      const d = review.data as Record<string, unknown>;
      if (d && typeof d === "object")
        for (const k of Object.keys(d))
          if (typeof d[k] === "string")
            d[k] = redactBankDetailsForPrompt(d[k] as string);
      validateFact(review.kind as FactKind, d, year, String(review.state));
    } else if (review.action !== "section") throw new Error();
  } catch {
    return fail(
      "Review supported typed facts; missing and invalid values cannot be approved.",
    );
  }
  const result = await db.rpc("review_tax_inputs", {
    p_year: year,
    p_review: review,
    p_stamp: stamp,
    p_reason: reason,
    p_request: request,
  });
  if (result.error)
    fail(
      "Tax or source inputs changed, evidence is missing, or identity/allocation conflicts need review. Reload the current versions before retrying.",
    );
  for (const path of ["/dashboard/tax-prep", "/dashboard/tax-prep/facts"])
    revalidatePath(path);
  const kind =
    typeof review.kind === "string"
      ? `&kind=${encodeURIComponent(review.kind)}`
      : "";
  redirect(`/dashboard/tax-prep/facts?year=${year}${kind}&result=saved`);
}

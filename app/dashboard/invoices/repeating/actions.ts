"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validateRepeatingTemplateInput } from "@/lib/repeating-invoices";

export async function createRepeatingTemplate(formData: FormData) {
  const userId = await requireUserId();
  const parsed = validateRepeatingTemplateInput({
    clientId: String(formData.get("clientId") ?? ""),
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    amount: String(formData.get("amount") ?? ""),
    paymentTerms: String(formData.get("paymentTerms") ?? ""),
    frequency: String(formData.get("frequency") ?? ""),
    nextRunDate: String(formData.get("nextRunDate") ?? ""),
  });

  if (!parsed.ok) {
    redirect(`/dashboard/invoices/repeating?error=${encodeURIComponent(parsed.error)}`);
  }

  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("id", parsed.value.clientId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!client) {
    redirect(`/dashboard/invoices/repeating?error=${encodeURIComponent("Choose a valid client.")}`);
  }

  const { error } = await supabase.from("repeating_invoice_templates").insert({
    user_id: userId,
    client_id: parsed.value.clientId,
    title: parsed.value.title,
    description: parsed.value.description,
    amount: parsed.value.amountPence / 100,
    payment_terms: parsed.value.paymentTerms,
    frequency: parsed.value.frequency,
    next_run_date: parsed.value.nextRunDate,
    status: "active",
  });

  if (error) {
    redirect(`/dashboard/invoices/repeating?error=${encodeURIComponent("Could not save repeating template.")}`);
  }

  revalidatePath("/dashboard/invoices/repeating");
  redirect("/dashboard/invoices/repeating?created=1");
}

export async function setRepeatingTemplateStatus(formData: FormData) {
  const userId = await requireUserId();
  const templateId = String(formData.get("templateId") ?? "");
  const status = String(formData.get("status") ?? "") === "paused" ? "paused" : "active";

  if (!templateId) {
    redirect(`/dashboard/invoices/repeating?error=${encodeURIComponent("Choose a template.")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("repeating_invoice_templates")
    .update({ status })
    .eq("id", templateId)
    .eq("user_id", userId);

  if (error) {
    redirect(`/dashboard/invoices/repeating?error=${encodeURIComponent("Could not update template.")}`);
  }

  revalidatePath("/dashboard/invoices/repeating");
  redirect("/dashboard/invoices/repeating?updated=1");
}

async function requireUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  return user.id;
}

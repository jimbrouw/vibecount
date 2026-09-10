"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseAmountToPence } from "@/lib/invoices/money";

export async function createProject(formData: FormData) {
  const userId = await requireUserId();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const budgetRaw = String(formData.get("budget") ?? "").trim();
  const clientName = String(formData.get("clientName") ?? "").trim();

  if (!name) redirect(`/dashboard/projects?error=${encodeURIComponent("Add a project name.")}`);

  const budgetPence = budgetRaw ? (parseAmountToPence(budgetRaw) ?? 0) : 0;

  const supabase = await createClient();

  let clientId: string | null = null;
  if (clientName) {
    const { data: existing } = await supabase
      .from("clients")
      .select("id, name")
      .eq("user_id", userId);
    const match = existing?.find(
      (c) => c.name.toLowerCase().trim() === clientName.toLowerCase().trim()
    );
    if (match) {
      clientId = match.id;
    } else {
      const { data } = await supabase
        .from("clients")
        .insert({ user_id: userId, name: clientName.trim() })
        .select("id")
        .single();
      clientId = data?.id ?? null;
    }
  }

  const { error } = await supabase.from("projects").insert({
    user_id: userId,
    client_id: clientId,
    name,
    description,
    budget_pence: budgetPence,
    status: "active",
  });

  if (error) redirect(`/dashboard/projects?error=${encodeURIComponent("Could not save project.")}`);
  revalidatePath("/dashboard/projects");
  redirect("/dashboard/projects?created=1");
}

export async function setProjectStatus(formData: FormData) {
  const userId = await requireUserId();
  const projectId = String(formData.get("projectId") ?? "");
  const status = String(formData.get("status") ?? "");

  if (!["active", "completed", "archived"].includes(status) || !projectId) {
    redirect(`/dashboard/projects?error=${encodeURIComponent("Invalid project status.")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ status })
    .eq("id", projectId)
    .eq("user_id", userId);

  if (error) redirect(`/dashboard/projects?error=${encodeURIComponent("Could not update project.")}`);
  revalidatePath("/dashboard/projects");
  redirect("/dashboard/projects?updated=1");
}

export async function tagInvoiceToProject(formData: FormData) {
  const userId = await requireUserId();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const projectId = String(formData.get("projectId") ?? "") || null;

  if (!invoiceId) redirect(`/dashboard/projects?error=${encodeURIComponent("Missing invoice.")}`);

  const supabase = await createClient();
  const { error } = await supabase
    .from("invoices")
    .update({ project_id: projectId })
    .eq("id", invoiceId)
    .eq("user_id", userId);

  if (error) redirect(`/dashboard/projects?error=${encodeURIComponent("Could not tag invoice.")}`);
  revalidatePath("/dashboard/projects");
  redirect("/dashboard/projects?tagged=1");
}

export async function tagRecordToProject(formData: FormData) {
  const userId = await requireUserId();
  const recordId = String(formData.get("recordId") ?? "");
  const projectId = String(formData.get("projectId") ?? "") || null;

  if (!recordId) redirect(`/dashboard/projects?error=${encodeURIComponent("Missing record.")}`);

  const supabase = await createClient();
  const { error } = await supabase
    .from("financial_records")
    .update({ project_id: projectId })
    .eq("id", recordId)
    .eq("user_id", userId);

  if (error) redirect(`/dashboard/projects?error=${encodeURIComponent("Could not tag record.")}`);
  revalidatePath("/dashboard/projects");
  redirect("/dashboard/projects?tagged=1");
}

async function requireUserId() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user.id;
}

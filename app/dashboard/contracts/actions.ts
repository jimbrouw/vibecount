"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function generateContract(formData: FormData) {
  const userId = await requireUserId();
  const proposalId = String(formData.get("proposalId") ?? "");
  const customTerms = String(formData.get("customTerms") ?? "").trim();

  if (!proposalId) redirect(`/dashboard/proposals?error=${encodeURIComponent("Missing proposal.")}`);

  const supabase = await createClient();

  const { data: proposal } = await supabase
    .from("proposals")
    .select("id, client_id, title, scope, deliverables, timeline_start, timeline_end, payment_terms, notes, status, proposal_line_items(quantity, unit_price)")
    .eq("id", proposalId)
    .eq("user_id", userId)
    .single();

  if (!proposal) redirect(`/dashboard/proposals?error=${encodeURIComponent("Proposal not found.")}`);
  if (proposal.status !== "accepted") {
    redirect(`/dashboard/proposals?error=${encodeURIComponent("Only accepted proposals can generate a contract.")}`);
  }

  const totalPence = ((proposal.proposal_line_items ?? []) as { quantity: number | string; unit_price: number | string }[])
    .reduce((sum, item) => sum + Math.round(Number(item.quantity) * Number(item.unit_price) * 100), 0);

  const number = await nextContractNumber(supabase, userId);

  const { data: contract, error } = await supabase
    .from("contracts")
    .insert({
      user_id: userId,
      proposal_id: proposalId,
      client_id: proposal.client_id,
      number,
      contract_date: new Date().toISOString().slice(0, 10),
      title: proposal.title,
      scope: proposal.scope ?? "",
      deliverables: proposal.deliverables ?? "",
      timeline_start: proposal.timeline_start ?? null,
      timeline_end: proposal.timeline_end ?? null,
      payment_terms: proposal.payment_terms ?? "Net 30",
      total_pence: totalPence,
      custom_terms: customTerms,
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !contract) redirect(`/dashboard/contracts?error=${encodeURIComponent("Could not create contract.")}`);

  revalidatePath("/dashboard/contracts");
  redirect(`/dashboard/contracts?created=1`);
}

export async function setContractStatus(formData: FormData) {
  const userId = await requireUserId();
  const contractId = String(formData.get("contractId") ?? "");
  const status = String(formData.get("status") ?? "");

  if (!["draft", "sent", "signed"].includes(status) || !contractId) {
    redirect(`/dashboard/contracts?error=${encodeURIComponent("Invalid contract status.")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("contracts")
    .update({
      status,
      sent_at: status === "sent" ? new Date().toISOString() : undefined,
      signed_at: status === "signed" ? new Date().toISOString() : undefined,
    })
    .eq("id", contractId)
    .eq("user_id", userId);

  if (error) redirect(`/dashboard/contracts?error=${encodeURIComponent("Could not update contract.")}`);
  revalidatePath("/dashboard/contracts");
  redirect("/dashboard/contracts?updated=1");
}

async function requireUserId() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user.id;
}

async function nextContractNumber(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
) {
  const year = new Date().getFullYear();
  const { count } = await supabase
    .from("contracts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  return `CTR-${year}-${String((count ?? 0) + 1).padStart(4, "0")}`;
}

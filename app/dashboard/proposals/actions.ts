"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { normaliseClientName, parseAmountToPence } from "@/lib/invoices/money";
import { DEFAULT_PAYMENT_TERMS } from "@/lib/invoices/validation";

export async function createProposal(formData: FormData) {
  const userId = await requireUserId();
  const supabase = await createClient();

  const clientName = String(formData.get("clientName") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const proposalDate = String(formData.get("proposalDate") ?? "").trim();
  const validUntil = String(formData.get("validUntil") ?? "").trim() || null;
  const scope = String(formData.get("scope") ?? "").trim();
  const deliverables = String(formData.get("deliverables") ?? "").trim();
  const timelineStart = String(formData.get("timelineStart") ?? "").trim() || null;
  const timelineEnd = String(formData.get("timelineEnd") ?? "").trim() || null;
  const paymentTerms = String(formData.get("paymentTerms") ?? DEFAULT_PAYMENT_TERMS).trim();
  const description = String(formData.get("description") ?? "").trim();
  const quantity = Number(formData.get("quantity") ?? 1) || 1;
  const unitPriceRaw = String(formData.get("unitPrice") ?? "").trim();
  const serviceId = String(formData.get("serviceId") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim();

  if (!clientName) redirect(`/dashboard/proposals?error=${encodeURIComponent("Add a client name.")}`);
  if (!title) redirect(`/dashboard/proposals?error=${encodeURIComponent("Add a project title.")}`);
  if (!description) redirect(`/dashboard/proposals?error=${encodeURIComponent("Add a line item description.")}`);

  const unitPricePence = parseAmountToPence(unitPriceRaw);
  if (!unitPricePence || unitPricePence <= 0) {
    redirect(`/dashboard/proposals?error=${encodeURIComponent("Enter a valid price.")}`);
  }

  const client = await findOrCreateClient(supabase, userId, clientName);
  if (!client) redirect(`/dashboard/proposals?error=${encodeURIComponent("Could not save client.")}`);

  const number = await nextProposalNumber(supabase, userId);
  const { data: proposal, error: proposalError } = await supabase
    .from("proposals")
    .insert({
      user_id: userId,
      client_id: client.id,
      number,
      proposal_date: proposalDate || new Date().toISOString().slice(0, 10),
      valid_until: validUntil,
      title,
      scope,
      deliverables,
      timeline_start: timelineStart,
      timeline_end: timelineEnd,
      payment_terms: paymentTerms,
      notes,
      status: "draft",
    })
    .select("id")
    .single();

  if (proposalError || !proposal) {
    redirect(`/dashboard/proposals?error=${encodeURIComponent("Could not save proposal.")}`);
  }

  await supabase.from("proposal_line_items").insert({
    user_id: userId,
    proposal_id: proposal.id,
    service_id: serviceId,
    description,
    quantity,
    unit_price: unitPricePence / 100,
    sort_order: 0,
  });

  revalidatePath("/dashboard/proposals");
  redirect("/dashboard/proposals?created=1");
}

export async function setProposalStatus(formData: FormData) {
  const userId = await requireUserId();
  const proposalId = String(formData.get("proposalId") ?? "");
  const status = String(formData.get("status") ?? "");

  if (!["draft", "sent", "accepted", "declined"].includes(status) || !proposalId) {
    redirect(`/dashboard/proposals?error=${encodeURIComponent("Invalid proposal status.")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("proposals")
    .update({
      status,
      accepted_at: status === "accepted" ? new Date().toISOString() : null,
    })
    .eq("id", proposalId)
    .eq("user_id", userId);

  if (error) redirect(`/dashboard/proposals?error=${encodeURIComponent("Could not update proposal.")}`);
  revalidatePath("/dashboard/proposals");
  redirect("/dashboard/proposals?updated=1");
}

export async function convertProposalToInvoice(formData: FormData) {
  const userId = await requireUserId();
  const proposalId = String(formData.get("proposalId") ?? "");

  const supabase = await createClient();
  const { data: proposal } = await supabase
    .from("proposals")
    .select("id, client_id, title, payment_terms, proposal_line_items(description, quantity, unit_price)")
    .eq("id", proposalId)
    .eq("user_id", userId)
    .single();

  if (!proposal) redirect(`/dashboard/proposals?error=${encodeURIComponent("Proposal not found.")}`);

  const items = (proposal.proposal_line_items ?? []) as {
    description: string;
    quantity: number | string;
    unit_price: number | string;
  }[];

  const totalPence = items.reduce(
    (sum, item) => sum + Math.round(Number(item.quantity) * Number(item.unit_price) * 100),
    0
  );

  const description = items.length === 1
    ? items[0].description
    : proposal.title;

  const { count } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  const year = new Date().getFullYear();
  const invoiceNumber = `INV-${year}-${String((count ?? 0) + 1).padStart(4, "0")}`;

  const { error } = await supabase.from("invoices").insert({
    user_id: userId,
    client_id: proposal.client_id,
    number: invoiceNumber,
    invoice_date: new Date().toISOString().slice(0, 10),
    description,
    amount: totalPence / 100,
    payment_terms: proposal.payment_terms,
    status: "draft",
  });

  if (error) redirect(`/dashboard/proposals?error=${encodeURIComponent("Could not create invoice.")}`);
  revalidatePath("/dashboard");
  redirect("/dashboard?proposalConverted=1");
}

async function requireUserId() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user.id;
}

async function findOrCreateClient(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  name: string
) {
  const normalised = normaliseClientName(name);
  const { data: existing } = await supabase.from("clients").select("id, name").eq("user_id", userId);
  const match = existing?.find(
    (c) => normaliseClientName(c.name).toLowerCase() === normalised.toLowerCase()
  );
  if (match) return match;
  const { data } = await supabase
    .from("clients")
    .insert({ user_id: userId, name: normalised })
    .select("id, name")
    .single();
  return data;
}

async function nextProposalNumber(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
) {
  const year = new Date().getFullYear();
  const { count } = await supabase
    .from("proposals")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  return `PRP-${year}-${String((count ?? 0) + 1).padStart(4, "0")}`;
}

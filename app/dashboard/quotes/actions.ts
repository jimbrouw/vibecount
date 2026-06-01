"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { normaliseClientName } from "@/lib/invoices/money";
import { validateQuoteInput, validateServiceInput } from "@/lib/quotes/validation";

export async function createService(formData: FormData) {
  const userId = await requireUserId();
  const parsed = validateServiceInput({
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    unitPrice: String(formData.get("unitPrice") ?? ""),
  });

  if (!parsed.ok) redirect(`/dashboard/quotes?error=${encodeURIComponent(parsed.error)}`);

  const supabase = await createClient();
  const { error } = await supabase.from("services").insert({
    user_id: userId,
    name: parsed.value.name,
    description: parsed.value.description,
    unit_price: parsed.value.unitPricePence / 100,
  });

  if (error) redirect(`/dashboard/quotes?error=${encodeURIComponent("Could not save service.")}`);
  revalidatePath("/dashboard/quotes");
  redirect("/dashboard/quotes?serviceCreated=1");
}

export async function createQuote(formData: FormData) {
  const userId = await requireUserId();
  const parsed = validateQuoteInput({
    clientName: String(formData.get("clientName") ?? ""),
    quoteDate: String(formData.get("quoteDate") ?? ""),
    validUntil: String(formData.get("validUntil") ?? ""),
    description: String(formData.get("description") ?? ""),
    quantity: String(formData.get("quantity") ?? "1"),
    unitPrice: String(formData.get("unitPrice") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    serviceId: String(formData.get("serviceId") ?? ""),
  });

  if (!parsed.ok) redirect(`/dashboard/quotes?error=${encodeURIComponent(parsed.error)}`);

  const supabase = await createClient();
  const client = await findOrCreateClient(supabase, userId, parsed.value.clientName);
  if (!client) redirect(`/dashboard/quotes?error=${encodeURIComponent("Could not save client.")}`);

  const number = await nextQuoteNumber(supabase, userId);
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .insert({
      user_id: userId,
      client_id: client.id,
      number,
      quote_date: parsed.value.quoteDate,
      valid_until: parsed.value.validUntil,
      notes: parsed.value.notes,
      status: "draft",
    })
    .select("id")
    .single();

  if (quoteError || !quote) {
    redirect(`/dashboard/quotes?error=${encodeURIComponent("Could not save quote.")}`);
  }

  const { error: itemError } = await supabase.from("quote_line_items").insert({
    user_id: userId,
    quote_id: quote.id,
    service_id: parsed.value.serviceId,
    description: parsed.value.description,
    quantity: parsed.value.quantity,
    unit_price: parsed.value.unitPricePence / 100,
  });

  if (itemError) {
    redirect(`/dashboard/quotes?error=${encodeURIComponent("Could not save quote item.")}`);
  }

  revalidatePath("/dashboard/quotes");
  redirect("/dashboard/quotes?quoteCreated=1");
}

export async function setQuoteStatus(formData: FormData) {
  const userId = await requireUserId();
  const quoteId = String(formData.get("quoteId") ?? "");
  const status = String(formData.get("status") ?? "");

  if (!["draft", "sent", "accepted", "declined"].includes(status) || !quoteId) {
    redirect(`/dashboard/quotes?error=${encodeURIComponent("Choose a valid quote status.")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("quotes")
    .update({
      status,
      accepted_at: status === "accepted" ? new Date().toISOString() : null,
    })
    .eq("id", quoteId)
    .eq("user_id", userId);

  if (error) redirect(`/dashboard/quotes?error=${encodeURIComponent("Could not update quote.")}`);
  revalidatePath("/dashboard/quotes");
  redirect("/dashboard/quotes?quoteUpdated=1");
}

async function requireUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  return user.id;
}

async function findOrCreateClient(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  name: string
) {
  const normalised = normaliseClientName(name);
  const { data: existing } = await supabase
    .from("clients")
    .select("id, name")
    .eq("user_id", userId);
  const match = existing?.find(
    (client) => normaliseClientName(client.name).toLowerCase() === normalised.toLowerCase()
  );
  if (match) return match;

  const { data } = await supabase
    .from("clients")
    .insert({ user_id: userId, name: normalised })
    .select("id, name")
    .single();
  return data;
}

async function nextQuoteNumber(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
) {
  const year = new Date().getFullYear();
  const { count } = await supabase
    .from("quotes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  return `QT-${year}-${String((count ?? 0) + 1).padStart(4, "0")}`;
}

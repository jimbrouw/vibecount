"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_REMINDER_SCHEDULE,
  firstReminderAt,
  inferDueDate,
  isValidEmail,
} from "@/lib/invoices/reminders";

type InvoiceActionRow = {
  id: string;
  user_id: string;
  client_id: string;
  invoice_date: string;
  payment_terms: string;
  due_date: string | null;
  clients: {
    email: string;
  } | null;
};

export async function markInvoiceSent(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const clientEmail = String(formData.get("clientEmail") ?? "").trim();
  const redirectTo = safeRedirect(String(formData.get("redirectTo") ?? "/dashboard"));

  const invoice = await readOwnedInvoice(supabase, userId, invoiceId);
  if (!invoice) redirect(`${redirectTo}?error=${encodeURIComponent("Could not find invoice.")}`);

  if (clientEmail) {
    const emailResult = await updateClientEmail(supabase, userId, invoice.client_id, clientEmail);
    if (!emailResult.ok) redirect(`${redirectTo}?error=${encodeURIComponent(emailResult.error)}`);
  }

  const dueDate = invoice.due_date ?? inferDueDate(invoice.invoice_date, invoice.payment_terms);
  const { error } = await supabase
    .from("invoices")
    .update({
      delivery_status: "sent",
      sent_at: new Date().toISOString(),
      due_date: dueDate,
    })
    .eq("id", invoiceId)
    .eq("user_id", userId);

  if (error) redirect(`${redirectTo}?error=${encodeURIComponent("Could not mark invoice sent.")}`);
  revalidatePath("/dashboard");
  redirect(`${redirectTo}?invoiceSent=1`);
}

export async function markInvoicePaid(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const redirectTo = safeRedirect(String(formData.get("redirectTo") ?? "/dashboard"));

  const { error } = await supabase
    .from("invoices")
    .update({
      delivery_status: "paid",
      paid_at: new Date().toISOString(),
      reminder_enabled: false,
      next_reminder_at: null,
    })
    .eq("id", invoiceId)
    .eq("user_id", userId);

  if (error) redirect(`${redirectTo}?error=${encodeURIComponent("Could not mark invoice paid.")}`);
  revalidatePath("/dashboard");
  redirect(`${redirectTo}?invoicePaid=1`);
}

export async function enableInvoiceReminders(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const clientEmail = String(formData.get("clientEmail") ?? "").trim();
  const redirectTo = safeRedirect(String(formData.get("redirectTo") ?? "/dashboard"));

  const invoice = await readOwnedInvoice(supabase, userId, invoiceId);
  if (!invoice) redirect(`${redirectTo}?error=${encodeURIComponent("Could not find invoice.")}`);

  const email = clientEmail || invoice.clients?.email || "";
  const emailResult = await updateClientEmail(supabase, userId, invoice.client_id, email);
  if (!emailResult.ok) redirect(`${redirectTo}?error=${encodeURIComponent(emailResult.error)}`);

  const dueDate = invoice.due_date ?? inferDueDate(invoice.invoice_date, invoice.payment_terms);
  const { error } = await supabase
    .from("invoices")
    .update({
      due_date: dueDate,
      reminder_enabled: true,
      reminder_schedule: DEFAULT_REMINDER_SCHEDULE,
      next_reminder_at: firstReminderAt(dueDate),
    })
    .eq("id", invoiceId)
    .eq("user_id", userId)
    .is("paid_at", null);

  if (error) redirect(`${redirectTo}?error=${encodeURIComponent("Could not enable reminders.")}`);
  revalidatePath("/dashboard");
  redirect(`${redirectTo}?remindersEnabled=1`);
}

export async function disableInvoiceReminders(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const redirectTo = safeRedirect(String(formData.get("redirectTo") ?? "/dashboard"));

  const { error } = await supabase
    .from("invoices")
    .update({
      reminder_enabled: false,
      next_reminder_at: null,
    })
    .eq("id", invoiceId)
    .eq("user_id", userId);

  if (error) redirect(`${redirectTo}?error=${encodeURIComponent("Could not disable reminders.")}`);
  revalidatePath("/dashboard");
  redirect(`${redirectTo}?remindersDisabled=1`);
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  return { supabase, userId: user.id };
}

async function readOwnedInvoice(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  invoiceId: string
) {
  if (!invoiceId) return null;

  const { data } = await supabase
    .from("invoices")
    .select("id, user_id, client_id, invoice_date, payment_terms, due_date, clients(email)")
    .eq("id", invoiceId)
    .eq("user_id", userId)
    .maybeSingle();

  return data as InvoiceActionRow | null;
}

async function updateClientEmail(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  clientId: string,
  clientEmail: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!clientEmail) {
    return { ok: false, error: "Add a client email before enabling reminders." };
  }

  if (!isValidEmail(clientEmail)) {
    return { ok: false, error: "Use a valid client email address." };
  }

  const { error } = await supabase
    .from("clients")
    .update({ email: clientEmail })
    .eq("id", clientId)
    .eq("user_id", userId);

  if (error) {
    return { ok: false, error: "Could not save the client email." };
  }

  return { ok: true };
}

function safeRedirect(value: string) {
  return value.startsWith("/dashboard") ? value : "/dashboard";
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_REMINDER_SCHEDULE,
  firstReminderAt,
  inferDueDate,
  isValidEmail,
  nextReminderAtFrom,
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
  redirect(addRedirectParam(redirectTo, "remindersEnabled", "1"));
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

export async function sendApprovedReminder(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const reminderId = String(formData.get("reminderId") ?? "");
  const redirectTo = safeRedirect(String(formData.get("redirectTo") ?? "/dashboard"));

  if (!reminderId) redirect(`${redirectTo}?error=${encodeURIComponent("Missing reminder ID.")}`);

  const { data: reminder } = await supabase
    .from("invoice_reminders")
    .select("id, invoice_id, recipient_email, subject, message, status")
    .eq("id", reminderId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .maybeSingle();

  if (!reminder) redirect(`${redirectTo}?error=${encodeURIComponent("Reminder draft not found or already processed.")}`);

  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!resendKey || !fromEmail) {
    redirect(`${redirectTo}?error=${encodeURIComponent("Email sending is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL to your environment.")}`);
  }

  const resend = new Resend(resendKey);
  const { data: sent, error: sendError } = await resend.emails.send({
    from: fromEmail,
    to: reminder.recipient_email,
    subject: reminder.subject,
    text: reminder.message,
  });

  if (sendError || !sent?.id) {
    await supabase
      .from("invoice_reminders")
      .update({ status: "failed", error: sendError?.message ?? "Unknown send error" })
      .eq("id", reminderId)
      .eq("user_id", userId);
    redirect(`${redirectTo}?error=${encodeURIComponent("Could not send the reminder. Check your email settings.")}`);
  }

  const now = new Date();
  await supabase
    .from("invoice_reminders")
    .update({ status: "sent", sent_at: now.toISOString(), provider_message_id: sent.id })
    .eq("id", reminderId)
    .eq("user_id", userId);

  const { data: inv } = await supabase
    .from("invoices")
    .select("reminder_schedule")
    .eq("id", reminder.invoice_id)
    .eq("user_id", userId)
    .maybeSingle();

  const schedule = inv?.reminder_schedule as { repeatEveryDays?: number } | null;
  const repeatEveryDays = Number(schedule?.repeatEveryDays ?? DEFAULT_REMINDER_SCHEDULE.repeatEveryDays);

  await supabase
    .from("invoices")
    .update({
      reminder_enabled: true,
      next_reminder_at: nextReminderAtFrom(now, repeatEveryDays),
    })
    .eq("id", reminder.invoice_id)
    .eq("user_id", userId);

  revalidatePath("/dashboard");
  redirect(`${redirectTo}?reminderSent=1`);
}

export async function discardReminderDraft(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const reminderId = String(formData.get("reminderId") ?? "");
  const redirectTo = safeRedirect(String(formData.get("redirectTo") ?? "/dashboard"));

  if (!reminderId) redirect(`${redirectTo}?error=${encodeURIComponent("Missing reminder ID.")}`);

  await supabase
    .from("invoice_reminders")
    .delete()
    .eq("id", reminderId)
    .eq("user_id", userId)
    .eq("status", "pending");

  revalidatePath("/dashboard");
  redirect(`${redirectTo}?reminderDiscarded=1`);
}

export async function deleteInvoice(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const redirectTo = safeRedirect(String(formData.get("redirectTo") ?? "/dashboard"));

  if (!invoiceId) redirect(`${redirectTo}?error=${encodeURIComponent("Missing invoice ID.")}`);

  const { error } = await supabase
    .from("invoices")
    .delete()
    .eq("id", invoiceId)
    .eq("user_id", userId);

  if (error) redirect(`${redirectTo}?error=${encodeURIComponent("Could not delete invoice.")}`);

  revalidatePath("/dashboard");
  redirect(`${redirectTo}?invoiceDeleted=1`);
}

function safeRedirect(value: string) {
  return value.startsWith("/dashboard") ? value : "/dashboard";
}

function addRedirectParam(path: string, key: string, value: string) {
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set(key, value);
  return `${pathname}?${params.toString()}`;
}

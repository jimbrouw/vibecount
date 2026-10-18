"use server";

import { isNativeGbpInvoice } from "@/lib/invoices/native";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { deliverClaimedReminder, type ReminderClaim } from "@/lib/invoices/reminder-delivery";
import { createClient } from "@/lib/supabase/server";
import { minorPence } from "@/lib/records/allocations";
import {
  DEFAULT_REMINDER_SCHEDULE,
  firstReminderAt,
  inferDueDate,
  isValidEmail,
} from "@/lib/invoices/reminders";

type InvoiceActionRow = {
  origin: "native_gbp"; currency: "GBP"; amount: string|number;
  id: string;
  user_id: string;
  client_id: string;
  invoice_date: string;
  payment_terms: string;
  due_date: string | null;
  updated_at: string;
  clients: {
    email: string;
  } | null;
};

export async function markInvoiceSent(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const clientEmail = String(formData.get("clientEmail") ?? "").trim();
  const redirectTo = safeRedirect(
    String(formData.get("redirectTo") ?? "/dashboard"),
  );

  const invoice = await readOwnedInvoice(supabase, userId, invoiceId);
  if (!invoice)
    redirect(
      `${redirectTo}?error=${encodeURIComponent("Could not find invoice.")}`,
    );

  if (clientEmail) {
    const emailResult = await updateClientEmail(
      supabase,
      userId,
      invoice.client_id,
      clientEmail,
    );
    if (!emailResult.ok)
      redirect(`${redirectTo}?error=${encodeURIComponent(emailResult.error)}`);
  }

  const dueDate =
    invoice.due_date ??
    inferDueDate(invoice.invoice_date, invoice.payment_terms);
  const { error } = await supabase
    .from("invoices")
    .update({
      delivery_status: "sent",
      sent_at: new Date().toISOString(),
      due_date: dueDate,
    })
    .eq("id", invoiceId)
    .eq("user_id", userId);

  if (error)
    redirect(
      `${redirectTo}?error=${encodeURIComponent("Could not mark invoice sent.")}`,
    );
  revalidatePath("/dashboard");
  redirect(`${redirectTo}?invoiceSent=1`);
}

export async function markInvoicePaid(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const redirectTo = safeRedirect(
    String(formData.get("redirectTo") ?? "/dashboard"),
  );

  if (!await readOwnedInvoice(supabase,userId,invoiceId)) redirect(`${redirectTo}?error=${encodeURIComponent("Use the native GBP invoice workflow only for an owned native invoice.")}`);

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

  if (error)
    redirect(
      `${redirectTo}?error=${encodeURIComponent("Could not mark invoice paid.")}`,
    );
  revalidatePath("/dashboard");
  redirect(`${redirectTo}?invoicePaid=1`);
}

export async function enableInvoiceReminders(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const clientEmail = String(formData.get("clientEmail") ?? "").trim();
  const redirectTo = safeRedirect(
    String(formData.get("redirectTo") ?? "/dashboard"),
  );

  const invoice = await readOwnedInvoice(supabase, userId, invoiceId);
  if (!invoice)
    redirect(
      `${redirectTo}?error=${encodeURIComponent("Could not find invoice.")}`,
    );

  const { data: balance, error: balanceError } = await supabase
    .from("invoice_payment_balances")
    .select("updated_at,outstanding_pence,has_credit_history,currency,status")
    .eq("id", invoiceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (
    balanceError ||
    !balance ||
    balance.updated_at !== invoice.updated_at ||
    balance.currency !== "GBP" ||
    balance.status !== "finalised" ||
    minorPence(balance.outstanding_pence) <= 0 ||
    balance.has_credit_history
  )
    redirect(
      `${redirectTo}?error=${encodeURIComponent("Review the current invoice balance. Credit history requires a fresh communication review before scheduling.")}`,
    );

  const email = clientEmail || invoice.clients?.email || "";
  const emailResult = await updateClientEmail(
    supabase,
    userId,
    invoice.client_id,
    email,
  );
  if (!emailResult.ok)
    redirect(`${redirectTo}?error=${encodeURIComponent(emailResult.error)}`);

  const dueDate =
    invoice.due_date ??
    inferDueDate(invoice.invoice_date, invoice.payment_terms);
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
    .eq("updated_at", balance.updated_at)
    .is("paid_at", null);

  if (error)
    redirect(
      `${redirectTo}?error=${encodeURIComponent("Could not enable reminders.")}`,
    );
  revalidatePath("/dashboard");
  redirect(addRedirectParam(redirectTo, "remindersEnabled", "1"));
}

export async function disableInvoiceReminders(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const redirectTo = safeRedirect(
    String(formData.get("redirectTo") ?? "/dashboard"),
  );

  if (!await readOwnedInvoice(supabase,userId,invoiceId)) redirect(`${redirectTo}?error=${encodeURIComponent("Use the native GBP invoice workflow only for an owned native invoice.")}`);

  const { error } = await supabase
    .from("invoices")
    .update({
      reminder_enabled: false,
      next_reminder_at: null,
    })
    .eq("id", invoiceId)
    .eq("user_id", userId);

  if (error)
    redirect(
      `${redirectTo}?error=${encodeURIComponent("Could not disable reminders.")}`,
    );
  revalidatePath("/dashboard");
  redirect(`${redirectTo}?remindersDisabled=1`);
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user }, error,
  } = await supabase.auth.getUser();

  if (error || !user) redirect("/login");
  return { supabase, userId: user.id };
}

async function readOwnedInvoice(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  invoiceId: string,
) {
  if (!invoiceId) return null;

  const { data, error } = await supabase
    .from("invoices")
    .select(
      "id, user_id, client_id, invoice_date, payment_terms, due_date, updated_at, origin, currency, amount, clients(email)",
    )
    .eq("id", invoiceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !isNativeGbpInvoice(data) || typeof data.id!=="string" || typeof data.user_id!=="string" || data.id.toLowerCase()!==invoiceId.toLowerCase() || data.user_id.toLowerCase()!==userId.toLowerCase()) return null;
  const client=Array.isArray(data.clients)?data.clients[0]??null:data.clients;
  return {...data,clients:client} satisfies InvoiceActionRow;
}

async function updateClientEmail(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  clientId: string,
  clientEmail: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!clientEmail) {
    return {
      ok: false,
      error: "Add a client email before enabling reminders.",
    };
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
  const { userId } = await requireUser();
  const reminderId = String(formData.get("reminderId") ?? "");
  const redirectTo = safeRedirect(String(formData.get("redirectTo") ?? "/dashboard"));
  const fail = (message:string):never => redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
  if (formData.get("humanConfirmed") !== "yes") fail("Confirm the displayed recipient and message before sending.");
  const admin = createAdminClient();
  const key = process.env.RESEND_API_KEY;
  if (!admin || !key) return fail("Email sending is not configured.");
  const {data,error} = await admin.rpc("claim_reminder_send", {
    p_owner:userId,p_reminder:reminderId,
    p_updated_at:String(formData.get("reviewedAt") ?? ""),p_confirmed:true,
  });
  if(error || !data) fail("Reminder changed or is unavailable. Review a fresh draft before sending.");
  const resend = new Resend(key);
  const outcome = await deliverClaimedReminder(data as ReminderClaim, {
    async send(payload,providerKey,attemptId) {
      const {data,error}=await resend.emails.send({...payload,tags:[{name:"vibecount_attempt",value:attemptId}]},{idempotencyKey:providerKey});
      return {id:error ? null : data?.id};
    },
    async record(attempt,outcome,providerId) {
      const {error}=await admin.rpc("record_reminder_outcome",{p_owner:userId,p_attempt:attempt,p_outcome:outcome,p_provider_id:providerId});
      if(error)throw new Error("Outcome storage unavailable.");
    },
  });
  revalidatePath("/dashboard");
  if(outcome==='unknown')fail("Delivery outcome needs checking. Do not resend; the provider may have accepted this message.");
  if(outcome==='already_processed')fail("This reminder already has a send attempt. Check its delivery status.");
  redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}reminderSent=1`);
}

export async function discardReminderDraft(formData: FormData) {
  const { supabase } = await requireUser();
  const redirectTo = safeRedirect(String(formData.get("redirectTo") ?? "/dashboard"));
  const {error}=await supabase.rpc("discard_reminder",{p_reminder:String(formData.get("reminderId") ?? "")});
  revalidatePath("/dashboard");
  redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}${error ? "error=Pending%20reminder%20unavailable." : "reminderDiscarded=1"}`);
}

export async function deleteInvoice(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const redirectTo = safeRedirect(
    String(formData.get("redirectTo") ?? "/dashboard"),
  );

  if (!invoiceId)
    redirect(
      `${redirectTo}?error=${encodeURIComponent("Missing invoice ID.")}`,
    );

  if (!await readOwnedInvoice(supabase,userId,invoiceId)) redirect(`${redirectTo}?error=${encodeURIComponent("Use the native GBP invoice workflow only for an owned native invoice.")}`);

  const { error } = await supabase
    .from("invoices")
    .delete()
    .eq("id", invoiceId)
    .eq("user_id", userId);

  if (error)
    redirect(
      `${redirectTo}?error=${encodeURIComponent("Could not delete invoice.")}`,
    );

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

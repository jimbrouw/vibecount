import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildReminderEmail,
  parseReminderSchedule,
} from "@/lib/invoices/reminders";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return POST(request);
}

type DueInvoiceRow = {
  id: string;
  user_id: string;
  client_id: string;
  number: string;
  amount: number | string;
  invoice_date: string;
  due_date: string;
  payment_terms: string;
  reminder_schedule: unknown;
  clients:
    | {
        name: string;
        email: string;
      }
    | {
        name: string;
        email: string;
      }[]
    | null;
};

type ReminderSettings = {
  legal_name: string;
  payment_link_url: string;
};

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createAdminClient();
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!supabase || !fromEmail) {
    return NextResponse.json(
      { error: "Reminder draft environment is not configured." },
      { status: 500 }
    );
  }

  const now = new Date();
  const { data: invoices, error } = await supabase
    .from("invoices")
    .select(
      "id, user_id, client_id, number, amount, invoice_date, due_date, payment_terms, reminder_schedule, clients(name, email)"
    )
    .eq("status", "finalised")
    .eq("reminder_enabled", true)
    .is("paid_at", null)
    .not("due_date", "is", null)
    .lte("next_reminder_at", now.toISOString())
    .limit(50);

  if (error) {
    return NextResponse.json({ error: "Could not read due reminders." }, { status: 500 });
  }

  const results = {
    checked: invoices?.length ?? 0,
    drafted: 0,
    failed: 0,
    skipped: 0,
  };

  for (const invoice of (invoices ?? []) as DueInvoiceRow[]) {
    const schedule = parseReminderSchedule(invoice.reminder_schedule);
    const sentCount = await readSentReminderCount(supabase, invoice.id);
    const client = joinedClient(invoice.clients);

    if (sentCount >= schedule.maxReminders) {
      await supabase
        .from("invoices")
        .update({ reminder_enabled: false, next_reminder_at: null })
        .eq("id", invoice.id)
        .eq("user_id", invoice.user_id);
      results.skipped += 1;
      continue;
    }

    const recipient = client?.email?.trim() ?? "";
    if (!recipient) {
      await insertReminderAudit(supabase, invoice, {
        recipientEmail: "",
        subject: `Payment reminder for invoice ${invoice.number}`,
        message: "Skipped because the client has no email address.",
        status: "skipped",
        error: "Missing client email.",
      });
      await supabase
        .from("invoices")
        .update({ reminder_enabled: false, next_reminder_at: null })
        .eq("id", invoice.id)
        .eq("user_id", invoice.user_id);
      results.skipped += 1;
      continue;
    }

    const settings = await readReminderSettings(supabase, invoice.user_id);
    const email = buildReminderEmail({
      invoice: {
        number: invoice.number,
        amountPence: Math.round(Number(invoice.amount) * 100),
        invoiceDate: invoice.invoice_date,
        dueDate: invoice.due_date,
        paymentTerms: invoice.payment_terms,
        paymentLinkUrl: settings.payment_link_url,
      },
      client: {
        name: client?.name ?? "there",
        email: recipient,
      },
      sender: {
        name: settings.legal_name,
        email: fromEmail,
      },
      reminderCount: sentCount + 1,
    });

    await insertReminderAudit(supabase, invoice, {
      recipientEmail: recipient,
      subject: email.subject,
      message: email.text,
      status: "pending",
    });

    await supabase
      .from("invoices")
      .update({
        reminder_enabled: false,
        next_reminder_at: null,
      })
      .eq("id", invoice.id)
      .eq("user_id", invoice.user_id);

    results.drafted += 1;
  }

  return NextResponse.json({ ok: true, ...results });
}

function joinedClient(value: DueInvoiceRow["clients"]) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

async function readReminderSettings(
  supabase: NonNullable<ReturnType<typeof createAdminClient>>,
  userId: string
): Promise<ReminderSettings> {
  const { data } = await supabase
    .from("user_settings")
    .select("legal_name, payment_link_url")
    .eq("id", userId)
    .maybeSingle();

  return {
    legal_name: String(data?.legal_name ?? ""),
    payment_link_url: String(data?.payment_link_url ?? ""),
  };
}

async function readSentReminderCount(
  supabase: NonNullable<ReturnType<typeof createAdminClient>>,
  invoiceId: string
) {
  const { count } = await supabase
    .from("invoice_reminders")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", invoiceId)
    .eq("status", "sent");

  return count ?? 0;
}

async function insertReminderAudit(
  supabase: NonNullable<ReturnType<typeof createAdminClient>>,
  invoice: DueInvoiceRow,
  input: {
    recipientEmail: string;
    subject: string;
    message: string;
    status: "pending" | "sent" | "failed" | "skipped";
    error?: string;
  }
) {
  const { data, error } = await supabase
    .from("invoice_reminders")
    .insert({
      user_id: invoice.user_id,
      invoice_id: invoice.id,
      client_id: invoice.client_id,
      recipient_email: input.recipientEmail || "missing@example.invalid",
      subject: input.subject,
      message: input.message,
      status: input.status,
      error: input.error ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error("Could not write reminder audit row.");
  }

  return data as { id: string };
}

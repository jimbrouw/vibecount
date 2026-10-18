import { isNativeGbpInvoice } from "@/lib/invoices/native";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { minorPence } from "@/lib/records/allocations";
import {
  buildReminderEmail,
  parseReminderSchedule,
} from "@/lib/invoices/reminders";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return POST(request);
}

type DueInvoiceRow = {
  origin: string; currency: string;
  id: string;
  user_id: string;
  client_id: string;
  number: string;
  amount: number | string;
  invoice_date: string;
  due_date: string;
  payment_terms: string;
  reminder_schedule: unknown;
  updated_at: string;
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
      { status: 500 },
    );
  }

  const now = new Date();
  const { data: invoices, error } = await supabase
    .from("invoices")
    .select(
      "id, user_id, client_id, number, amount, origin, currency, invoice_date, due_date, payment_terms, reminder_schedule, updated_at, clients(name, email)",
    )
    .eq("status", "finalised")
    .eq("reminder_enabled", true)
    .is("paid_at", null)
    .not("due_date", "is", null)
    .lte("next_reminder_at", now.toISOString())
    .limit(50);

  if (error) {
    return NextResponse.json(
      { error: "Could not read due reminders." },
      { status: 500 },
    );
  }

  const results = {
    checked: invoices?.length ?? 0,
    drafted: 0,
    failed: 0,
    skipped: 0,
  };

  for (const invoice of (invoices ?? []) as DueInvoiceRow[]) {
    if (!isNativeGbpInvoice(invoice)) {results.failed++;continue;}
    const { data: balance, error: balanceError } = await supabase
      .from("invoice_payment_balances")
      .select("updated_at,outstanding_pence,credited_pence,currency")
      .eq("id", invoice.id)
      .eq("user_id", invoice.user_id)
      .maybeSingle();
    if (
      balanceError ||
      !balance ||
      balance.currency !== "GBP" ||
      balance.updated_at !== invoice.updated_at
    ) {
      results.failed++;
      continue;
    }
    const duePence = minorPence(balance.outstanding_pence);
    if (duePence <= 0 || minorPence(balance.credited_pence) > 0) {
      results.skipped++;
      continue;
    }
    const schedule = parseReminderSchedule(invoice.reminder_schedule);
    const sentCount = await readSentReminderCount(supabase, invoice.id);
    const client = joinedClient(invoice.clients);

    if (sentCount >= schedule.maxReminders) {
      await supabase
        .from("invoices")
        .update({ reminder_enabled: false, next_reminder_at: null })
        .eq("id", invoice.id)
        .eq("user_id", invoice.user_id)
        .eq("updated_at", invoice.updated_at);
      results.skipped += 1;
      continue;
    }

    const recipient = client?.email?.trim() ?? "";
    if (!recipient) {
      results.failed++;
      continue;
    }

    const settings = await readReminderSettings(supabase, invoice.user_id);
    const email = buildReminderEmail({
      invoice: {
        number: invoice.number,
        amountPence: duePence,
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

    const { error: draftError } = await supabase.rpc("create_due_reminder", {
      p_owner:invoice.user_id,p_invoice:invoice.id,p_updated_at:balance.updated_at,
      p_amount:duePence,p_from:fromEmail,p_recipient:recipient,
      p_subject:email.subject,p_message:email.text,
    });
    if (draftError) { results.failed++; continue; }

    results.drafted += 1;
  }

  return NextResponse.json({ ok: true, ...results });
}

function joinedClient(value: DueInvoiceRow["clients"]) {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function readReminderSettings(
  supabase: NonNullable<ReturnType<typeof createAdminClient>>,
  userId: string,
): Promise<ReminderSettings> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("legal_name, payment_link_url")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error("Reminder settings unavailable.");

  return {
    legal_name: String(data?.legal_name ?? ""),
    payment_link_url: String(data?.payment_link_url ?? ""),
  };
}

async function readSentReminderCount(
  supabase: NonNullable<ReturnType<typeof createAdminClient>>,
  invoiceId: string,
) {
  const { count, error } = await supabase
    .from("invoice_reminders")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", invoiceId)
    .eq("status", "sent");
  if (error || count === null) throw new Error("Reminder history unavailable.");

  return count ?? 0;
}

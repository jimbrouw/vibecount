import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { amountToWords, formatPounds } from "@/lib/invoices/money";
import { calculateLateInterest } from "@/lib/invoices/interest";
import {
  disableInvoiceReminders,
  discardReminderDraft,
  enableInvoiceReminders,
  markInvoicePaid,
  markInvoiceSent,
  sendApprovedReminder,
} from "@/app/dashboard/invoices/actions";
import LogoutButton from "./LogoutButton";
import PlainLanguageNote from "./PlainLanguageNote";
import EmailInvoiceButton from "./EmailInvoiceButton";
import ChaseInvoiceButton from "./ChaseInvoiceButton";
import DeleteInvoiceButton from "./DeleteInvoiceButton";

export const metadata = {
  title: "Dashboard — VibeCount",
  description: "Create invoices, browse your glossary, and manage your freelancer settings.",
};

type DashboardInvoice = {
  id: string;
  number: string;
  invoice_date: string;
  due_date: string | null;
  amount: number | string;
  payment_terms: string;
  status: string;
  delivery_status: string;
  sent_at: string | null;
  paid_at: string | null;
  reminder_enabled: boolean;
  next_reminder_at: string | null;
  pdf_path: string | null;
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

type ReminderDraft = {
  id: string;
  invoice_id: string;
  recipient_email: string;
  subject: string;
  message: string;
  status: string;
  created_at: string;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Check if settings exist to decide onboarding state
  const { data: settingsRow } = await supabase
    .from("user_settings")
    .select("legal_name, payment_link_url, tax_pot_percentage, statutory_interest_rate")
    .eq("id", user.id)
    .maybeSingle();

  const needsOnboarding = !settingsRow?.legal_name;

  const resolvedSearchParams = await searchParams;
  const flash = flashMessage(resolvedSearchParams);

  const [
    { data: recentInvoices },
    { data: reminderDrafts },
    { data: readinessCheck },
    { data: allInvoices },
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id, number, invoice_date, due_date, amount, payment_terms, status, delivery_status, sent_at, paid_at, reminder_enabled, next_reminder_at, pdf_path, clients(name, email)"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("invoice_reminders")
      .select("id, invoice_id, recipient_email, subject, message, status, created_at")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("quarterly_readiness_checks")
      .select("status, notes, tax_quarter")
      .eq("user_id", user.id)
      .eq("status", "needs_attention")
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("invoices")
      .select("amount, paid_at, status, delivery_status")
      .eq("user_id", user.id),
  ]);

  let totalInvoiced = 0;
  let totalPaid = 0;
  let totalOutstanding = 0;

  (allInvoices || []).forEach((inv) => {
    if (inv.status !== "draft") {
      const amount = Math.round(Number(inv.amount) * 100);
      totalInvoiced += amount;
      if (inv.paid_at || inv.delivery_status === "paid") {
        totalPaid += amount;
      } else {
        totalOutstanding += amount;
      }
    }
  });

  const taxPotPercentage = settingsRow?.tax_pot_percentage ?? 27.00;
  const taxPotEstimate = Math.round(totalPaid * (taxPotPercentage / 100));
  const statutoryInterestRate = settingsRow?.statutory_interest_rate ?? 13.25;

  const rawInvoices = (recentInvoices ?? []) as unknown as DashboardInvoice[];
  const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;
  const invoices = await Promise.all(
    rawInvoices.map(async (inv) => {
      let pdfShareUrl = "";
      if (inv.pdf_path) {
        const { data } = await supabase.storage
          .from("invoices")
          .createSignedUrl(inv.pdf_path, THIRTY_DAYS_SECONDS);
        pdfShareUrl = data?.signedUrl ?? "";
      }
      return {
        ...inv,
        pdfShareUrl,
      };
    })
  );
  const reminders = (reminderDrafts ?? []) as ReminderDraft[];
  const showReminderHelp =
    Boolean(resolvedSearchParams.reminders) ||
    Boolean(resolvedSearchParams.remindersEnabled) ||
    reminders.length > 0;

  return (
    <main className="min-h-screen bg-[#f0fdf4]">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#15803d] bg-[#15803d] px-6 py-4 sm:px-8">
        <div className="flex items-center gap-6">
          <span className="text-lg font-semibold text-white">VibeCount</span>
          <nav className="hidden items-center gap-1 sm:flex">
            <Link
              href="/dashboard"
              className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium text-white"
            >
              Invoices
            </Link>
            <Link
              href="/dashboard/records"
              className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              Records
            </Link>
            <Link
              href="/dashboard/quotes"
              className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              Quotes
            </Link>
            <Link
              href="/dashboard/proposals"
              className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              Proposals
            </Link>
            <Link
              href="/dashboard/contracts"
              className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              Contracts
            </Link>
            <Link
              href="/dashboard/projects"
              className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              Projects
            </Link>
            <Link
              href="/dashboard/invoices/repeating"
              className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              Repeating
            </Link>
            <Link
              href="/dashboard/tax-prep"
              className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              Tax prep
            </Link>
            <Link
              href="/dashboard/review"
              className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              Review
            </Link>
            <Link
              href="/dashboard/glossary"
              className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              Explain Simply
            </Link>
            <Link
              href="/dashboard/settings"
              className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              Settings
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-white/80 sm:block">{user.email}</span>
          <LogoutButton />
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
        {/* Onboarding banner */}
        {needsOnboarding && (
          <div className="mb-6 flex items-start gap-4 rounded-xl border border-[#86efac] bg-[#dcfce7] p-5">
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#15803d]/10">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="#15803d" strokeWidth="1.5" />
                <line
                  x1="8"
                  y1="5"
                  x2="8"
                  y2="8.5"
                  stroke="#15803d"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <circle cx="8" cy="11" r="0.75" fill="#15803d" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-[#14532d]">
                Add your details for professional invoices
              </p>
              <p className="mt-0.5 text-xs leading-5 text-[#166534]">
                Set your trading name, address, bank details, and VAT info. They
                auto-fill onto every PDF you create.
              </p>
              <Link
                href="/dashboard/settings"
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#15803d] underline decoration-[#86efac] underline-offset-2 transition hover:text-[#14532d]"
              >
                Set up now
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M2 6h8M7 3l3 3-3 3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
              <Link
                href="/dashboard/settings#pdf-branding"
                data-testid="dashboard-pdf-branding-setup-link"
                className="ml-4 mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#15803d] underline decoration-[#86efac] underline-offset-2 transition hover:text-[#14532d]"
              >
                Make PDFs look like your brand
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M2 6h8M7 3l3 3-3 3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
            </div>
          </div>
        )}

        {readinessCheck && (
          <div className="mb-6 flex items-start gap-4 rounded-xl border border-[#fef08a] bg-[#fefce8] p-5" data-testid="readiness-alert-banner">
            <div className="flex-1">
              <p className="text-sm font-medium text-[#713f12]">
                Quarter {readinessCheck.tax_quarter} records need attention
              </p>
              <p className="mt-0.5 text-xs text-[#854d0e]">{readinessCheck.notes}</p>
              <Link
                href="/dashboard/review"
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#713f12] underline underline-offset-2"
              >
                Review now
              </Link>
            </div>
          </div>
        )}

        {/* Home totals */}
        <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-[#bbf7d0] bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
              Total Invoiced
            </p>
            <p className="mt-2 text-xl font-semibold text-[#14532d]">
              {formatPounds(totalInvoiced)}
            </p>
          </div>
          <div className="rounded-xl border border-[#bbf7d0] bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
              Total Paid
            </p>
            <p className="mt-2 text-xl font-semibold text-[#14532d]">
              {formatPounds(totalPaid)}
            </p>
          </div>
          <div className="rounded-xl border border-[#bbf7d0] bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
              Outstanding
            </p>
            <p className="mt-2 text-xl font-semibold text-[#14532d]">
              {formatPounds(totalOutstanding)}
            </p>
          </div>
          <div className="rounded-xl border border-[#dcfce7] bg-[#f7fef9] p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
              Tax Pot Nudge
            </p>
            <p className="mt-2 text-xl font-semibold text-[#14532d]">
              {formatPounds(taxPotEstimate)}
            </p>
            <p className="mt-1 text-xs text-[#4b8068]">
              {taxPotPercentage}% of paid invoices
            </p>
          </div>
        </section>

        {/* Hero action */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#14532d]">
              Invoices
            </h1>
            <p className="mt-1 text-sm text-[#166534]">
              Draft an invoice, check it, then download the PDF.
            </p>
            <div className="mt-3 max-w-xl">
              <PlainLanguageNote>
                This page shows your recent invoices. Each amount is shown in numbers
                and words so it is easier to check before you send anything.
              </PlainLanguageNote>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/dashboard/invoices/voice"
              data-testid="dashboard-voice-invoice-link"
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#bbf7d0] bg-white px-5 text-sm font-semibold text-[#14532d] transition hover:bg-[#f0fdf4]"
            >
              Voice invoice
            </Link>
            <Link
              href="/dashboard/invoices/new"
              data-testid="dashboard-new-invoice-link"
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#15803d] px-5 text-sm font-semibold text-white transition hover:bg-[#14532d]"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <line
                  x1="7"
                  y1="1"
                  x2="7"
                  y2="13"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <line
                  x1="1"
                  y1="7"
                  x2="13"
                  y2="7"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              New invoice
            </Link>
          </div>
        </div>

        {flash ? (
          <p
            className={`mb-5 rounded-lg border px-4 py-3 text-sm ${
              flash.kind === "error"
                ? "border-[#e0b4a7] bg-[#fff7f3] text-[#7a271a]"
                : "border-[#86efac] bg-[#dcfce7] text-[#14532d]"
            }`}
          >
            {flash.text}
          </p>
        ) : null}

        {showReminderHelp ? (
          <section
            id="payment-reminders"
            className="mb-6 rounded-xl border border-[#fef9c3] bg-white p-5 shadow-sm"
            data-testid="payment-reminders-section"
          >
            <h2 className="text-base font-semibold text-[#713f12]">
              Payment reminders
            </h2>
            <p className="mt-1 text-sm leading-6 text-[#854d0e]">
              Scheduling reminders does not email the client now. VibeCount creates a
              draft when a reminder becomes due, then you review and press Send reminder.
            </p>
            {reminders.length > 0 ? (
              <div className="mt-4 space-y-3">
                {reminders.map((reminder) => (
                  <div key={reminder.id} className="rounded-lg border border-[#fef08a] bg-[#fefce8] p-4" data-testid={`pending-reminder-${reminder.id}`}>
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-[#713f12]">{reminder.subject}</p>
                        <p className="mt-1 text-xs text-[#854d0e]">
                          To: {reminder.recipient_email} · Drafted {formatDateTime(reminder.created_at)}
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-[#713f12]">
                      {reminder.message}
                    </p>
                    <div className="mt-4 flex gap-2">
                      <form action={sendApprovedReminder} data-testid={`send-reminder-form-${reminder.id}`}>
                        <input type="hidden" name="reminderId" value={reminder.id} />
                        <input type="hidden" name="redirectTo" value="/dashboard?reminders=1" />
                        <button
                          type="submit"
                          data-testid={`send-reminder-button-${reminder.id}`}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#15803d] px-4 text-xs font-semibold text-white transition hover:bg-[#14532d]"
                        >
                          Send reminder
                        </button>
                      </form>
                      <form action={discardReminderDraft} data-testid={`discard-reminder-form-${reminder.id}`}>
                        <input type="hidden" name="reminderId" value={reminder.id} />
                        <input type="hidden" name="redirectTo" value="/dashboard?reminders=1" />
                        <button
                          type="submit"
                          data-testid={`discard-reminder-button-${reminder.id}`}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#fef08a] bg-white px-4 text-xs font-semibold text-[#713f12] transition hover:bg-[#fefce8]"
                        >
                          Discard
                        </button>
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-lg border border-[#fef08a] bg-[#fefce8] px-4 py-3 text-sm leading-6 text-[#713f12]">
                No reminder drafts need approval yet. Scheduled invoices show a “Next reminder
                draft” date below; when that date arrives, a draft will appear here for you to send
                or discard.
              </p>
            )}
          </section>
        ) : null}

        {/* Recent invoices */}
        {recentInvoices && recentInvoices.length > 0 ? (
          <div className="rounded-xl border border-[#bbf7d0] bg-white shadow-sm">
            <div className="border-b border-[#f0fdf4] px-5 py-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
                Recent
              </p>
            </div>
            <ul>
              {invoices.map((inv, idx) => {
                const client = dashboardClient(inv.clients);
                const amountPence = Math.round(Number(inv.amount) * 100);
                const lateInterest = (!inv.paid_at && inv.due_date) ? calculateLateInterest(amountPence, inv.due_date, statutoryInterestRate) : null;
                return (
                <li
                  key={inv.id}
                  className={`px-5 py-4 ${
                    idx < recentInvoices.length - 1
                      ? "border-b border-[#f0fdf4]"
                      : ""
                  }`}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="text-sm font-medium text-[#14532d]">{inv.number}</p>
                      <p className="mt-0.5 text-xs text-[#4b8068]">
                        {client?.name ?? "Client"} · Invoice {formatDate(inv.invoice_date)}
                        {inv.due_date ? ` · Due ${formatDate(inv.due_date)}` : ""}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <StatusPill invoice={inv} />
                        {inv.reminder_enabled ? (
                          <span className="rounded-full bg-[#fef9c3] px-2 py-0.5 text-xs font-medium text-[#854d0e]">
                            Next reminder draft {inv.next_reminder_at ? formatDateTime(inv.next_reminder_at) : "on"}
                          </span>
                        ) : null}
                        {lateInterest ? (
                          <span className="rounded-full bg-[#fee2e2] px-2 py-0.5 text-xs font-medium text-[#991b1b]">
                            {lateInterest.daysOverdue} days overdue · {formatPounds(lateInterest.totalLateFeePence)} fee
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="lg:text-right">
                      <p className="text-sm font-semibold text-[#14532d]">
                        {formatPounds(amountPence)}
                      </p>
                      <p className="mt-0.5 text-xs text-[#4b8068]">
                        {amountToWords(amountPence)}
                      </p>
                      {lateInterest ? (
                        <p className="mt-1 text-xs text-[#991b1b] font-medium">
                          + {formatPounds(lateInterest.totalLateFeePence)} statutory interest & fee
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <a
                      href={`/api/invoices/download?id=${inv.id}`}
                      data-testid={`dashboard-invoice-download-${inv.id}`}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#bbf7d0] bg-white px-3 text-xs font-semibold text-[#14532d] transition hover:bg-[#f0fdf4]"
                    >
                      Download PDF
                    </a>
                    <EmailInvoiceButton
                      invoiceId={inv.id}
                      invoiceNumber={inv.number}
                      clientName={dashboardClient(inv.clients)?.name ?? ""}
                      clientEmail={dashboardClient(inv.clients)?.email ?? ""}
                      amountPence={Math.round(Number(inv.amount) * 100)}
                      dueDate={inv.due_date}
                      paymentTerms={inv.payment_terms}
                      senderName={settingsRow?.legal_name ?? ""}
                      paymentLinkUrl={settingsRow?.payment_link_url ?? ""}
                      hasPdf
                      pdfShareUrl={(inv as any).pdfShareUrl}
                    />
                    {lateInterest && lateInterest.daysOverdue > 0 && (
                      <ChaseInvoiceButton
                        invoiceId={inv.id}
                        invoiceNumber={inv.number}
                        clientName={dashboardClient(inv.clients)?.name ?? ""}
                        clientEmail={dashboardClient(inv.clients)?.email ?? ""}
                        amountPence={Math.round(Number(inv.amount) * 100)}
                        dueDate={inv.due_date}
                        paymentTerms={inv.payment_terms}
                        senderName={settingsRow?.legal_name ?? ""}
                        paymentLinkUrl={settingsRow?.payment_link_url ?? ""}
                        hasPdf
                        pdfShareUrl={(inv as any).pdfShareUrl}
                        daysOverdue={lateInterest.daysOverdue}
                        lateFeePence={lateInterest.totalLateFeePence}
                      />
                    )}
                    <Link
                      href={`/dashboard/invoices/edit?id=${inv.id}`}
                      data-testid={`dashboard-invoice-edit-${inv.id}`}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#bbf7d0] bg-white px-3 text-xs font-semibold text-[#14532d] transition hover:bg-[#f0fdf4]"
                    >
                      Edit
                    </Link>
                    <DeleteInvoiceButton invoiceId={inv.id} />
                  </div>

                  {inv.status === "finalised" ? (
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {!inv.sent_at && !inv.paid_at ? (
                        <form action={markInvoiceSent} className="flex gap-2" data-testid={`dashboard-invoice-mark-sent-form-${inv.id}`}>
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <input type="hidden" name="redirectTo" value="/dashboard?reminders=1" />
                          <input
                            name="clientEmail"
                            data-testid={`dashboard-invoice-client-email-input-${inv.id}`}
                            type="email"
                            defaultValue={client?.email ?? ""}
                            placeholder="client@example.com"
                            className="min-w-0 flex-1 rounded-lg border border-[#bbf7d0] px-3 text-xs text-[#14532d] outline-none focus:border-[#15803d]"
                          />
                          <button data-testid={`dashboard-invoice-mark-sent-button-${inv.id}`} className={smallButtonCls}>Sent</button>
                        </form>
                      ) : null}

                      {!inv.paid_at ? (
                        <form action={markInvoicePaid} data-testid={`dashboard-invoice-mark-paid-form-${inv.id}`}>
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <input type="hidden" name="redirectTo" value="/dashboard" />
                          <button data-testid={`dashboard-invoice-mark-paid-button-${inv.id}`} className={smallButtonCls}>Mark paid</button>
                        </form>
                      ) : null}

                      {!inv.paid_at && !inv.reminder_enabled ? (
                        <form action={enableInvoiceReminders} className="flex gap-2" data-testid={`dashboard-invoice-enable-reminders-form-${inv.id}`}>
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <input type="hidden" name="redirectTo" value="/dashboard" />
                          <input
                            name="clientEmail"
                            data-testid={`dashboard-invoice-reminder-email-input-${inv.id}`}
                            type="email"
                            defaultValue={client?.email ?? ""}
                            placeholder="client@example.com"
                            className="min-w-0 flex-1 rounded-lg border border-[#bbf7d0] px-3 text-xs text-[#14532d] outline-none focus:border-[#15803d]"
                          />
                          <button data-testid={`dashboard-invoice-enable-reminders-button-${inv.id}`} className={smallOutlineButtonCls}>Schedule reminders</button>
                        </form>
                      ) : null}

                      {inv.reminder_enabled ? (
                        <form action={disableInvoiceReminders} data-testid={`dashboard-invoice-disable-reminders-form-${inv.id}`}>
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <input type="hidden" name="redirectTo" value="/dashboard" />
                          <button data-testid={`dashboard-invoice-disable-reminders-button-${inv.id}`} className={smallOutlineButtonCls}>Stop reminders</button>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div
            className="rounded-xl border border-dashed border-[#bbf7d0] bg-white p-6 sm:p-8"
            data-testid="dashboard-first-run-empty-state"
          >
            <div className="mx-auto max-w-xl">
              <p className="text-base font-semibold text-[#14532d]">
                Start with one small invoice
              </p>
              <p className="mt-2 text-sm leading-6 text-[#4b8068]">
                You do not need to set up everything first. Add your details,
                create a draft, then check the figures and words before you
                download or send anything.
              </p>
              <ol className="mt-5 grid gap-3 text-sm text-[#14532d] sm:grid-cols-3">
                <li className="rounded-lg border border-[#bbf7d0] bg-[#f7fef9] p-4">
                  <span className="block text-xs font-semibold uppercase tracking-widest text-[#166534]">
                    Step 1
                  </span>
                  <span className="mt-1 block">Add your invoice details.</span>
                </li>
                <li className="rounded-lg border border-[#bbf7d0] bg-[#f7fef9] p-4">
                  <span className="block text-xs font-semibold uppercase tracking-widest text-[#166534]">
                    Step 2
                  </span>
                  <span className="mt-1 block">Create a draft invoice.</span>
                </li>
                <li className="rounded-lg border border-[#bbf7d0] bg-[#f7fef9] p-4">
                  <span className="block text-xs font-semibold uppercase tracking-widest text-[#166534]">
                    Step 3
                  </span>
                  <span className="mt-1 block">Read it back before sending.</span>
                </li>
              </ol>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  href="/dashboard/settings"
                  data-testid="dashboard-empty-state-settings-link"
                  className="inline-flex h-10 items-center rounded-xl border border-[#bbf7d0] bg-white px-4 text-sm font-semibold text-[#14532d] transition hover:bg-[#f0fdf4]"
                >
                  Add my details
                </Link>
                <Link
                  href="/dashboard/invoices/new"
                  data-testid="dashboard-empty-state-new-invoice-link"
                  className="inline-flex h-10 items-center rounded-xl bg-[#15803d] px-4 text-sm font-semibold text-white transition hover:bg-[#14532d]"
                >
                  Create invoice
                </Link>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Link
            href="/dashboard/quotes"
            className="flex items-center justify-between rounded-xl border border-[#bbf7d0] bg-white p-5 shadow-sm transition hover:border-[#86efac] hover:shadow-md"
          >
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#dcfce7] px-2.5 py-0.5 text-xs font-semibold uppercase tracking-widest text-[#15803d]">
                Quotes
              </span>
              <p className="mt-2 text-sm font-medium text-[#14532d]">
                Reusable services and quote PDFs
              </p>
              <p className="mt-0.5 text-xs text-[#4b8068]">
                Create a quote, then convert it to an invoice draft.
              </p>
            </div>
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              className="flex-shrink-0 text-[#15803d]"
            >
              <path
                d="M7 4l6 6-6 6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <Link
            href="/dashboard/records"
            className="flex items-center justify-between rounded-xl border border-[#bbf7d0] bg-white p-5 shadow-sm transition hover:border-[#86efac] hover:shadow-md"
          >
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#dcfce7] px-2.5 py-0.5 text-xs font-semibold uppercase tracking-widest text-[#15803d]">
                Records
              </span>
              <p className="mt-2 text-sm font-medium text-[#14532d]">
                MTD-ready income and expenses
              </p>
              <p className="mt-0.5 text-xs text-[#4b8068]">
                See tax-year quarters and threshold progress.
              </p>
            </div>
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              className="flex-shrink-0 text-[#15803d]"
            >
              <path
                d="M7 4l6 6-6 6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <Link
            href="/dashboard/invoices/repeating"
            className="flex items-center justify-between rounded-xl border border-[#bbf7d0] bg-white p-5 shadow-sm transition hover:border-[#86efac] hover:shadow-md"
          >
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#dcfce7] px-2.5 py-0.5 text-xs font-semibold uppercase tracking-widest text-[#15803d]">
                Repeating
              </span>
              <p className="mt-2 text-sm font-medium text-[#14532d]">
                Scheduled draft invoices
              </p>
              <p className="mt-0.5 text-xs text-[#4b8068]">
                Create drafts from templates, then approve manually.
              </p>
            </div>
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              className="flex-shrink-0 text-[#15803d]"
            >
              <path
                d="M7 4l6 6-6 6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <Link
            href="/dashboard/tax-prep"
            className="flex items-center justify-between rounded-xl border border-[#bbf7d0] bg-white p-5 shadow-sm transition hover:border-[#86efac] hover:shadow-md"
          >
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#dcfce7] px-2.5 py-0.5 text-xs font-semibold uppercase tracking-widest text-[#15803d]">
                Tax prep
              </span>
              <p className="mt-2 text-sm font-medium text-[#14532d]">
                Self Assessment in plain English
              </p>
              <p className="mt-0.5 text-xs text-[#4b8068]">
                Map approved records to SA103S / SA103F prompts.
              </p>
            </div>
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              className="flex-shrink-0 text-[#15803d]"
            >
              <path
                d="M7 4l6 6-6 6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <Link
            href="/dashboard/glossary"
            className="flex items-center justify-between rounded-xl border border-[#bbf7d0] bg-white p-5 shadow-sm transition hover:border-[#86efac] hover:shadow-md"
          >
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#dcfce7] px-2.5 py-0.5 text-xs font-semibold uppercase tracking-widest text-[#15803d]">
                Explain Simply
              </span>
              <p className="mt-2 text-sm font-medium text-[#14532d]">
                Finance words in plain English
              </p>
              <p className="mt-0.5 text-xs text-[#4b8068]">
                Tap any tax term to see what it actually means.
              </p>
            </div>
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              className="flex-shrink-0 text-[#15803d]"
            >
              <path
                d="M7 4l6 6-6 6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </div>
      </div>
    </main>
  );
}

function dashboardClient(value: DashboardInvoice["clients"]) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function StatusPill({ invoice }: { invoice: DashboardInvoice }) {
  if (invoice.paid_at || invoice.delivery_status === "paid") {
    return <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-xs font-medium text-[#15803d]">Paid</span>;
  }

  if (invoice.sent_at || invoice.delivery_status === "sent") {
    return <span className="rounded-full bg-[#dbeafe] px-2 py-0.5 text-xs font-medium text-[#1d4ed8]">Sent</span>;
  }

  return <span className="rounded-full bg-[#f0fdf4] px-2 py-0.5 text-xs font-medium text-[#4b8068]">Not sent</span>;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function flashMessage(searchParams: { [key: string]: string | string[] | undefined }) {
  const error = singleParam(searchParams.error);
  if (error) return { kind: "error", text: error };
  if (searchParams.invoiceSent) return { kind: "success", text: "Invoice marked as sent." };
  if (searchParams.invoicePaid) return { kind: "success", text: "Invoice marked as paid." };
  if (searchParams.remindersEnabled) return { kind: "success", text: "Payment reminders scheduled. No email has been sent. A draft will appear here when it is due for your approval." };
  if (searchParams.remindersDisabled) return { kind: "success", text: "Automatic reminders stopped." };
  if (searchParams.reminderSent) return { kind: "success", text: "Reminder sent to client." };
  if (searchParams.invoiceDeleted) return { kind: "success", text: "Invoice deleted successfully." };
  if (searchParams.proposalConverted) return { kind: "success", text: "Invoice created from proposal." };
  if (searchParams.reminderDiscarded) return { kind: "success", text: "Reminder draft discarded." };
  return null;
}

function singleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const smallButtonCls =
  "inline-flex h-9 items-center justify-center rounded-lg bg-[#15803d] px-3 text-xs font-semibold text-white transition hover:bg-[#14532d]";

const smallOutlineButtonCls =
  "inline-flex h-9 items-center justify-center rounded-lg border border-[#bbf7d0] bg-white px-3 text-xs font-semibold text-[#14532d] transition hover:bg-[#f0fdf4]";

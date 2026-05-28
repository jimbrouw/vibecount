import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { amountToWords, formatPounds } from "@/lib/invoices/money";
import {
  disableInvoiceReminders,
  enableInvoiceReminders,
  markInvoicePaid,
  markInvoiceSent,
} from "@/app/dashboard/invoices/actions";
import LogoutButton from "./LogoutButton";
import PlainLanguageNote from "./PlainLanguageNote";

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
  status: string;
  delivery_status: string;
  sent_at: string | null;
  paid_at: string | null;
  reminder_enabled: boolean;
  next_reminder_at: string | null;
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
    .select("legal_name")
    .eq("id", user.id)
    .maybeSingle();

  const needsOnboarding = !settingsRow?.legal_name;

  // Recent invoices
  const { data: recentInvoices } = await supabase
    .from("invoices")
    .select(
      "id, number, invoice_date, due_date, amount, status, delivery_status, sent_at, paid_at, reminder_enabled, next_reminder_at, clients(name, email)"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);

  const resolvedSearchParams = await searchParams;
  const flash = flashMessage(resolvedSearchParams);
  const invoices = (recentInvoices ?? []) as unknown as DashboardInvoice[];

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
            </div>
          </div>
        )}

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
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#bbf7d0] bg-white px-5 text-sm font-semibold text-[#14532d] transition hover:bg-[#f0fdf4]"
            >
              Voice invoice
            </Link>
            <Link
              href="/dashboard/invoices/new"
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
                            Reminder {inv.next_reminder_at ? formatDateTime(inv.next_reminder_at) : "on"}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="lg:text-right">
                      <p className="text-sm font-semibold text-[#14532d]">
                        {formatPounds(Math.round(Number(inv.amount) * 100))}
                      </p>
                      <p className="mt-0.5 text-xs text-[#4b8068]">
                        {amountToWords(Math.round(Number(inv.amount) * 100))}
                      </p>
                    </div>
                  </div>

                  {inv.status === "finalised" ? (
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {!inv.sent_at && !inv.paid_at ? (
                        <form action={markInvoiceSent} className="flex gap-2">
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <input type="hidden" name="redirectTo" value="/dashboard" />
                          <input
                            name="clientEmail"
                            type="email"
                            defaultValue={client?.email ?? ""}
                            placeholder="client@example.com"
                            className="min-w-0 flex-1 rounded-lg border border-[#bbf7d0] px-3 text-xs text-[#14532d] outline-none focus:border-[#15803d]"
                          />
                          <button className={smallButtonCls}>Sent</button>
                        </form>
                      ) : null}

                      {!inv.paid_at ? (
                        <form action={markInvoicePaid}>
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <input type="hidden" name="redirectTo" value="/dashboard" />
                          <button className={smallButtonCls}>Mark paid</button>
                        </form>
                      ) : null}

                      {!inv.paid_at && !inv.reminder_enabled ? (
                        <form action={enableInvoiceReminders} className="flex gap-2">
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <input type="hidden" name="redirectTo" value="/dashboard" />
                          <input
                            name="clientEmail"
                            type="email"
                            defaultValue={client?.email ?? ""}
                            placeholder="client@example.com"
                            className="min-w-0 flex-1 rounded-lg border border-[#bbf7d0] px-3 text-xs text-[#14532d] outline-none focus:border-[#15803d]"
                          />
                          <button className={smallOutlineButtonCls}>Remind</button>
                        </form>
                      ) : null}

                      {inv.reminder_enabled ? (
                        <form action={disableInvoiceReminders}>
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <input type="hidden" name="redirectTo" value="/dashboard" />
                          <button className={smallOutlineButtonCls}>Stop reminders</button>
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
          <div className="rounded-xl border border-dashed border-[#bbf7d0] bg-white p-10 text-center">
            <p className="text-sm text-[#4b8068]">No invoices yet.</p>
            <p className="mt-1 text-xs text-[#86a88e]">
              Create your first one above.
            </p>
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
  if (searchParams.remindersEnabled) return { kind: "success", text: "Automatic reminders enabled." };
  if (searchParams.remindersDisabled) return { kind: "success", text: "Automatic reminders stopped." };
  return null;
}

function singleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const smallButtonCls =
  "inline-flex h-9 items-center justify-center rounded-lg bg-[#15803d] px-3 text-xs font-semibold text-white transition hover:bg-[#14532d]";

const smallOutlineButtonCls =
  "inline-flex h-9 items-center justify-center rounded-lg border border-[#bbf7d0] bg-white px-3 text-xs font-semibold text-[#14532d] transition hover:bg-[#f0fdf4]";

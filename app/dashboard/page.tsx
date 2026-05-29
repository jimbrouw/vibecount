import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { amountToWords, formatPounds } from "@/lib/invoices/money";
import LogoutButton from "./LogoutButton";
import PlainLanguageNote from "./PlainLanguageNote";

export const metadata = {
  title: "Dashboard — VibeCount",
  description: "Create invoices, browse your glossary, and manage your freelancer settings.",
};

export default async function DashboardPage() {
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
    .select("id, number, invoice_date, amount, status")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(5);

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
              href="/dashboard/glossary"
              className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              Explain Simply
            </Link>
            <Link
              href="/dashboard/agent"
              className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              Agent
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

        {/* Recent invoices */}
        {recentInvoices && recentInvoices.length > 0 ? (
          <div className="rounded-xl border border-[#bbf7d0] bg-white shadow-sm">
            <div className="border-b border-[#f0fdf4] px-5 py-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#166534]">
                Recent
              </p>
            </div>
            <ul>
              {recentInvoices.map((inv, idx) => (
                <li
                  key={inv.id}
                  className={`flex items-center justify-between px-5 py-4 ${
                    idx < recentInvoices.length - 1
                      ? "border-b border-[#f0fdf4]"
                      : ""
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium text-[#14532d]">{inv.number}</p>
                    <p className="mt-0.5 text-xs text-[#4b8068]">
                      {inv.invoice_date
                        ? new Intl.DateTimeFormat("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          }).format(new Date(`${inv.invoice_date}T00:00:00Z`))
                        : "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-[#14532d]">
                      {formatPounds(Math.round(Number(inv.amount) * 100))}
                    </p>
                    <p className="mt-0.5 text-xs text-[#4b8068]">
                      {amountToWords(Math.round(Number(inv.amount) * 100))}
                    </p>
                    <span
                      className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        inv.status === "finalised"
                          ? "bg-[#dcfce7] text-[#15803d]"
                          : "bg-[#f0fdf4] text-[#4b8068]"
                      }`}
                    >
                      {inv.status === "finalised" ? "Finalised" : "Draft"}
                    </span>
                  </div>
                </li>
              ))}
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

        {/* Explain Simply teaser */}
        <div className="mt-6">
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

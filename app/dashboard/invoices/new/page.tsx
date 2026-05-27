import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import InvoiceBuilder from "./InvoiceBuilder";
import { formatTodayAsUkDate } from "@/lib/invoices/validation";
import { EMPTY_SETTINGS } from "@/lib/settings";
import LogoutButton from "../../LogoutButton";

export const metadata = {
  title: "New Invoice — VibeCount",
  description: "Create a typed invoice and download a professional PDF.",
};

export default async function NewInvoicePage({
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

  // Load existing clients for autocomplete
  const { data: clientRows } = await supabase
    .from("clients")
    .select("id, name")
    .eq("user_id", user.id)
    .order("name", { ascending: true });

  // Load user settings for defaults
  const { data: settingsRow } = await supabase
    .from("user_settings")
    .select(
      "legal_name, address, contact_details, default_payment_terms, bank_details, vat_registered, vat_number, vat_rate, invoice_number_prefix, late_payment_wording, utr"
    )
    .eq("id", user.id)
    .maybeSingle();

  const existingClients = (clientRows ?? []) as { id: string; name: string }[];
  const initialDate = formatTodayAsUkDate();
  const resolvedSearchParams = await searchParams;
  const initialDraft = {
    clientName: getSingleSearchParam(resolvedSearchParams.clientName),
    description: getSingleSearchParam(resolvedSearchParams.description),
    amount: getSingleSearchParam(resolvedSearchParams.amount),
    source: getSingleSearchParam(resolvedSearchParams.source),
    transcript: getSingleSearchParam(resolvedSearchParams.transcript),
  };

  const userDefaults = {
    ...EMPTY_SETTINGS,
    ...(settingsRow ?? {}),
    hasSettings: Boolean(
      settingsRow?.legal_name || settingsRow?.bank_details || settingsRow?.contact_details
    ),
  };

  return (
    <main className="min-h-screen bg-[#f5f0e8]">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#e5e0d8] bg-white px-6 py-4 sm:px-8">
        <div className="flex items-center gap-6">
          <Link
            href="/dashboard"
            className="text-lg font-semibold text-[#1a3a2a] transition hover:text-[#2d6a4a]"
          >
            VibeCount
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            <Link
              href="/dashboard"
              className="rounded-lg px-3 py-1.5 text-sm text-[#4a6a5a] transition hover:bg-[#f0ece4] hover:text-[#1a3a2a]"
            >
              Invoices
            </Link>
            <Link
              href="/dashboard/glossary"
              className="rounded-lg px-3 py-1.5 text-sm text-[#4a6a5a] transition hover:bg-[#f0ece4] hover:text-[#1a3a2a]"
            >
              Explain Simply
            </Link>
            <Link
              href="/dashboard/settings"
              className="rounded-lg px-3 py-1.5 text-sm text-[#4a6a5a] transition hover:bg-[#f0ece4] hover:text-[#1a3a2a]"
            >
              Settings
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-[#4a6a5a] sm:block">{user.email}</span>
          <LogoutButton />
        </div>
      </header>

      <InvoiceBuilder
        existingClients={existingClients}
        initialDate={initialDate}
        userDefaults={userDefaults}
        initialDraft={initialDraft}
      />
    </main>
  );
}

function getSingleSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

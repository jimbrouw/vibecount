import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import InvoiceBuilder from "../new/InvoiceBuilder";
import { EMPTY_SETTINGS } from "@/lib/settings";
import LogoutButton from "../../LogoutButton";

export const metadata = {
  title: "Edit Invoice — VibeCount",
  description: "Edit an invoice and download a professional PDF.",
};

export default async function EditInvoicePage({
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

  const resolvedSearchParams = await searchParams;
  const invoiceId = getSingleSearchParam(resolvedSearchParams.id);
  if (!invoiceId) {
    redirect("/dashboard");
  }

  // Load the existing invoice
  const { data: invoice } = await supabase
    .from("invoices")
    .select("*, clients(*)")
    .eq("id", invoiceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!invoice) {
    redirect("/dashboard?error=Invoice+not+found");
  }

  // Load existing clients for autocomplete
  const { data: clientRows } = await supabase
    .from("clients")
    .select("id, name, email, address, company_number, vat_number")
    .eq("user_id", user.id)
    .order("name", { ascending: true });

  // Load user settings for defaults
  const { data: settingsRow } = await supabase
    .from("user_settings")
    .select(
      "legal_name, address, contact_details, default_payment_terms, bank_details, payment_link_provider, payment_link_url, vat_registered, vat_number, vat_rate, invoice_number_prefix, late_payment_wording, utr, companies_house_api_key"
    )
    .eq("id", user.id)
    .maybeSingle();

  const existingClients = (clientRows ?? []) as any[];

  // Format dates from YYYY-MM-DD to DD/MM/YYYY
  const parts = invoice.invoice_date.split("-");
  const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : invoice.invoice_date;

  // Since amount is stored as decimal (e.g. 450.00), we format it to string
  const formattedAmount = Number(invoice.amount).toFixed(2);

  const initialDraft = {
    invoiceId: invoice.id,
    clientName: invoice.clients?.name ?? "",
    description: invoice.description,
    amount: formattedAmount,
    source: "edit",
    transcript: "",
    clientAddress: invoice.clients?.address ?? "",
    clientCompanyNumber: invoice.clients?.company_number ?? "",
    clientEmail: invoice.clients?.email ?? "",
    clientVatNumber: invoice.clients?.vat_number ?? "",
    paymentTerms: invoice.payment_terms ?? "",
  };

  const userDefaults = {
    ...EMPTY_SETTINGS,
    ...(settingsRow ?? {}),
    hasSettings: Boolean(
      settingsRow?.legal_name || settingsRow?.bank_details || settingsRow?.contact_details
    ),
    companiesHouseConfigured: Boolean(settingsRow?.companies_house_api_key?.trim()),
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
              href="/dashboard/quotes"
              className="rounded-lg px-3 py-1.5 text-sm text-[#4a6a5a] transition hover:bg-[#f0ece4] hover:text-[#1a3a2a]"
            >
              Quotes
            </Link>
            <Link
              href="/dashboard/records"
              className="rounded-lg px-3 py-1.5 text-sm text-[#4a6a5a] transition hover:bg-[#f0ece4] hover:text-[#1a3a2a]"
            >
              Records
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
        initialDate={formattedDate}
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

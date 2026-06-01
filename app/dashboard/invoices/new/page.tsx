import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import InvoiceBuilder from "./InvoiceBuilder";
import { formatTodayAsUkDate } from "@/lib/invoices/validation";
import { EMPTY_SETTINGS } from "@/lib/settings";
import DashboardShell from "../../DashboardShell";

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
    <DashboardShell active="invoices" userEmail={user.email ?? ""}>
      <InvoiceBuilder
        existingClients={existingClients}
        initialDate={initialDate}
        userDefaults={userDefaults}
        initialDraft={initialDraft}
      />
    </DashboardShell>
  );
}

function getSingleSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

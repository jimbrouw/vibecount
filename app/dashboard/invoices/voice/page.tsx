import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardShell from "../../DashboardShell";
import VoiceInvoiceBuilder from "./VoiceInvoiceBuilder";

export const metadata = {
  title: "Voice Invoice — VibeCount",
  description: "Speak an invoice, confirm the amount, then continue to the normal preview flow.",
};

export default async function VoiceInvoicePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <DashboardShell active="invoices" userEmail={user.email ?? ""}>
      <VoiceInvoiceBuilder />
    </DashboardShell>
  );
}

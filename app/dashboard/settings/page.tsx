import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardShell from "../DashboardShell";
import PlainLanguageNote from "../PlainLanguageNote";
import SettingsForm from "./SettingsForm";

export const metadata = {
  title: "Settings — VibeCount",
  description: "Set your UK freelancer invoice defaults: trading name, address, bank details, VAT, and more.",
};

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <DashboardShell active="settings" userEmail={user.email ?? ""}>
      <div className="mx-auto max-w-2xl px-5 py-8 sm:px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-[#1a3a2a]">
            Your invoice defaults
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#4a6a5a]">
            Set these once and they will appear on every invoice you create. You can
            always override them on individual invoices.
          </p>
          <div className="mt-3">
            <PlainLanguageNote>
              These details fill in the parts of the invoice that describe you and how
              the client should pay you. Private tax information stays off the PDF.
            </PlainLanguageNote>
          </div>
        </div>

        <SettingsForm />
      </div>
    </DashboardShell>
  );
}

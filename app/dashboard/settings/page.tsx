import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import LogoutButton from "../LogoutButton";
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
              className="rounded-lg bg-[#e8f0eb] px-3 py-1.5 text-sm font-medium text-[#1a3a2a]"
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
    </main>
  );
}

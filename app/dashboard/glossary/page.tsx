import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { resolveGlossaryTerms } from "@/lib/glossary";
import LogoutButton from "../LogoutButton";
import GlossaryBrowser from "./GlossaryBrowser";

export const metadata = {
  title: "Explain Simply — VibeCount",
  description:
    "Plain-English explanations of tax and accounting terms, always shown beside the official wording.",
};

export default async function GlossaryPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: terms } = await supabase
    .from("glossary_terms")
    .select("id, term, explanation, example")
    .order("sort_order", { ascending: true })
    .order("term", { ascending: true });

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
              className="rounded-lg bg-[#e8f0eb] px-3 py-1.5 text-sm font-medium text-[#1a3a2a]"
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

      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
        <div className="mb-8">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e8f0eb] px-3 py-1 text-xs font-semibold uppercase tracking-widest text-[#2d6a4a]">
            Explain Simply
          </span>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-[#1a3a2a]">
            Finance words in plain English
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#4a6a5a]">
            Every term below shows the official HMRC wording first, then a plain-English
            explanation, then a real example. The official term is always visible — never
            replaced.
          </p>
        </div>

        <GlossaryBrowser terms={resolveGlossaryTerms(terms ?? [])} />
      </div>
    </main>
  );
}

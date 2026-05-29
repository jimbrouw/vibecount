import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import LogoutButton from "@/app/dashboard/LogoutButton";
import AgentChat from "./AgentChat";

export const metadata = {
  title: "Agent — VibeCount",
  description: "Ask your AI agent about invoices, UK taxes, and your freelance finances.",
};

export default async function AgentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: settings } = await supabase
    .from("user_settings")
    .select("agent_api_key, agent_provider")
    .eq("id", user.id)
    .maybeSingle();

  const hasKey = Boolean(
    (settings as { agent_api_key?: string } | null)?.agent_api_key
  );

  return (
    <main className="flex h-screen flex-col bg-[#f0fdf4]">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#15803d] bg-[#15803d] px-6 py-4 sm:px-8">
        <div className="flex items-center gap-6">
          <span className="text-lg font-semibold text-white">VibeCount</span>
          <nav className="hidden items-center gap-1 sm:flex">
            <Link
              href="/dashboard"
              className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white"
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
              className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium text-white"
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

      {!hasKey && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-800">
          Add your Anthropic or OpenAI API key in{" "}
          <Link href="/dashboard/settings" className="font-semibold underline">
            Settings → Agent
          </Link>{" "}
          to use your own token, or the server key will be used as a fallback.
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <AgentChat />
      </div>
    </main>
  );
}

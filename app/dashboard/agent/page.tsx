import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import DashboardShell from "@/app/dashboard/DashboardShell";
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
    <DashboardShell active="agent" userEmail={user.email ?? ""} className="flex h-screen flex-col bg-[#f0fdf4]">
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
    </DashboardShell>
  );
}

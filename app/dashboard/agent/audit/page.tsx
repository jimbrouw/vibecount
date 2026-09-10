import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import LogoutButton from "@/app/dashboard/LogoutButton";

export const metadata = {
  title: "Agent Audit Log — VibeCount",
  description: "Every action taken by an agent on your account.",
};

type ActionRow = {
  id: string;
  tool: string;
  scope_used: string;
  params_summary: string;
  result_status: string;
  error: string | null;
  created_at: string;
  agent_sessions: { label: string } | null;
};

export default async function AgentAuditPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: actions } = await supabase
    .from("agent_actions")
    .select("id, tool, scope_used, params_summary, result_status, error, created_at, agent_sessions(label)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (actions ?? []) as unknown as ActionRow[];

  return (
    <main className="min-h-screen bg-[#f0fdf4]">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#15803d] bg-[#15803d] px-6 py-4 sm:px-8">
        <div className="flex items-center gap-6">
          <span className="text-lg font-semibold text-white">VibeCount</span>
          <nav className="hidden items-center gap-1 sm:flex">
            <Link href="/dashboard" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Invoices</Link>
            <Link href="/dashboard/settings" className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">Settings</Link>
            <Link href="/dashboard/agent/audit" className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium text-white">Agent log</Link>
          </nav>
        </div>
        <div className="flex items-center gap-4"><LogoutButton /></div>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-[#14532d]">Agent audit log</h1>
          <p className="mt-1 text-sm text-[#166534]">
            Every tool call made by an agent token on your account. This log is immutable — rows are never deleted.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#bbf7d0] bg-white p-10 text-center">
            <p className="text-sm text-[#4b8068]">No agent actions yet.</p>
            <p className="mt-1 text-xs text-[#86a88e]">
              Generate a token in <Link href="/dashboard/settings" className="underline">Settings</Link> to get started.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-[#bbf7d0] bg-white shadow-sm">
            <div className="border-b border-[#f0fdf4] px-5 py-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#166534]">{rows.length} actions</p>
            </div>
            <ul className="divide-y divide-[#f0fdf4]">
              {rows.map((action) => (
                <li key={action.id} className="px-5 py-3" data-testid={`audit-row-${action.id}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="text-xs font-semibold text-[#14532d]">{action.tool}</code>
                        <StatusBadge status={action.result_status} />
                      </div>
                      <p className="mt-0.5 text-xs text-[#4b8068]">
                        {action.scope_used}
                        {action.params_summary ? ` · ${action.params_summary}` : ""}
                        {(action.agent_sessions as { label?: string } | null)?.label
                          ? ` · ${(action.agent_sessions as { label: string }).label}`
                          : ""}
                      </p>
                      {action.error && (
                        <p className="mt-1 text-xs text-[#7a271a]">{action.error}</p>
                      )}
                    </div>
                    <p className="flex-shrink-0 text-xs text-[#86a88e]">{formatDateTime(action.created_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ok:     "bg-[#dcfce7] text-[#15803d]",
    error:  "bg-[#fee2e2] text-[#b91c1c]",
    denied: "bg-[#fef3c7] text-[#b45309]",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? styles.ok}`}>
      {status}
    </span>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

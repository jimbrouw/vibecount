"use client";

import { useState } from "react";
import Link from "next/link";

const ALL_SCOPES = [
  { id: "read:pl_summary", label: "Read P&L summary", description: "Net profit by quarter" },
  { id: "read:invoices", label: "Read invoices", description: "Invoice list and status" },
  { id: "read:records", label: "Read records", description: "Approved expenses and income" },
  { id: "draft:record", label: "Draft records", description: "Create records for your review" },
  { id: "draft:invoice", label: "Draft invoices", description: "Create invoices for your review" },
] as const;

type Scope = (typeof ALL_SCOPES)[number]["id"];

type GeneratedSession = {
  token: string;
  label: string;
  scopes: string[];
  expiresAt: string;
  warning: string;
};

type ActiveSession = {
  id: string;
  label: string;
  scopes: string[];
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

export default function AgentAccess({ initialSessions }: { initialSessions: ActiveSession[] }) {
  const [selectedScopes, setSelectedScopes] = useState<Scope[]>(["read:pl_summary", "read:invoices", "read:records"]);
  const [label, setLabel] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [generated, setGenerated] = useState<GeneratedSession | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [sessions, setSessions] = useState<ActiveSession[]>(initialSessions);
  const [copied, setCopied] = useState(false);

  function toggleScope(scope: Scope) {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  }

  async function handleGenerate() {
    if (selectedScopes.length === 0) return;
    setState("loading");
    setErrorMsg("");
    setGenerated(null);

    try {
      const res = await fetch("/api/mcp/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scopes: selectedScopes, label: label || "Agent session" }),
      });
      const data = await res.json() as GeneratedSession & { error?: string };
      if (!res.ok || data.error) { setErrorMsg(data.error ?? "Failed."); setState("error"); return; }
      setGenerated(data);
      setState("done");

      // Refresh session list
      const listRes = await fetch("/api/mcp/session");
      const listData = await listRes.json() as { sessions: ActiveSession[] };
      setSessions(listData.sessions ?? []);
    } catch {
      setErrorMsg("Could not reach the server.");
      setState("error");
    }
  }

  async function handleRevoke(sessionId: string) {
    await fetch(`/api/mcp/session?sessionId=${sessionId}`, { method: "DELETE" });
    setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, revoked_at: new Date().toISOString() } : s));
  }

  function handleCopy() {
    if (!generated?.token) return;
    navigator.clipboard.writeText(generated.token).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  const activeSessions = sessions.filter((s) => !s.revoked_at && new Date(s.expires_at) > new Date());

  return (
    <section className="rounded-xl border border-[#bbf7d0] bg-white p-6 shadow-sm" data-testid="agent-access-section">
      <h2 className="text-base font-semibold text-[#14532d]">Agent access</h2>
      <p className="mt-1 text-sm leading-6 text-[#4b8068]">
        Generate a short-lived token for an external agent or automation. Tokens expire after 15 minutes and are shown once only. Every action the agent takes is logged in the{" "}
        <Link href="/dashboard/agent/audit" className="font-semibold text-[#15803d] underline">audit log</Link>.
      </p>

      {generated ? (
        <div className="mt-5 rounded-xl border border-[#fef08a] bg-[#fefce8] p-4" data-testid="generated-token-panel">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#713f12]">Your agent token</p>
          <p className="mt-1 text-xs text-[#854d0e]">{generated.warning}</p>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg border border-[#fef08a] bg-white px-3 py-2 text-xs font-mono text-[#14532d]" data-testid="agent-token-value">
              {generated.token}
            </code>
            <button type="button" onClick={handleCopy} className="flex-shrink-0 rounded-lg border border-[#fef08a] bg-white px-3 py-2 text-xs font-semibold text-[#713f12] transition hover:bg-[#fefce8]">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-[#854d0e]">
            <span>Scopes: {generated.scopes.join(", ")}</span>
            <span>Expires: {new Date(generated.expiresAt).toLocaleTimeString("en-GB")}</span>
          </div>
          <button type="button" onClick={() => { setGenerated(null); setState("idle"); }} className="mt-3 text-xs text-[#4b8068] underline">
            Generate another
          </button>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#166534]">Label (optional)</span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Codex session"
              data-testid="agent-label-input"
              className="mt-1 h-10 w-full rounded-lg border border-[#bbf7d0] bg-white px-3 text-sm text-[#14532d] outline-none focus:border-[#15803d]"
            />
          </label>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#166534]">Scopes</p>
            <div className="space-y-2">
              {ALL_SCOPES.map((scope) => (
                <label key={scope.id} className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(scope.id)}
                    onChange={() => toggleScope(scope.id)}
                    data-testid={`scope-checkbox-${scope.id}`}
                    className="mt-0.5 h-4 w-4 accent-[#15803d]"
                  />
                  <div>
                    <p className="text-sm font-medium text-[#14532d]">{scope.label}</p>
                    <p className="text-xs text-[#4b8068]">{scope.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {state === "error" && <p className="text-xs text-[#7a271a]">{errorMsg}</p>}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={state === "loading" || selectedScopes.length === 0}
            data-testid="generate-token-button"
            className="inline-flex h-10 items-center rounded-xl bg-[#15803d] px-5 text-sm font-semibold text-white transition hover:bg-[#14532d] disabled:opacity-50"
          >
            {state === "loading" ? "Generating…" : "Generate 15-minute token"}
          </button>
        </div>
      )}

      {activeSessions.length > 0 && (
        <div className="mt-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#166534]">Active sessions</p>
          <div className="space-y-2">
            {activeSessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-4 rounded-lg border border-[#dcfce7] bg-[#f7fef9] px-4 py-2 text-xs" data-testid={`session-row-${s.id}`}>
                <div>
                  <p className="font-medium text-[#14532d]">{s.label}</p>
                  <p className="text-[#4b8068]">{s.scopes.join(", ")} · expires {new Date(s.expires_at).toLocaleTimeString("en-GB")}</p>
                </div>
                <button type="button" onClick={() => handleRevoke(s.id)} data-testid={`revoke-session-${s.id}`} className="text-[#7a271a] underline">Revoke</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

import { createHash, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const VALID_SCOPES = [
  "read:records",
  "read:invoices",
  "read:pl_summary",
  "draft:record",
  "draft:invoice",
] as const;

export type AgentScope = (typeof VALID_SCOPES)[number];

export type AgentSession = {
  id: string;
  user_id: string;
  scopes: AgentScope[];
};

export function generateToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  const hash = hashToken(token);
  return { token, hash };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function validateAgentToken(
  authHeader: string | null,
  requiredScope: AgentScope
): Promise<{ ok: true; session: AgentSession } | { ok: false; status: number; error: string }> {
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Missing or invalid Authorization header." };
  }

  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, status: 401, error: "Empty agent token." };

  const hash = hashToken(token);
  const supabase = createAdminClient();
  if (!supabase) return { ok: false, status: 503, error: "Database not configured." };

  const { data: session } = await supabase
    .from("agent_sessions")
    .select("id, user_id, scopes, expires_at, revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();

  if (!session) return { ok: false, status: 401, error: "Invalid agent token." };
  if (session.revoked_at) return { ok: false, status: 401, error: "Agent token has been revoked." };
  if (new Date(session.expires_at) < new Date()) {
    return { ok: false, status: 401, error: "Agent token has expired." };
  }

  const scopes = (session.scopes ?? []) as AgentScope[];
  if (!scopes.includes(requiredScope)) {
    return { ok: false, status: 403, error: `Token does not have scope: ${requiredScope}` };
  }

  return { ok: true, session: { id: session.id, user_id: session.user_id, scopes } };
}

export async function logAgentAction(input: {
  userId: string;
  sessionId: string;
  tool: string;
  scopeUsed: string;
  paramsSummary: string;
  resultStatus: "ok" | "error" | "denied";
  error?: string;
}) {
  const supabase = createAdminClient();
  if (!supabase) return;
  await supabase.from("agent_actions").insert({
    user_id: input.userId,
    session_id: input.sessionId,
    tool: input.tool,
    scope_used: input.scopeUsed,
    params_summary: input.paramsSummary,
    result_status: input.resultStatus,
    error: input.error ?? null,
  });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateToken, hashToken, VALID_SCOPES, type AgentScope } from "@/lib/mcp/auth";

export const runtime = "nodejs";

const SESSION_TTL_MINUTES = 15;

// POST: create a new agent session token
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to create an agent session." }, { status: 401 });

  const body = await request.json() as { scopes?: string[]; label?: string };
  const requestedScopes = (body.scopes ?? []).filter((s): s is AgentScope =>
    VALID_SCOPES.includes(s as AgentScope)
  );

  if (requestedScopes.length === 0) {
    return NextResponse.json({ error: "Select at least one scope." }, { status: 400 });
  }

  const { token, hash } = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000);

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Database not configured." }, { status: 503 });

  const { data: session, error } = await admin
    .from("agent_sessions")
    .insert({
      user_id: user.id,
      token_hash: hash,
      label: String(body.label ?? "").slice(0, 80) || "Agent session",
      scopes: requestedScopes,
      expires_at: expiresAt.toISOString(),
    })
    .select("id, label, scopes, expires_at")
    .single();

  if (error || !session) {
    return NextResponse.json({ error: "Could not create agent session." }, { status: 500 });
  }

  // Token is returned once — never stored in plaintext.
  return NextResponse.json({
    token,
    sessionId: session.id,
    label: session.label,
    scopes: session.scopes,
    expiresAt: session.expires_at,
    warning: "Save this token now — it will not be shown again.",
  });
}

// DELETE: revoke a session
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "Missing sessionId." }, { status: 400 });

  const { error } = await supabase
    .from("agent_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .is("revoked_at", null);

  if (error) return NextResponse.json({ error: "Could not revoke session." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// GET: list active sessions for the logged-in user
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });

  const { data } = await supabase
    .from("agent_sessions")
    .select("id, label, scopes, expires_at, revoked_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return NextResponse.json({ sessions: data ?? [] });
}

export { hashToken };

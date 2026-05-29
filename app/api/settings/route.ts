import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AGENT_KEY_MASK, EMPTY_SETTINGS, sanitizeUserSettings } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to view settings." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_settings")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Could not load user settings", error);
    return NextResponse.json({ error: settingsErrorMessage(error) }, { status: 500 });
  }

  const row = data ?? { id: user.id, ...EMPTY_SETTINGS };

  // Never return the raw agent API key — return the mask if one is stored.
  const masked = {
    ...row,
    agent_api_key: row.agent_api_key ? AGENT_KEY_MASK : "",
  };

  return NextResponse.json(masked);
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to save settings." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const settings = sanitizeUserSettings(body);
  if (!settings) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // If the client sent the mask sentinel back, exclude agent_api_key from the update
  // so the stored key is not overwritten.
  const { agent_api_key, ...rest } = settings;
  const upsertPayload: Record<string, unknown> = { id: user.id, ...rest };
  if (agent_api_key !== AGENT_KEY_MASK) {
    upsertPayload.agent_api_key = agent_api_key;
  }

  const { error } = await supabase
    .from("user_settings")
    .upsert(upsertPayload, { onConflict: "id" });

  if (error) {
    console.error("Could not save user settings", error);
    return NextResponse.json({ error: settingsErrorMessage(error) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, settings: { ...settings, agent_api_key: agent_api_key !== AGENT_KEY_MASK ? (agent_api_key ? AGENT_KEY_MASK : "") : AGENT_KEY_MASK } });
}

function settingsErrorMessage(error: { code?: string; message?: string }) {
  if (error.code === "42P01" || error.code === "PGRST205") {
    return "Settings storage is not ready yet. Please apply the Supabase user_settings migration and try again.";
  }

  if (error.code === "PGRST204") {
    return "Settings storage is out of date. Please apply the latest Supabase settings migration and try again.";
  }

  return error.message ? `Could not save settings: ${error.message}` : "Could not save settings.";
}

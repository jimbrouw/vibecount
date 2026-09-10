import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { EMPTY_SETTINGS, sanitizeUserSettings } from "@/lib/settings";

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

  const settings = data ?? { id: user.id, ...EMPTY_SETTINGS };
  let pdf_logo_url = "";

  if (settings.pdf_logo_path) {
    const { data: signed } = await supabase.storage
      .from("brand-assets")
      .createSignedUrl(settings.pdf_logo_path, 60 * 10);
    pdf_logo_url = signed?.signedUrl ?? "";
  }

  return NextResponse.json({ ...settings, pdf_logo_url });
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

  const safeSettings = { ...settings };
  safeSettings.pdf_logo_path = "";
  const { data: existing } = await supabase
    .from("user_settings")
    .select("pdf_logo_path")
    .eq("id", user.id)
    .maybeSingle();

  const { error } = await supabase
    .from("user_settings")
    .upsert(
      { id: user.id, ...safeSettings, pdf_logo_path: existing?.pdf_logo_path ?? "" },
      { onConflict: "id" }
    );

  if (error) {
    console.error("Could not save user settings", error);
    return NextResponse.json({ error: settingsErrorMessage(error) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, settings });
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

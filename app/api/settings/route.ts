import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { EMPTY_SETTINGS, sanitizeUserSettings } from "@/lib/settings";

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
    return NextResponse.json({ error: "Could not load settings." }, { status: 500 });
  }

  return NextResponse.json(data ?? { id: user.id, ...EMPTY_SETTINGS });
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

  const { error } = await supabase
    .from("user_settings")
    .upsert({ id: user.id, ...settings }, { onConflict: "id" });

  if (error) {
    return NextResponse.json({ error: "Could not save settings." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, settings });
}

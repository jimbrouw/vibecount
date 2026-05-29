import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET — returns whether a key exists and the last 8 chars (for display).
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { data } = await supabase
    .from("user_settings")
    .select("vibecount_api_key")
    .eq("id", user.id)
    .maybeSingle();

  const key = data?.vibecount_api_key as string | null | undefined;
  if (!key) {
    return NextResponse.json({ set: false, preview: null });
  }

  return NextResponse.json({ set: true, preview: `vc_live_...${key.slice(-8)}` });
}

// POST — generates (or regenerates) the VibeCount API key.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const key = generateApiKey();

  const { error } = await supabase
    .from("user_settings")
    .upsert({ id: user.id, vibecount_api_key: key }, { onConflict: "id" });

  if (error) {
    return NextResponse.json({ error: "Could not generate key." }, { status: 500 });
  }

  // Return the full key once — the user must copy it now.
  return NextResponse.json({ key });
}

// DELETE — revokes the key.
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  await supabase
    .from("user_settings")
    .update({ vibecount_api_key: null })
    .eq("id", user.id);

  return NextResponse.json({ ok: true });
}

function generateApiKey(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `vc_live_${hex}`;
}

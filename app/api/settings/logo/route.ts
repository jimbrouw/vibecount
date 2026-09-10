import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validatePdfLogoUpload } from "@/lib/settings-logo";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to upload a logo." }, { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("logo");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a PNG or JPG logo." }, { status: 400 });
  }

  const validation = validatePdfLogoUpload(file.type, file.size);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const path = `${user.id}/pdf-logo.${validation.ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { data: existing } = await supabase
    .from("user_settings")
    .select("pdf_logo_path")
    .eq("id", user.id)
    .maybeSingle();

  if (existing?.pdf_logo_path && existing.pdf_logo_path !== path) {
    await supabase.storage.from("brand-assets").remove([existing.pdf_logo_path]);
  }

  const { error: uploadError } = await supabase.storage
    .from("brand-assets")
    .upload(path, bytes, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadError) {
    console.error("Logo upload failed", uploadError);
    return NextResponse.json({ error: "Could not upload logo." }, { status: 500 });
  }

  const { error: settingsError } = await supabase
    .from("user_settings")
    .upsert({ id: user.id, pdf_logo_path: path }, { onConflict: "id" });

  if (settingsError) {
    console.error("Logo setting update failed", settingsError);
    return NextResponse.json({ error: "Logo uploaded, but settings could not be saved." }, { status: 500 });
  }

  const { data: signed } = await supabase.storage.from("brand-assets").createSignedUrl(path, 60 * 10);
  return NextResponse.json({ ok: true, pdf_logo_path: path, pdf_logo_url: signed?.signedUrl ?? "" });
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to remove a logo." }, { status: 401 });
  }

  const { data: settings } = await supabase
    .from("user_settings")
    .select("pdf_logo_path")
    .eq("id", user.id)
    .maybeSingle();

  if (settings?.pdf_logo_path) {
    await supabase.storage.from("brand-assets").remove([settings.pdf_logo_path]);
  }

  const { error } = await supabase
    .from("user_settings")
    .upsert({ id: user.id, pdf_logo_path: "" }, { onConflict: "id" });

  if (error) {
    console.error("Logo delete setting update failed", error);
    return NextResponse.json({ error: "Could not remove logo." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

import { createClient } from "@/lib/supabase/server";
import type { PdfBranding } from "@/lib/pdf/branding";

export type PdfBrandingSettings = {
  pdf_logo_path?: string | null;
  pdf_primary_color?: string | null;
  pdf_accent_color?: string | null;
};

export async function loadPdfBranding(
  supabase: Awaited<ReturnType<typeof createClient>>,
  settings?: PdfBrandingSettings | null
): Promise<PdfBranding> {
  const logo = await loadLogo(supabase, settings?.pdf_logo_path ?? "");

  return {
    primaryColor: settings?.pdf_primary_color ?? "",
    accentColor: settings?.pdf_accent_color ?? "",
    logoBytes: logo?.bytes,
    logoMimeType: logo?.mimeType,
  };
}

async function loadLogo(supabase: Awaited<ReturnType<typeof createClient>>, path: string) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("brand-assets").download(path);
  if (error || !data) return null;

  return {
    bytes: new Uint8Array(await data.arrayBuffer()),
    mimeType: data.type || (path.endsWith(".jpg") ? "image/jpeg" : "image/png"),
  };
}

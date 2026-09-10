export const MAX_PDF_LOGO_BYTES = 2 * 1024 * 1024;

export const PDF_LOGO_MIME_TO_EXT: Record<string, "png" | "jpg"> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

export function validatePdfLogoUpload(type: string, size: number) {
  const ext = PDF_LOGO_MIME_TO_EXT[type];
  if (!ext) {
    return { ok: false as const, error: "Logo must be a PNG or JPG image." };
  }

  if (size > MAX_PDF_LOGO_BYTES) {
    return { ok: false as const, error: "Logo must be 2MB or smaller." };
  }

  return { ok: true as const, ext };
}

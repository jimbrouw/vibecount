import { PDFDocument, PDFPage, PDFFont, RGB, rgb } from "pdf-lib";
import {
  DEFAULT_PDF_ACCENT_COLOR,
  DEFAULT_PDF_PRIMARY_COLOR,
  sanitizeHexColor,
} from "@/lib/settings";

export type PdfBranding = {
  primaryColor: string;
  accentColor: string;
  logoBytes?: Uint8Array;
  logoMimeType?: string;
};

export type PdfBrandPalette = {
  primary: RGB;
  accent: RGB;
  ink: RGB;
  muted: RGB;
  light: RGB;
};

export function createPdfPalette(branding?: PdfBranding): PdfBrandPalette {
  return {
    primary: hexToRgb(sanitizeHexColor(branding?.primaryColor, DEFAULT_PDF_PRIMARY_COLOR)),
    accent: hexToRgb(sanitizeHexColor(branding?.accentColor, DEFAULT_PDF_ACCENT_COLOR)),
    ink: rgb(0.1, 0.23, 0.16),
    muted: rgb(0.29, 0.42, 0.35),
    light: rgb(0.47, 0.6, 0.53),
  };
}

export async function drawPdfBrandHeader({
  pdf,
  page,
  bold,
  brandName,
  documentLabel,
  branding,
}: {
  pdf: PDFDocument;
  page: PDFPage;
  bold: PDFFont;
  brandName: string;
  documentLabel: string;
  branding?: PdfBranding;
}) {
  const { width, height } = page.getSize();
  const palette = createPdfPalette(branding);
  const headerH = 100;

  page.drawRectangle({ x: 0, y: height - headerH, width, height: headerH, color: palette.accent });

  const safeBrand = brandName.trim() || "VibeCount";
  let brandX = 48;
  let brandY = height - 54;
  let brandWidth = width - 230;

  const logo = await embedLogo(pdf, branding);
  if (logo) {
    const maxW = 70;
    const maxH = 48;
    const scale = Math.min(maxW / logo.width, maxH / logo.height, 1);
    const logoW = logo.width * scale;
    const logoH = logo.height * scale;
    page.drawImage(logo.image, {
      x: 48,
      y: height - 72,
      width: logoW,
      height: logoH,
    });
    brandX = 48 + logoW + 14;
    brandY = height - 48;
    brandWidth = width - brandX - 170;
  }

  drawWrappedPdfText(safeBrand, brandX, brandY, brandWidth, 16, page, bold, palette.primary, 2);

  page.drawText(documentLabel, {
    x: width - documentLabelXOffset(documentLabel),
    y: height - 52,
    size: documentLabel.length > 8 ? 20 : 22,
    font: bold,
    color: palette.primary,
  });

  return { headerH, palette };
}

export function drawWrappedPdfText(
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  page: PDFPage,
  font: PDFFont,
  color: RGB,
  maxLines = Number.POSITIVE_INFINITY
) {
  const lineH = size + 4;
  let currentY = y;
  let drawn = 0;

  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      currentY -= lineH;
      continue;
    }

    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        line = next;
      } else {
        if (line && drawn < maxLines) {
          page.drawText(line, { x, y: currentY, size, font, color });
          drawn += 1;
          currentY -= lineH;
        }
        line = word;
      }
    }

    if (line && drawn < maxLines) {
      page.drawText(line, { x, y: currentY, size, font, color });
      drawn += 1;
      currentY -= lineH;
    }

    if (drawn >= maxLines) break;
  }

  return currentY;
}

function hexToRgb(value: string) {
  const hex = value.replace("#", "");
  const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;
  return rgb(red, green, blue);
}

async function embedLogo(pdf: PDFDocument, branding?: PdfBranding) {
  if (!branding?.logoBytes?.length) return null;

  try {
    const image =
      branding.logoMimeType === "image/jpeg"
        ? await pdf.embedJpg(branding.logoBytes)
        : await pdf.embedPng(branding.logoBytes);
    return { image, width: image.width, height: image.height };
  } catch {
    return null;
  }
}

function documentLabelXOffset(label: string) {
  if (label === "PROPOSAL") return 160;
  if (label === "QUOTE") return 135;
  return 150;
}

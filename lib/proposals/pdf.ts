import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { amountToWords, formatPounds } from "@/lib/invoices/money";
import {
  drawPdfBrandHeader,
  drawWrappedPdfText,
  type PdfBranding,
} from "@/lib/pdf/branding";

export type ProposalPdfData = {
  number: string;
  proposalDate: string;
  validUntil: string | null;
  title: string;
  scope: string;
  deliverables: string;
  timelineStart: string | null;
  timelineEnd: string | null;
  paymentTerms: string;
  clientName: string;
  freelancerName: string;
  freelancerEmail: string;
  notes: string;
  items: { description: string; quantity: number; unitPricePence: number }[];
  branding?: PdfBranding;
};

export async function createProposalPdf(data: ProposalPdfData) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
  const { palette } = await drawPdfBrandHeader({
    pdf,
    page,
    bold,
    brandName: data.freelancerName || "VibeCount",
    documentLabel: "PROPOSAL",
    branding: data.branding,
  });

  // Meta row
  let y = height - 132;
  page.drawText("Proposal number", { x: 48, y, size: 8, font: bold, color: palette.muted });
  page.drawText(data.number, { x: 48, y: y - 14, size: 11, font: bold, color: palette.primary });
  page.drawText("Date", { x: 200, y, size: 8, font: bold, color: palette.muted });
  page.drawText(formatDate(data.proposalDate), { x: 200, y: y - 14, size: 11, font, color: palette.ink });
  if (data.validUntil) {
    page.drawText("Valid until", { x: 320, y, size: 8, font: bold, color: palette.muted });
    page.drawText(formatDate(data.validUntil), { x: 320, y: y - 14, size: 11, font, color: palette.ink });
  }

  // From / To
  y -= 64;
  page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 0.5, color: palette.primary });
  page.drawText("From", { x: 48, y, size: 8, font: bold, color: palette.muted });
  drawWrappedPdfText(data.freelancerName || data.freelancerEmail || "Your business", 48, y - 14, 220, 10, page, bold, palette.primary, 2);
  page.drawText("Prepared for", { x: 320, y, size: 8, font: bold, color: palette.muted });
  drawWrappedPdfText(data.clientName, 320, y - 14, 220, 12, page, bold, palette.primary, 2);

  // Project title
  y -= 60;
  page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 0.5, color: palette.primary });
  page.drawText("Project", { x: 48, y, size: 8, font: bold, color: palette.muted });
  drawWrappedPdfText(data.title, 48, y - 14, 480, 13, page, bold, palette.primary, 2);

  // Timeline
  if (data.timelineStart || data.timelineEnd) {
    y -= 48;
    page.drawText("Timeline", { x: 48, y, size: 8, font: bold, color: palette.muted });
    const tl = [data.timelineStart ? formatDate(data.timelineStart) : null, data.timelineEnd ? formatDate(data.timelineEnd) : null]
      .filter(Boolean).join(" – ");
    page.drawText(tl, { x: 48, y: y - 14, size: 10, font, color: palette.ink });
  }

  // Scope
  if (data.scope) {
    y -= 48;
    page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 0.5, color: palette.primary });
    page.drawText("Project scope", { x: 48, y, size: 8, font: bold, color: palette.muted });
    y -= 16;
    for (const line of wrapText(data.scope, 90)) {
      if (y < 200) break;
      page.drawText(line, { x: 48, y, size: 9, font, color: palette.ink });
      y -= 13;
    }
  }

  // Deliverables
  if (data.deliverables) {
    y -= 16;
    page.drawText("Deliverables", { x: 48, y, size: 8, font: bold, color: palette.muted });
    y -= 16;
    for (const line of wrapText(data.deliverables, 90)) {
      if (y < 200) break;
      page.drawText(line, { x: 48, y, size: 9, font, color: palette.ink });
      y -= 13;
    }
  }

  // Pricing
  y -= 20;
  page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 0.5, color: palette.primary });
  page.drawText("Description", { x: 48, y, size: 8, font: bold, color: palette.muted });
  page.drawText("Qty", { x: width - 190, y, size: 8, font: bold, color: palette.muted });
  page.drawText("Amount", { x: width - 130, y, size: 8, font: bold, color: palette.muted });
  y -= 20;

  const totalPence = data.items.reduce((total, item) => {
    const lineTotal = Math.round(item.quantity * item.unitPricePence);
    drawWrappedPdfText(item.description, 48, y, 330, 10, page, font, palette.ink, 2);
    page.drawText(String(item.quantity), { x: width - 190, y, size: 10, font, color: palette.ink });
    page.drawText(formatPounds(lineTotal), { x: width - 130, y, size: 10, font: bold, color: palette.primary });
    y -= 22;
    return total + lineTotal;
  }, 0);

  y -= 10;
  page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 1, color: palette.primary });
  page.drawText("Total", { x: width - 190, y, size: 10, font: bold, color: palette.primary });
  page.drawText(formatPounds(totalPence), { x: width - 130, y, size: 16, font: bold, color: palette.primary });

  y -= 44;
  page.drawRectangle({ x: 48, y: y - 14, width: width - 96, height: 34, color: palette.accent });
  page.drawText("Amount in words", { x: 58, y: y + 5, size: 7, font: bold, color: palette.muted });
  page.drawText(capitalise(amountToWords(totalPence)), { x: 58, y: y - 8, size: 9, font, color: palette.ink });

  if (data.paymentTerms) {
    y -= 44;
    page.drawText("Payment terms", { x: 48, y, size: 8, font: bold, color: palette.muted });
    drawWrappedPdfText(data.paymentTerms, 48, y - 14, 480, 9, page, font, palette.ink, 2);
  }

  if (data.notes) {
    y -= 40;
    page.drawText("Notes", { x: 48, y, size: 8, font: bold, color: palette.muted });
    drawWrappedPdfText(data.notes, 48, y - 14, 480, 9, page, font, palette.ink, 3);
  }

  page.drawText("Generated by VibeCount — this is a proposal only. Review all details before sending.", {
    x: 48, y: 44, size: 7, font, color: palette.muted,
  });

  return pdf.save();
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(`${value}T00:00:00.000Z`));
}

function capitalise(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(" ");
    let line = "";
    for (const word of words) {
      if ((line + " " + word).trim().length > maxChars) {
        if (line) lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

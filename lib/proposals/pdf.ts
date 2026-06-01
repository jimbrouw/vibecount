import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { amountToWords, formatPounds } from "@/lib/invoices/money";

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
};

const INK = rgb(0.1, 0.23, 0.16);
const MUTED = rgb(0.29, 0.42, 0.35);
const RULE = rgb(0.85, 0.82, 0.78);
const CREAM = rgb(0.96, 0.94, 0.91);
const PALE_GREEN = rgb(0.91, 0.94, 0.92);

export async function createProposalPdf(data: ProposalPdfData) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 0, y: height - 100, width, height: 100, color: CREAM });
  page.drawText(data.freelancerName || "VibeCount", { x: 48, y: height - 58, size: 16, font: bold, color: INK });
  page.drawText("PROPOSAL", { x: width - 160, y: height - 52, size: 20, font: bold, color: INK });

  // Meta row
  let y = height - 132;
  page.drawText("Proposal number", { x: 48, y, size: 8, font: bold, color: MUTED });
  page.drawText(data.number, { x: 48, y: y - 14, size: 11, font: bold, color: INK });
  page.drawText("Date", { x: 200, y, size: 8, font: bold, color: MUTED });
  page.drawText(formatDate(data.proposalDate), { x: 200, y: y - 14, size: 11, font, color: INK });
  if (data.validUntil) {
    page.drawText("Valid until", { x: 320, y, size: 8, font: bold, color: MUTED });
    page.drawText(formatDate(data.validUntil), { x: 320, y: y - 14, size: 11, font, color: INK });
  }

  // From / To
  y -= 64;
  page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 0.5, color: RULE });
  page.drawText("From", { x: 48, y, size: 8, font: bold, color: MUTED });
  page.drawText(data.freelancerName || data.freelancerEmail || "Your business", { x: 48, y: y - 14, size: 10, font: bold, color: INK });
  page.drawText("Prepared for", { x: 320, y, size: 8, font: bold, color: MUTED });
  page.drawText(data.clientName, { x: 320, y: y - 14, size: 12, font: bold, color: INK });

  // Project title
  y -= 60;
  page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 0.5, color: RULE });
  page.drawText("Project", { x: 48, y, size: 8, font: bold, color: MUTED });
  page.drawText(data.title.slice(0, 80), { x: 48, y: y - 14, size: 13, font: bold, color: INK });

  // Timeline
  if (data.timelineStart || data.timelineEnd) {
    y -= 48;
    page.drawText("Timeline", { x: 48, y, size: 8, font: bold, color: MUTED });
    const tl = [data.timelineStart ? formatDate(data.timelineStart) : null, data.timelineEnd ? formatDate(data.timelineEnd) : null]
      .filter(Boolean).join(" – ");
    page.drawText(tl, { x: 48, y: y - 14, size: 10, font, color: INK });
  }

  // Scope
  if (data.scope) {
    y -= 48;
    page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 0.5, color: RULE });
    page.drawText("Project scope", { x: 48, y, size: 8, font: bold, color: MUTED });
    y -= 16;
    for (const line of wrapText(data.scope, 90)) {
      if (y < 200) break;
      page.drawText(line, { x: 48, y, size: 9, font, color: INK });
      y -= 13;
    }
  }

  // Deliverables
  if (data.deliverables) {
    y -= 16;
    page.drawText("Deliverables", { x: 48, y, size: 8, font: bold, color: MUTED });
    y -= 16;
    for (const line of wrapText(data.deliverables, 90)) {
      if (y < 200) break;
      page.drawText(line, { x: 48, y, size: 9, font, color: INK });
      y -= 13;
    }
  }

  // Pricing
  y -= 20;
  page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 0.5, color: RULE });
  page.drawText("Description", { x: 48, y, size: 8, font: bold, color: MUTED });
  page.drawText("Qty", { x: width - 190, y, size: 8, font: bold, color: MUTED });
  page.drawText("Amount", { x: width - 130, y, size: 8, font: bold, color: MUTED });
  y -= 20;

  const totalPence = data.items.reduce((total, item) => {
    const lineTotal = Math.round(item.quantity * item.unitPricePence);
    page.drawText(item.description.slice(0, 60), { x: 48, y, size: 10, font, color: INK });
    page.drawText(String(item.quantity), { x: width - 190, y, size: 10, font, color: INK });
    page.drawText(formatPounds(lineTotal), { x: width - 130, y, size: 10, font: bold, color: INK });
    y -= 22;
    return total + lineTotal;
  }, 0);

  y -= 10;
  page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 1, color: INK });
  page.drawText("Total", { x: width - 190, y, size: 10, font: bold, color: INK });
  page.drawText(formatPounds(totalPence), { x: width - 130, y, size: 16, font: bold, color: INK });

  y -= 44;
  page.drawRectangle({ x: 48, y: y - 14, width: width - 96, height: 34, color: PALE_GREEN });
  page.drawText("Amount in words", { x: 58, y: y + 5, size: 7, font: bold, color: MUTED });
  page.drawText(capitalise(amountToWords(totalPence)), { x: 58, y: y - 8, size: 9, font, color: INK });

  if (data.paymentTerms) {
    y -= 44;
    page.drawText("Payment terms", { x: 48, y, size: 8, font: bold, color: MUTED });
    page.drawText(data.paymentTerms, { x: 48, y: y - 14, size: 9, font, color: INK });
  }

  if (data.notes) {
    y -= 40;
    page.drawText("Notes", { x: 48, y, size: 8, font: bold, color: MUTED });
    page.drawText(data.notes.slice(0, 180), { x: 48, y: y - 14, size: 9, font, color: INK });
  }

  page.drawText("Generated by VibeCount — this is a proposal only. Review all details before sending.", {
    x: 48, y: 44, size: 7, font, color: MUTED,
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

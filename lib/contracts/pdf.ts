import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { amountToWords, formatPounds } from "@/lib/invoices/money";

export type ContractPdfData = {
  number: string;
  contractDate: string;
  title: string;
  scope: string;
  deliverables: string;
  timelineStart: string | null;
  timelineEnd: string | null;
  paymentTerms: string;
  totalPence: number;
  customTerms: string;
  clientName: string;
  freelancerName: string;
  freelancerEmail: string;
  status: string;
};

const INK = rgb(0.1, 0.23, 0.16);
const MUTED = rgb(0.29, 0.42, 0.35);
const RULE = rgb(0.85, 0.82, 0.78);
const CREAM = rgb(0.96, 0.94, 0.91);
const PALE_GREEN = rgb(0.91, 0.94, 0.92);

const DEFAULT_TERMS = [
  "1. This contract is between the freelancer and the client named above.",
  "2. Work begins on the timeline start date, or on written agreement.",
  "3. Payment is due as stated in the payment terms. Late payment may incur interest.",
  "4. Either party may terminate with 14 days written notice before work begins.",
  "5. Intellectual property transfers to the client on receipt of full payment.",
  "6. The freelancer retains the right to show the work in their portfolio.",
  "7. This agreement is governed by the laws of England and Wales.",
];

export async function createContractPdf(data: ContractPdfData) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 0, y: height - 100, width, height: 100, color: CREAM });
  page.drawText(data.freelancerName || "VibeCount", { x: 48, y: height - 58, size: 16, font: bold, color: INK });
  page.drawText("CONTRACT", { x: width - 160, y: height - 52, size: 20, font: bold, color: INK });

  let y = height - 132;
  page.drawText("Contract number", { x: 48, y, size: 8, font: bold, color: MUTED });
  page.drawText(data.number, { x: 48, y: y - 14, size: 11, font: bold, color: INK });
  page.drawText("Date", { x: 200, y, size: 8, font: bold, color: MUTED });
  page.drawText(formatDate(data.contractDate), { x: 200, y: y - 14, size: 11, font, color: INK });
  page.drawText("Status", { x: 360, y, size: 8, font: bold, color: MUTED });
  page.drawText(data.status.toUpperCase(), { x: 360, y: y - 14, size: 11, font: bold, color: INK });

  y -= 60;
  page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 0.5, color: RULE });
  page.drawText("Between", { x: 48, y, size: 8, font: bold, color: MUTED });
  page.drawText(data.freelancerName || data.freelancerEmail || "Freelancer", { x: 48, y: y - 14, size: 11, font: bold, color: INK });
  page.drawText("And", { x: 320, y, size: 8, font: bold, color: MUTED });
  page.drawText(data.clientName, { x: 320, y: y - 14, size: 11, font: bold, color: INK });

  y -= 56;
  page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 0.5, color: RULE });
  page.drawText("Project", { x: 48, y, size: 8, font: bold, color: MUTED });
  page.drawText(data.title.slice(0, 80), { x: 48, y: y - 14, size: 13, font: bold, color: INK });

  if (data.timelineStart || data.timelineEnd) {
    y -= 44;
    page.drawText("Timeline", { x: 48, y, size: 8, font: bold, color: MUTED });
    const tl = [data.timelineStart ? formatDate(data.timelineStart) : null, data.timelineEnd ? formatDate(data.timelineEnd) : null]
      .filter(Boolean).join(" – ");
    page.drawText(tl, { x: 48, y: y - 14, size: 10, font, color: INK });
  }

  if (data.scope) {
    y -= 44;
    page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 0.5, color: RULE });
    page.drawText("Scope of work", { x: 48, y, size: 8, font: bold, color: MUTED });
    y -= 16;
    for (const line of wrapText(data.scope, 90)) {
      if (y < 250) break;
      page.drawText(line, { x: 48, y, size: 9, font, color: INK });
      y -= 13;
    }
  }

  if (data.deliverables) {
    y -= 14;
    page.drawText("Deliverables", { x: 48, y, size: 8, font: bold, color: MUTED });
    y -= 16;
    for (const line of wrapText(data.deliverables, 90)) {
      if (y < 250) break;
      page.drawText(line, { x: 48, y, size: 9, font, color: INK });
      y -= 13;
    }
  }

  y -= 14;
  page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 0.5, color: RULE });
  page.drawText("Total fee", { x: 48, y, size: 8, font: bold, color: MUTED });
  page.drawText(formatPounds(data.totalPence), { x: 48, y: y - 16, size: 16, font: bold, color: INK });
  page.drawText("Payment terms", { x: 300, y, size: 8, font: bold, color: MUTED });
  page.drawText(data.paymentTerms, { x: 300, y: y - 14, size: 9, font, color: INK });

  y -= 44;
  page.drawRectangle({ x: 48, y: y - 14, width: width - 96, height: 34, color: PALE_GREEN });
  page.drawText("Amount in words", { x: 58, y: y + 5, size: 7, font: bold, color: MUTED });
  page.drawText(capitalise(amountToWords(data.totalPence)), { x: 58, y: y - 8, size: 9, font, color: INK });

  // Terms
  y -= 48;
  page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 0.5, color: RULE });
  page.drawText("Terms and conditions", { x: 48, y, size: 8, font: bold, color: MUTED });
  y -= 16;
  const terms = data.customTerms
    ? wrapText(data.customTerms, 90)
    : DEFAULT_TERMS;
  for (const line of terms) {
    if (y < 160) break;
    page.drawText(line, { x: 48, y, size: 8, font, color: INK });
    y -= 12;
  }

  // Signature blocks
  y = 130;
  page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 0.5, color: RULE });
  page.drawText("Freelancer signature", { x: 48, y, size: 8, font: bold, color: MUTED });
  page.drawText("Client signature", { x: 320, y, size: 8, font: bold, color: MUTED });
  page.drawLine({ start: { x: 48, y: y - 30 }, end: { x: 240, y: y - 30 }, thickness: 0.5, color: RULE });
  page.drawLine({ start: { x: 320, y: y - 30 }, end: { x: width - 48, y: y - 30 }, thickness: 0.5, color: RULE });
  page.drawText(data.freelancerName || "Freelancer", { x: 48, y: y - 44, size: 8, font, color: MUTED });
  page.drawText(data.clientName, { x: 320, y: y - 44, size: 8, font, color: MUTED });
  page.drawText("Date: ______________", { x: 48, y: y - 56, size: 8, font, color: MUTED });
  page.drawText("Date: ______________", { x: 320, y: y - 56, size: 8, font, color: MUTED });

  page.drawText("Generated by VibeCount. This is a draft contract — have it reviewed before signing.", {
    x: 48, y: 20, size: 7, font, color: MUTED,
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

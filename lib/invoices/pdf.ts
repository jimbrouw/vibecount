import { PDFDocument, PDFPage, PDFFont, RGB, StandardFonts, rgb } from "pdf-lib";
import { amountToWords, formatPounds } from "./money";

export type InvoicePdfData = {
  number: string;
  invoiceDate: string;
  clientName: string;
  description: string;
  amountPence: number;
  vatPence: number;
  paymentTerms: string;
  freelancerEmail: string;
  freelancerName: string;
  freelancerAddress: string;
  freelancerContact: string;
  bankDetails: string;
  vatNumber: string;
  vatRate: number | null;
  latePaymentWording: string;
};

const INK = rgb(0.1, 0.23, 0.16);
const MUTED = rgb(0.29, 0.42, 0.35);
const LIGHT = rgb(0.47, 0.6, 0.53);
const RULE = rgb(0.85, 0.82, 0.78);
const CREAM = rgb(0.96, 0.94, 0.91);
const PALE_GREEN = rgb(0.91, 0.94, 0.92);

export async function createInvoicePdf(data: InvoicePdfData) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // White background
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });

  // Header bar — cream
  const headerH = 100;
  page.drawRectangle({ x: 0, y: height - headerH, width, height: headerH, color: CREAM });

  // Brand name
  const brand = data.freelancerName || "VibeCount";
  page.drawText(brand, {
    x: 48,
    y: height - 58,
    size: 16,
    font: bold,
    color: INK,
  });

  // "INVOICE" label
  page.drawText("INVOICE", {
    x: width - 150,
    y: height - 52,
    size: 22,
    font: bold,
    color: INK,
  });

  // Invoice number below header
  let y = height - headerH - 32;

  page.drawText("Invoice number", { x: 48, y, size: 8, font: bold, color: MUTED });
  page.drawText(data.number, { x: 48, y: y - 14, size: 11, font: bold, color: INK });

  page.drawText("Date", { x: 200, y, size: 8, font: bold, color: MUTED });
  page.drawText(formatDate(data.invoiceDate), {
    x: 200,
    y: y - 14,
    size: 11,
    font,
    color: INK,
  });

  // From / To columns
  y -= 56;
  page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 0.5, color: RULE });

  // From column
  page.drawText("From", { x: 48, y, size: 8, font: bold, color: MUTED });
  let fromY = y - 14;

  if (data.freelancerName) {
    page.drawText(data.freelancerName, { x: 48, y: fromY, size: 10, font: bold, color: INK });
    fromY -= 14;
  }
  if (data.freelancerAddress) {
    fromY = drawSmallWrappedText(data.freelancerAddress, 48, fromY, 220, 9, page, font, INK);
  }
  if (data.freelancerContact) {
    page.drawText(data.freelancerContact, { x: 48, y: fromY, size: 9, font, color: LIGHT });
    fromY -= 12;
  }
  if (!data.freelancerName && data.freelancerEmail) {
    page.drawText(data.freelancerEmail, { x: 48, y: fromY, size: 9, font, color: LIGHT });
  }
  if (data.vatNumber) {
    page.drawText(`VAT reg: ${data.vatNumber}`, {
      x: 48,
      y: fromY - 2,
      size: 8,
      font,
      color: LIGHT,
    });
  }

  // To column
  page.drawText("To", { x: 320, y, size: 8, font: bold, color: MUTED });
  page.drawText(data.clientName, { x: 320, y: y - 14, size: 12, font: bold, color: INK });

  // Description section
  y -= 100;
  page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 0.5, color: RULE });

  page.drawText("Description", { x: 48, y, size: 8, font: bold, color: MUTED });
  page.drawText("Amount", { x: width - 130, y, size: 8, font: bold, color: MUTED });

  y -= 18;
  const descBottomY = drawSmallWrappedText(data.description, 48, y, 340, 10, page, font, INK);

  page.drawText(formatPounds(data.amountPence), {
    x: width - 130,
    y,
    size: 12,
    font: bold,
    color: INK,
  });

  // VAT line if applicable
  y = Math.min(descBottomY, y) - 10;
  if (data.vatPence > 0 && data.vatRate) {
    y -= 8;
    page.drawLine({ start: { x: width - 180, y: y + 8 }, end: { x: width - 48, y: y + 8 }, thickness: 0.5, color: RULE });
    page.drawText(`VAT (${data.vatRate}%)`, { x: width - 180, y, size: 9, font, color: MUTED });
    page.drawText(formatPounds(data.vatPence), { x: width - 130, y, size: 9, font, color: MUTED });
    y -= 16;
  }

  // Total line
  y -= 16;
  page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 1, color: INK });

  const totalPence = data.amountPence + data.vatPence;
  page.drawText("Total", { x: width - 180, y, size: 10, font: bold, color: INK });
  page.drawText(formatPounds(totalPence), { x: width - 130, y, size: 16, font: bold, color: INK });

  // Amount in words
  y -= 40;
  page.drawRectangle({
    x: 48,
    y: y - 14,
    width: width - 96,
    height: 34,
    color: PALE_GREEN,
  });
  page.drawText("Amount in words", { x: 58, y: y + 5, size: 7, font: bold, color: MUTED });
  page.drawText(capitalise(amountToWords(totalPence)), { x: 58, y: y - 8, size: 9, font, color: INK });

  // Payment terms
  y -= 56;
  page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 0.5, color: RULE });
  page.drawText("Payment terms", { x: 48, y, size: 8, font: bold, color: MUTED });
  y -= 14;
  drawSmallWrappedText(data.paymentTerms, 48, y, 480, 9, page, font, INK);

  // Bank details block
  if (data.bankDetails) {
    y -= 52;
    page.drawText("Payment details", { x: 48, y, size: 8, font: bold, color: MUTED });
    y -= 14;
    drawSmallWrappedText(data.bankDetails, 48, y, 480, 9, page, font, INK);
  }

  // Footer
  const footerY = 56;
  page.drawLine({ start: { x: 48, y: footerY + 16 }, end: { x: width - 48, y: footerY + 16 }, thickness: 0.5, color: RULE });

  const lateWording =
    data.latePaymentWording ||
    "Payment is due within 30 days of the invoice date. We reserve the right to charge statutory interest at 8% above the Bank of England base rate, plus statutory debt recovery costs, under the Late Payment of Commercial Debts (Interest) Act 1998.";
  drawSmallWrappedText(lateWording, 48, footerY + 4, 380, 7.5, page, font, LIGHT);

  page.drawText("Generated by VibeCount — check all details before sending.", {
    x: 48,
    y: footerY - 12,
    size: 7,
    font,
    color: LIGHT,
  });

  return pdf.save();
}

function drawSmallWrappedText(
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  page: PDFPage,
  font: PDFFont,
  color: RGB
): number {
  const lineH = size + 4;
  // Split on literal \n first, then word-wrap each paragraph
  const paragraphs = text.split(/\r?\n/);
  let currentY = y;
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
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
        if (line) {
          page.drawText(line, { x, y: currentY, size, font, color });
          currentY -= lineH;
        }
        line = word;
      }
    }
    if (line) {
      page.drawText(line, { x, y: currentY, size, font, color });
      currentY -= lineH;
    }
  }
  return currentY;
}

function capitalise(s: string) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(`${value}T00:00:00.000Z`));
  } catch {
    return value;
  }
}

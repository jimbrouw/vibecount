import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  drawPdfBrandHeader,
  drawWrappedPdfText,
  type PdfBranding,
} from "@/lib/pdf/branding";
import { amountToWords, formatPounds } from "./money";

export type InvoicePdfData = {
  number: string;
  invoiceDate: string;
  clientName: string;
  clientAddress: string;
  clientVatNumber: string;
  description: string;
  amountPence: number;
  vatPence: number;
  paymentTerms: string;
  freelancerEmail: string;
  freelancerName: string;
  freelancerAddress: string;
  freelancerContact: string;
  bankDetails: string;
  paymentLinkProvider: string;
  paymentLinkUrl: string;
  vatNumber: string;
  vatRate: number | null;
  latePaymentWording: string;
  branding?: PdfBranding;
};

export async function createInvoicePdf(data: InvoicePdfData) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // White background
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });

  const { headerH, palette } = await drawPdfBrandHeader({
    pdf,
    page,
    bold,
    brandName: data.freelancerName || "VibeCount",
    documentLabel: "INVOICE",
    branding: data.branding,
  });

  // Invoice number below header
  let y = height - headerH - 32;

  page.drawText("Invoice number", { x: 48, y, size: 8, font: bold, color: palette.muted });
  page.drawText(data.number, { x: 48, y: y - 14, size: 11, font: bold, color: palette.primary });

  page.drawText("Date", { x: 200, y, size: 8, font: bold, color: palette.muted });
  page.drawText(formatDate(data.invoiceDate), {
    x: 200,
    y: y - 14,
    size: 11,
    font,
    color: palette.ink,
  });

  // From / To columns
  y -= 56;
  page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 0.5, color: palette.primary });

  // From column
  page.drawText("From", { x: 48, y, size: 8, font: bold, color: palette.muted });
  let fromY = y - 14;

  if (data.freelancerName) {
    page.drawText(data.freelancerName, { x: 48, y: fromY, size: 10, font: bold, color: palette.primary });
    fromY -= 14;
  }
  if (data.freelancerAddress) {
    fromY = drawWrappedPdfText(data.freelancerAddress, 48, fromY, 220, 9, page, font, palette.ink);
  }
  if (data.freelancerContact) {
    fromY = drawWrappedPdfText(data.freelancerContact, 48, fromY, 220, 8, page, font, palette.light);
  }
  if (!data.freelancerName && data.freelancerEmail) {
    page.drawText(data.freelancerEmail, { x: 48, y: fromY, size: 9, font, color: palette.light });
    fromY -= 12;
  }
  if (data.vatNumber) {
    page.drawText(`VAT reg: ${data.vatNumber}`, {
      x: 48,
      y: fromY - 2,
      size: 8,
      font,
      color: palette.light,
    });
    fromY -= 12;
  }

  // To column
  page.drawText("To", { x: 320, y, size: 8, font: bold, color: palette.muted });
  page.drawText(data.clientName, { x: 320, y: y - 14, size: 12, font: bold, color: palette.primary });

  // Client address (if provided)
  let clientDetailY = y - 30;
  if (data.clientAddress) {
    const addressLines = data.clientAddress.split(/[,\n]/).map((l) => l.trim()).filter(Boolean).slice(0, 4);
    for (const line of addressLines) {
      page.drawText(line, { x: 320, y: clientDetailY, size: 8, font, color: palette.muted });
      clientDetailY -= 11;
    }
  }
  if (data.clientVatNumber) {
    page.drawText(`VAT no: ${data.clientVatNumber}`, { x: 320, y: clientDetailY, size: 8, font, color: palette.muted });
    clientDetailY -= 11;
  }

  // Description section starts below the taller From/To column.
  y = Math.min(fromY, clientDetailY) - 30;
  page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 0.5, color: palette.primary });

  page.drawText("Description", { x: 48, y, size: 8, font: bold, color: palette.muted });
  page.drawText("Amount", { x: width - 130, y, size: 8, font: bold, color: palette.muted });

  y -= 18;
  const descBottomY = drawWrappedPdfText(data.description, 48, y, 340, 10, page, font, palette.ink);

  page.drawText(formatPounds(data.amountPence), {
    x: width - 130,
    y,
    size: 12,
    font: bold,
    color: palette.primary,
  });

  // VAT line if applicable
  y = Math.min(descBottomY, y) - 10;
  if (data.vatPence > 0 && data.vatRate) {
    y -= 8;
    page.drawLine({ start: { x: width - 180, y: y + 8 }, end: { x: width - 48, y: y + 8 }, thickness: 0.5, color: palette.primary });
    page.drawText(`VAT (${data.vatRate}%)`, { x: width - 180, y, size: 9, font, color: palette.muted });
    page.drawText(formatPounds(data.vatPence), { x: width - 130, y, size: 9, font, color: palette.muted });
    y -= 16;
  }

  // Total line
  y -= 16;
  page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 1, color: palette.primary });

  const totalPence = data.amountPence + data.vatPence;
  page.drawText("Total", { x: width - 180, y, size: 10, font: bold, color: palette.primary });
  page.drawText(formatPounds(totalPence), { x: width - 130, y, size: 16, font: bold, color: palette.primary });

  // Amount in words
  y -= 40;
  page.drawRectangle({
    x: 48,
    y: y - 14,
    width: width - 96,
    height: 34,
    color: palette.accent,
  });
  page.drawText("Amount in words", { x: 58, y: y + 5, size: 7, font: bold, color: palette.muted });
  page.drawText(capitalise(amountToWords(totalPence)), { x: 58, y: y - 8, size: 9, font, color: palette.ink });

  // Payment terms
  y -= 56;
  page.drawLine({ start: { x: 48, y: y + 12 }, end: { x: width - 48, y: y + 12 }, thickness: 0.5, color: palette.primary });
  page.drawText("Payment terms", { x: 48, y, size: 8, font: bold, color: palette.muted });
  y -= 14;
  y = drawWrappedPdfText(data.paymentTerms, 48, y, 480, 9, page, font, palette.ink);

  // Bank details block
  if (data.bankDetails) {
    y -= 18;
    page.drawText("Payment details", { x: 48, y, size: 8, font: bold, color: palette.muted });
    y -= 14;
    y = drawWrappedPdfText(data.bankDetails, 48, y, 480, 9, page, font, palette.ink);
  }

  if (data.paymentLinkUrl) {
    y -= 18;
    const provider = paymentProviderLabel(data.paymentLinkProvider);
    page.drawText("Pay online", { x: 48, y, size: 8, font: bold, color: palette.muted });
    y -= 14;
    y = drawWrappedPdfText(`${provider}: ${data.paymentLinkUrl}`, 48, y, 480, 9, page, font, palette.ink);
  }

  // Footer
  const footerY = 56;
  page.drawLine({ start: { x: 48, y: footerY + 16 }, end: { x: width - 48, y: footerY + 16 }, thickness: 0.5, color: palette.primary });

  const lateWording =
    data.latePaymentWording ||
    "Payment is due within 30 days of the invoice date. We reserve the right to charge statutory interest at 8% above the Bank of England base rate, plus statutory debt recovery costs, under the Late Payment of Commercial Debts (Interest) Act 1998.";
  drawWrappedPdfText(lateWording, 48, footerY + 6, 430, 7, page, font, palette.light);

  page.drawText("Generated by VibeCount — check all details before sending.", {
    x: 48,
    y: 24,
    size: 7,
    font,
    color: palette.light,
  });

  return pdf.save();
}

function capitalise(s: string) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function paymentProviderLabel(provider: string) {
  if (provider === "sumup") return "SumUp";
  if (provider === "stripe") return "Stripe Checkout";
  if (provider === "paypal") return "PayPal";
  return "Payment link";
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

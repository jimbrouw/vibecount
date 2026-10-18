import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatPounds, amountToWords } from "./money";
export type CreditDocument = {
  number: string;
  creditDate: string;
  invoiceNumber: string;
  invoiceDate: string;
  sellerName: string;
  sellerAddress: string;
  clientName: string;
  clientAddress: string;
  description: string;
  reason: string;
  grossPence: number;
  netPence: number | null;
  vatPence: number | null;
  vatRateBps: number | null;
  vatNumber: string;
  taxStatus: "invoice_snapshot" | "unverified";
  reviewHash: string;
};
export async function createCreditPdf(data: CreditDocument) {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595.28, 841.89]),
    y = 790;
  function line(text: string, strong = false, size = 11) {
    const f = strong ? bold : font;
    let buffer = "";
    for (const c of text) {
      if (c === "\n" || f.widthOfTextAtSize(buffer + c, size) > 490) {
        if (y < 55) {
          page = pdf.addPage([595.28, 841.89]);
          y = 790;
        }
        page.drawText(buffer, {
          x: 48,
          y,
          size,
          font: f,
          color: rgb(0.08, 0.18, 0.12),
        });
        y -= size + 5;
        buffer = c === "\n" ? "" : c;
      } else buffer += c;
    }
    if (buffer) {
      if (y < 55) {
        page = pdf.addPage([595.28, 841.89]);
        y = 790;
      }
      page.drawText(buffer, {
        x: 48,
        y,
        size,
        font: f,
        color: rgb(0.08, 0.18, 0.12),
      });
      y -= size + 5;
    }
    y -= 5;
  }
  line("Draft credit note - not sent", true, 20);
  line(data.number, true);
  line("Credit date: " + data.creditDate);
  line(
    "Original invoice: " + data.invoiceNumber + " dated " + data.invoiceDate,
  );
  line("Supplier: " + data.sellerName, true);
  line(data.sellerAddress);
  if (data.vatNumber) line("Original VAT registration: " + data.vatNumber);
  line("Customer: " + data.clientName, true);
  line(data.clientAddress);
  line("Supply / quantity: 1 invoice adjustment");
  line(data.description);
  line("Reason: " + data.reason);
  if (data.taxStatus === "invoice_snapshot") {
    line("Net credit: " + formatPounds(data.netPence!));
    line(amountToWords(data.netPence!));
    line(
      "VAT credit: " +
        formatPounds(data.vatPence!) +
        " at " +
        (data.vatRateBps ?? 0) / 100 +
        "% (allocated from original invoice economics)",
    );
    line(amountToWords(data.vatPence!));
  } else {
    line("This is not a credit note for VAT", true);
    line(
      "The original net/VAT breakdown is unverified. This records a commercial credit only; tax review remains unresolved.",
    );
  }
  line("Total credit: " + formatPounds(data.grossPence), true, 16);
  line(amountToWords(data.grossPence));
  line(
    "This reduces invoice entitlement. It does not record or initiate a cash refund.",
  );
  line(
    "Review issue details and tax treatment before sending. No filing or payment has been made.",
  );
  return pdf.save();
}

import assert from "node:assert/strict";
import test from "node:test";
import { createInvoicePdf } from "@/lib/invoices/pdf";
import { createProposalPdf } from "@/lib/proposals/pdf";
import { createQuotePdf } from "@/lib/quotes/pdf";
import type { PdfBranding } from "./branding.ts";

const logoBytes = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==",
    "base64"
  )
);

test("invoice PDF renders with default text-only branding", async () => {
  const bytes = await createInvoicePdf(invoiceData());

  assertPdf(bytes);
});

test("invoice, quote, and proposal PDFs render with shared logo and colour branding", async () => {
  const branding: PdfBranding = {
    primaryColor: "#0055aa",
    accentColor: "#ffeecc",
    logoBytes,
    logoMimeType: "image/png",
  };

  const [invoice, quote, proposal] = await Promise.all([
    createInvoicePdf(invoiceData(branding)),
    createQuotePdf({
      number: "Q-001",
      quoteDate: "2026-06-01",
      validUntil: "2026-07-01",
      clientName: "Sample Client Ltd",
      freelancerName: longBusinessName,
      freelancerEmail: "hello@example.com",
      freelancerAddress: "",
      freelancerContact: "",
      notes: "Prepared for review before sending.",
      items: [{ description: "Brand strategy", quantity: 1, unitPricePence: 125000 }],
      branding,
    }),
    createProposalPdf({
      number: "P-001",
      proposalDate: "2026-06-01",
      validUntil: "2026-07-01",
      title: "A carefully scoped creative project with a long title",
      scope: "Discovery, design direction, and final delivery.",
      deliverables: "One proposal pack and one production-ready asset set.",
      timelineStart: "2026-06-10",
      timelineEnd: "2026-07-10",
      paymentTerms: "Payment due within 30 days",
      clientName: "Sample Client Ltd",
      freelancerName: longBusinessName,
      freelancerEmail: "hello@example.com",
      notes: "Review before sending.",
      items: [{ description: "Project delivery", quantity: 1, unitPricePence: 250000 }],
      branding,
    }),
  ]);

  assertPdf(invoice);
  assertPdf(quote);
  assertPdf(proposal);
});

const longBusinessName =
  "A Very Long Business Name That Should Wrap Cleanly In A Branded PDF Header";

function invoiceData(branding?: PdfBranding) {
  return {
    number: "INV-001",
    invoiceDate: "2026-06-01",
    clientName: "Sample Client Ltd",
    clientAddress: "1 Example Street\nManchester\nM1 1AA",
    clientVatNumber: "",
    description: "Creative direction and production support",
    amountPence: 125000,
    vatPence: 0,
    paymentTerms: "Payment due within 30 days",
    freelancerEmail: "hello@example.com",
    freelancerName: longBusinessName,
    freelancerAddress: "2 Studio Yard\nLondon",
    freelancerContact: "Email: hello@example.com",
    bankDetails: "Account name: Example Studio\nSort code: 00-00-00\nAccount number: 12345678",
    paymentLinkProvider: "",
    paymentLinkUrl: "",
    vatNumber: "",
    vatRate: null,
    latePaymentWording: "",
    branding,
  };
}

function assertPdf(bytes: Uint8Array) {
  assert.equal(Buffer.from(bytes).subarray(0, 4).toString(), "%PDF");
  assert.ok(bytes.length > 1000);
}

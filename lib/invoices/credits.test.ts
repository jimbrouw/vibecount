import assert from "node:assert/strict";
import test from "node:test";
import { creditReview, invoiceBalance, type CreditBalance } from "./credits.ts";
import { createCreditPdf, type CreditDocument } from "./credit-pdf.ts";
import { reconciliationExport } from "../records/reconciliation-export.ts";
import { readSourceCsv } from "../records/source-csv.ts";
import { PDFParse } from "pdf-parse";
const invoice: CreditBalance = {
  id: "invoice",
  number: "SYNTHETIC-120",
  invoice_date: "2026-04-05",
  status: "finalised",
  currency: "GBP",
  updated_at: "2026-04-05",
  invoice_pence: 12000,
  allocated_pence: 12000,
  outstanding_pence: 0,
  credited_pence: 0,
  entitlement_pence: 12000,
  refund_due_pence: 0,
  net_pence: 10000,
  vat_pence: 2000,
  credited_net_pence: 0,
  credited_vat_pence: 0,
  vat_rate_bps: 2000,
  vat_number_snapshot: "GB-SYNTHETIC",
  economics_version: 1,
  balance_stamp: "a".repeat(32),
};
test("credit balance distinguishes entitlement, receipts, returned cash and unresolved legacy VAT", () => {
  const review = creditReview(invoice, 3000, "2026-04-06", "2026-10-17");
  assert.equal(review.net, 2500);
  assert.equal(review.vat, 500);
  assert.equal(review.after.refundDue, 3000);
  assert.equal(review.after.outstanding, 0);
  assert.equal(invoiceBalance(12000, 3000, 12000, 3000).state, "settled");
  assert.equal(invoiceBalance(12000, 12000, 0).state, "fully_credited");
  assert.equal(invoiceBalance(12000, 3000, 2500).outstanding, 6500);
  assert.throws(() => invoiceBalance(100, 101, 0));
  assert.throws(() => invoiceBalance(100, 0, 10, 11));
  for (const date of ["2026-04-04", "2026-02-30", "2026-10-18"])
    assert.throws(() => creditReview(invoice, 1, date, "2026-10-17"));
  assert.throws(() => creditReview(invoice, 12001, "2026-04-06", "2026-10-17"));
  const legacy = creditReview(
    { ...invoice, net_pence: null, vat_pence: null, economics_version: 0 },
    3000,
    "2026-04-06",
    "2026-10-17",
  );
  assert.equal(legacy.known, false);
  assert.equal(legacy.net, null);
  assert.equal(legacy.vat, null);
  let gross = 0,
    net = 0,
    vat = 0;
  for (let i = 0; i < 12000; i++) {
    const r = creditReview(
      {
        ...invoice,
        credited_pence: gross,
        credited_net_pence: net,
        credited_vat_pence: vat,
      },
      1,
      "2026-04-06",
      "2026-10-17",
    );
    gross++;
    net += r.net!;
    vat += r.vat!;
  }
  assert.equal(net, 10000);
  assert.equal(vat, 2000);
});
test("preserved credit PDFs retain full multi-page rationale and explicit figures, words and VAT uncertainty", async () => {
  const doc: CreditDocument = {
    number: "CN-SYNTHETIC-120-001",
    creditDate: "2026-04-06",
    invoiceNumber: invoice.number,
    invoiceDate: invoice.invoice_date,
    sellerName: "Synthetic supplier",
    sellerAddress: "Synthetic address ".repeat(58),
    clientName: "Synthetic customer",
    clientAddress: "Synthetic address ".repeat(58),
    description: "Synthetic supply ".repeat(58),
    reason: "Reason ".repeat(140) + "END-OF-REASON",
    grossPence: 3000,
    netPence: 2500,
    vatPence: 500,
    vatRateBps: 2000,
    vatNumber: "GB-SYNTHETIC",
    taxStatus: "invoice_snapshot",
    reviewHash: "b".repeat(64),
  };
  async function text(data: CreditDocument) {
    const parser = new PDFParse({ data: await createCreditPdf(data) });
    try {
      return await parser.getText();
    } finally {
      await parser.destroy();
    }
  }
  const known = await text(doc);
  assert.match(known.text, /twenty-five pounds/);
  assert.match(known.text, /five pounds/);
  assert.ok(known.text.replace(/\s/g, "").includes("END-OF-REASON"));
  assert.ok(known.total > 1);
  assert.match(known.text, /not sent/);
  const legacy = await text({
    ...doc,
    taxStatus: "unverified",
    netPence: null,
    vatPence: null,
    vatNumber: "",
  });
  assert.match(legacy.text, /This is not a credit note for VAT/);
  assert.doesNotMatch(legacy.text, /Net credit:/);
});
test("reconciliation export preserves credit/reversal hashes and explicit zero accounting effects", () => {
  const note = {
    id: "credit",
    invoice_id: invoice.id,
    number: "CN-SYNTHETIC-120-001",
    credit_date: "2026-04-06",
    gross_pence: 3000,
    net_pence: 2500,
    vat_pence: 500,
    tax_status: "invoice_snapshot",
    pdf_sha256: "b".repeat(64),
    invoice_snapshot: {
      number: invoice.number,
      revision_id: "revision",
      pdf_sha256: "c".repeat(64),
    },
    author: "owner",
    rationale: "=unsafe",
    request_id: "request",
    created_at: "2026-04-06",
  };
  const csv = reconciliationExport(
    [],
    [],
    [
      {
        ...invoice,
        delivery_status: "not_sent",
        credited_pence: 3000,
        entitlement_pence: 9000,
        refund_due_pence: 3000,
        retained_cash_pence: 12000,
      },
    ],
    [],
    [],
    [],
    [],
    [note],
    [
      {
        id: "reverse",
        credit_id: note.id,
        author: "owner",
        rationale: "Correction",
        request_id: "request2",
        created_at: "2026-04-07",
      },
    ],
  ).csv;
  const [header, ...rows] = readSourceCsv(csv);
  const col = (key: string) => header.indexOf(key);
  assert.ok(rows.every((r) => r.length === header.length));
  assert.equal(rows[0][col("cash_to_reconcile_pence")], "3000");
  assert.equal(rows[1][col("commercial_credit_effect_pence")], "3000");
  assert.equal(rows[2][col("commercial_credit_effect_pence")], "-3000");
  assert.equal(rows[1][col("credit_accounting_effect_pence")], "0");
  assert.equal(rows[2][col("credit_accounting_effect_pence")], "0");
  assert.equal(rows[1][col("original_revision_id")], "revision");
  assert.equal(rows[1][col("credit_pdf_sha256")], note.pdf_sha256);
  assert.equal(rows[1][col("rationale")], "'=unsafe");
  assert.throws(
    () =>
      reconciliationExport(
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [
          {
            id: "bad",
            credit_id: "missing",
            author: "owner",
            rationale: "Missing original",
            request_id: "request",
            created_at: "2026-04-06",
          },
        ],
      ),
    /Missing reversed credit/,
  );
});

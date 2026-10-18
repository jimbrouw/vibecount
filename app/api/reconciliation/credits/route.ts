import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { creditReview, type CreditBalance } from "@/lib/invoices/credits";
import {
  createCreditPdf,
  type CreditDocument,
} from "@/lib/invoices/credit-pdf";
import { decimalToPence } from "@/lib/money";
import { redactBankDetailsForPrompt } from "@/lib/ai/redaction";
export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export async function POST(request: Request) {
  const db = await createClient();
  const {
    data: { user },
    error: authError,
  } = await db.auth.getUser();
  if (authError || !user)
    return NextResponse.json(
      { error: "Sign in to review invoice credits." },
      { status: 401 },
    );
  const body = await request.json().catch(() => null);
  if (
    body?.humanConfirmed !== true ||
    !uuid.test(body?.invoiceId ?? "") ||
    !uuid.test(body?.requestId ?? "")
  )
    return NextResponse.json(
      { error: "Review the credit and confirm its exact effects." },
      { status: 400 },
    );
  const gross = decimalToPence(String(body.amount ?? "")),
    date = String(body.creditDate ?? ""),
    reason = redactBankDetailsForPrompt(String(body.reason ?? "").trim()),
    stamp = String(body.stamp ?? "");
  const parties = {
    sellerName: String(body.sellerName ?? "").trim(),
    sellerAddress: String(body.sellerAddress ?? "").trim(),
    clientName: String(body.clientName ?? "").trim(),
    clientAddress: String(body.clientAddress ?? "").trim(),
  };
  if (
    gross === null ||
    gross <= 0 ||
    gross > 999999999999 ||
    reason.length < 1 ||
    reason.length > 1000 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^[a-f0-9]{32}$/.test(stamp) ||
    !parties.sellerName ||
    !parties.clientName ||
    parties.sellerName.length > 200 ||
    parties.clientName.length > 200 ||
    parties.sellerAddress.length > 1000 ||
    parties.clientAddress.length > 1000
  )
    return NextResponse.json(
      { error: "Check the amount, date, names, addresses and reason." },
      { status: 400 },
    );
  const reviewHash = createHash("sha256")
    .update(
      JSON.stringify({
        invoice: body.invoiceId,
        stamp,
        gross,
        date,
        reason,
        ...parties,
        unknownVatAcknowledged: body.unknownVatAcknowledged === true,
      }),
    )
    .digest("hex");
  const { data: prior, error: priorError } = await db
    .from("invoice_credit_notes")
    .select("document_snapshot,pdf_path,pdf_sha256")
    .eq("id", body.requestId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (priorError)
    return NextResponse.json(
      { error: "Credit history is unavailable. Check the migration." },
      { status: 503 },
    );
  if (prior) {
    if (prior.document_snapshot?.reviewHash !== reviewHash)
      return NextResponse.json(
        { error: "Credit request changed. Review again." },
        { status: 409 },
      );
    const { data, error } = await db.storage
      .from("invoices")
      .download(prior.pdf_path);
    if (error || !data)
      return NextResponse.json(
        { error: "Preserved credit PDF is unavailable." },
        { status: 503 },
      );
    const bytes = Buffer.from(await data.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== prior.pdf_sha256)
      return NextResponse.json(
        { error: "Credit evidence integrity needs review." },
        { status: 503 },
      );
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="credit-${body.requestId}.pdf"`,
      },
    });
  }
  const { data: invoice, error } = await db
    .from("invoice_credit_choices")
    .select("*")
    .eq("id", body.invoiceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !invoice)
    return NextResponse.json(
      { error: "Invoice balance unavailable." },
      { status: 404 },
    );
  if (invoice.balance_stamp !== stamp)
    return NextResponse.json(
      { error: "Invoice balance changed. Reload and review." },
      { status: 409 },
    );
  let review;
  try {
    review = creditReview(invoice as CreditBalance, gross, date);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Check the credit." },
      { status: 400 },
    );
  }
  if (!review.known && body.unknownVatAcknowledged !== true)
    return NextResponse.json(
      {
        error:
          "Acknowledge that legacy VAT is unresolved. This is a commercial credit only.",
      },
      { status: 400 },
    );
  const document: CreditDocument = {
    ...parties,
    number: `CN-${invoice.number}-${String(invoice.next_ordinal).padStart(3, "0")}`,
    creditDate: date,
    invoiceNumber: invoice.number,
    invoiceDate: invoice.invoice_date,
    description: invoice.description,
    reason,
    grossPence: gross,
    netPence: review.net,
    vatPence: review.vat,
    vatRateBps: review.known ? invoice.vat_rate_bps : null,
    vatNumber: review.known ? (invoice.vat_number_snapshot ?? "") : "",
    taxStatus: review.known ? "invoice_snapshot" : "unverified",
    reviewHash,
  };
  let bytes: Uint8Array;
  try {
    bytes = await createCreditPdf(document);
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not render the credit PDF. Check the document text before retrying.",
      },
      { status: 400 },
    );
  }
  const path = `${user.id}/credits/${body.requestId}.pdf`,
    hash = createHash("sha256").update(bytes).digest("hex");
  const { error: uploadError } = await db.storage
    .from("invoices")
    .upload(path, Buffer.from(bytes), {
      contentType: "application/pdf",
      upsert: false,
    });
  if (uploadError)
    return NextResponse.json(
      {
        error:
          "Could not preserve the credit PDF. Existing invoice balances are unchanged. Reload before retrying.",
      },
      { status: 503 },
    );
  const { error: saveError } = await db.rpc("approve_invoice_credit", {
    p_invoice: invoice.id,
    p_credit: body.requestId,
    p_stamp: stamp,
    p_date: date,
    p_gross: gross,
    p_reason: reason,
    p_document: document,
    p_pdf_path: path,
    p_pdf_sha256: hash,
  });
  if (saveError)
    return NextResponse.json(
      {
        error:
          "Credit could not be approved. Reload the current balance. The upload is retained for recovery.",
      },
      { status: 409 },
    );
  for (const page of [
    "/dashboard",
    "/dashboard/reconciliation",
    "/dashboard/reconciliation/credits",
    "/dashboard/invoices/history",
  ])
    revalidatePath(page);
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="credit-${body.requestId}.pdf"`,
      "X-Credit-Id": body.requestId,
    },
  });
}
